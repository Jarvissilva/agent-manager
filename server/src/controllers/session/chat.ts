import type { Request, Response, NextFunction } from 'express';
import { getSessionById } from '../../services/sessions.js';
import { RequestError } from '../../lib/http/errors.js';
import { listSessionItems } from '../../repositories/sessionItems.js';
import {
  findSessionById,
  nameSessionFromPrompt,
} from '../../repositories/sessions.js';
import {
  defaultChatSettings,
  validateChatSettings,
} from '../../services/chatSettings.js';

function savedSession(request: Request) {
  const id = String(request.params.sessionId);
  const row = findSessionById(id);
  if (!row || row.mode !== 'interactive' || row.transport !== 'chat')
    throw new RequestError(404, 'Chat session not found.');
  return row;
}
function activeChat(request: Request) {
  const { id } = savedSession(request);
  const session = getSessionById(id);
  if (!session?.chat || session.info.status !== 'running')
    throw new RequestError(409, 'Resume this chat session to continue.');
  return session.chat;
}
export function getChat(request: Request, response: Response) {
  const saved = savedSession(request);
  const id = saved.id;
  const chat = getSessionById(id)?.chat;
  response.setHeader('Cache-Control', 'no-cache');
  response.setHeader('Content-Type', 'text/event-stream');
  response.setHeader('X-Accel-Buffering', 'no');
  response.flushHeaders();
  const send = (event: object) => {
    if (response.destroyed) return;
    if (response.writableLength > 2 * 1024 * 1024) {
      response.destroy();
      return;
    }
    response.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  send({
    type: 'snapshot',
    ...(chat?.snapshot() ?? {
      items: listSessionItems(id).map((item) =>
        item.status === 'inProgress'
          ? { ...item, status: 'interrupted' }
          : item,
      ),
      requests: [],
      state: 'closed',
      error: null,
      settings: saved.chatSettings ?? defaultChatSettings,
    }),
  });
  if (!chat || chat.state === 'closed') {
    response.end();
    return;
  }
  chat.events.on('change', send);
  const heartbeat = setInterval(() => response.write(': keepalive\n\n'), 15000);
  heartbeat.unref();
  response.on('close', () => {
    clearInterval(heartbeat);
    chat.events.off('change', send);
  });
}
export async function postMessage(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  try {
    const prompt: unknown = request.body?.prompt;
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 100000)
      throw new RequestError(400, 'Enter a message up to 100,000 characters.');
    const settings =
      request.body?.settings !== undefined
        ? await validateChatSettings(
            request.body.settings,
            savedSession(request).provider,
            savedSession(request).workingDirectory,
          )
        : undefined;
    const chat = activeChat(request);
    await chat.send(prompt.trim(), settings);
    const saved = nameSessionFromPrompt(
      String(request.params.sessionId),
      prompt,
    );
    const runtime = getSessionById(saved.id);
    if (runtime) runtime.info.name = saved.name;
    response.status(202).json({ accepted: true });
  } catch (error) {
    next(
      error instanceof RequestError
        ? error
        : new RequestError(
            502,
            'The provider could not accept this message. Check the conversation error and try again.',
          ),
    );
  }
}
export async function interruptChat(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  try {
    await activeChat(request).interrupt();
    response.json({ stopped: true });
  } catch (error) {
    next(error);
  }
}
export async function respondToChat(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  try {
    await activeChat(request).respond(
      String(request.params.requestId),
      request.body ?? {},
    );
    response.json({ answered: true });
  } catch (error) {
    next(error);
  }
}
