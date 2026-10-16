import { EventEmitter } from 'node:events';
import type { SessionInfo } from '../repositories/sessions.js';
import type { ChatSettings } from '../lib/providers/types.js';
import type { FileAttachment } from './files.js';
import {
  chatQueue,
  claimQueuedPrompt,
  completeQueuedPrompt,
  failQueuedPrompt,
  pauseChatQueue,
  supportsChatQueue,
} from '../repositories/chatQueue.js';

export type QueueChat = {
  info: SessionInfo;
  state: 'starting' | 'idle' | 'working' | 'stopping' | 'closed';
  events: EventEmitter;
  ready: Promise<void>;
  send(
    prompt: string,
    settings?: ChatSettings,
    attachments?: FileAttachment[],
  ): Promise<void>;
};
export const queueEvents = new EventEmitter();
queueEvents.setMaxListeners(0);
const registered = new WeakSet<QueueChat>();
const sending = new Set<string>();
export function notifyQueue(sessionId: string) {
  queueEvents.emit(sessionId, { type: 'queue', queue: chatQueue(sessionId) });
}
export function attachChatQueue(chat: QueueChat) {
  if (registered.has(chat) || !supportsChatQueue(chat.info)) return;
  registered.add(chat);
  chat.events.on('turn', (outcome: string) => {
    if (!['completed', 'succeeded'].includes(outcome))
      pauseChatQueue(
        chat.info.id,
        'The last response stopped or failed. Review the conversation before continuing.',
      );
    notifyQueue(chat.info.id);
    setImmediate(() => void dispatchChatQueue(chat));
  });
  chat.events.on('change', (event: { type: string; state?: string }) => {
    if (event.type === 'state' && event.state === 'closed') {
      pauseChatQueue(
        chat.info.id,
        'Session ended. Resume the session before continuing its queue.',
      );
      notifyQueue(chat.info.id);
    }
  });
  void chat.ready.then(() => dispatchChatQueue(chat)).catch(() => {});
}
export async function dispatchChatQueue(chat: QueueChat) {
  const id = chat.info.id;
  if (
    !supportsChatQueue(chat.info) ||
    sending.has(id) ||
    chat.state !== 'idle' ||
    chat.info.status !== 'running'
  )
    return;
  const entry = claimQueuedPrompt(id);
  if (!entry) return;
  sending.add(id);
  notifyQueue(id);
  try {
    await chat.send(entry.prompt, entry.settings, entry.attachments);
    completeQueuedPrompt(entry.id);
  } catch (error) {
    failQueuedPrompt(
      entry.id,
      error instanceof Error ? error.message : 'Could not send this prompt.',
    );
    pauseChatQueue(
      id,
      'A queued prompt could not be delivered. Review it before retrying.',
    );
  } finally {
    sending.delete(id);
    notifyQueue(id);
    // Completion can precede send() resolving. Yield until the provider has
    // released its own send guard before dispatching another prompt.
    if (
      chat.state === 'idle' &&
      !chatQueue(id).paused &&
      chatQueue(id).entries[0]?.status === 'queued'
    )
      setImmediate(() => void dispatchChatQueue(chat));
  }
}
