import {
  chatQueue,
  enqueuePrompt,
  pauseChatQueue,
  removeQueuedPrompt,
  updateQueuedPrompt,
  supportsChatQueue,
} from '../../repositories/chatQueue.js';
import {
  attachChatQueue,
  dispatchChatQueue,
  notifyQueue,
  queueEvents,
} from '../../services/chatQueue.js';
import { usageSummary } from '../../repositories/usage.js';
import { validateAttachments } from '../../services/files.js';
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
  if (!row || row.mode !== 'interactive')
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
    usage: usageSummary(id),
    queue: chatQueue(id),
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
  queueEvents.on(id, send);
  const heartbeat = setInterval(() => response.write(': keepalive\n\n'), 15000);
  heartbeat.unref();
  response.on('close', () => {
    clearInterval(heartbeat);
    chat.events.off('change', send);
    queueEvents.off(id, send);
  });
}
export async function postMessage(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  try {
    const prompt: unknown = request.body?.prompt;
    const attachments = await validateAttachments(request.body?.attachments);
    if (
      typeof prompt !== 'string' ||
      (!prompt.trim() && !attachments.length) ||
      prompt.length > 100000
    )
      throw new RequestError(400, 'Enter a message up to 100,000 characters.');
    const message = prompt.trim() || 'Use these files as reference.';
    const settings =
      request.body?.settings !== undefined
        ? await validateChatSettings(
            request.body.settings,
            savedSession(request).provider,
            savedSession(request).workingDirectory,
          )
        : undefined;
    const chat = activeChat(request);
    attachChatQueue(chat);
    const delivery: unknown = request.body?.delivery;
    if (delivery === 'queue' && !supportsChatQueue(chat.info))
      throw new RequestError(
        400,
        'Prompt queues are available after this automation finishes and is resumed as a chat.',
      );
    if (delivery !== undefined && delivery !== 'queue')
      throw new RequestError(400, 'Invalid message delivery option.');
    if (
      delivery === 'queue' &&
      (chat.state !== 'idle' || chatQueue(chat.info.id).entries.length > 0)
    ) {
      enqueuePrompt(
        chat.info.id,
        message,
        settings ?? chat.info.chatSettings ?? defaultChatSettings,
        attachments,
      );
      notifyQueue(chat.info.id);
      void dispatchChatQueue(chat);
    } else {
      if (
        supportsChatQueue(chat.info) &&
        !chatQueue(chat.info.id).entries.length
      )
        pauseChatQueue(chat.info.id, null);
      await chat.send(message, settings, attachments);
    }
    const saved = nameSessionFromPrompt(
      String(request.params.sessionId),
      message,
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
    const chat = activeChat(request);
    if (supportsChatQueue(chat.info))
      pauseChatQueue(
        chat.info.id,
        'Response stopped. Review pending prompts before continuing.',
      );
    notifyQueue(chat.info.id);
    await chat.interrupt();
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

export async function updateChatQueue(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  try {
    const saved = savedSession(request);
    if (!supportsChatQueue(saved))
      throw new RequestError(
        400,
        'Prompt queues are only available for interactive chats.',
      );
    const action: unknown = request.body?.action;
    if (action === 'pause') pauseChatQueue(saved.id, 'Queue paused.');
    else if (action === 'resume') {
      const chat = activeChat(request);
      if (chatQueue(saved.id).entries[0]?.status === 'failed')
        throw new RequestError(409, 'Retry or remove the failed prompt first.');
      pauseChatQueue(saved.id, null);
      attachChatQueue(chat);
      void dispatchChatQueue(chat);
    } else if (action === 'edit' || action === 'retry') {
      const id: unknown = request.body?.id;
      if (typeof id !== 'string')
        throw new RequestError(400, 'Choose a queued prompt.');
      const entry = chatQueue(saved.id).entries.find(
        (entry) => entry.id === id,
      );
      if (!entry) throw new RequestError(404, 'Queued prompt not found.');
      const prompt: unknown =
        action === 'retry' ? entry.prompt : request.body?.prompt;
      if (
        typeof prompt !== 'string' ||
        !prompt.trim() ||
        prompt.length > 100000
      )
        throw new RequestError(
          400,
          'Enter a message up to 100,000 characters.',
        );
      updateQueuedPrompt(saved.id, id, prompt.trim());
    } else if (action === 'remove') {
      if (typeof request.body?.id !== 'string')
        throw new RequestError(400, 'Choose a queued prompt.');
      removeQueuedPrompt(saved.id, request.body.id);
    } else throw new RequestError(400, 'Invalid queue action.');
    notifyQueue(saved.id);
    response.json(chatQueue(saved.id));
  } catch (error) {
    next(error);
  }
}
