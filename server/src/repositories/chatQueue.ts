import type { SessionInfo } from './sessions.js';
import { randomUUID } from 'node:crypto';
import { database } from '../lib/database.js';
import { RequestError } from '../lib/http/errors.js';
import type { ChatSettings } from '../lib/providers/types.js';
import type { FileAttachment } from '../services/files.js';

export type QueuedPrompt = {
  id: string;
  sessionId: string;
  prompt: string;
  settings: ChatSettings;
  attachments: FileAttachment[];
  status: 'queued' | 'sending' | 'failed';
  error: string | null;
  createdAt: string;
};
export function supportsChatQueue(info: SessionInfo) {
  return (
    info.mode === 'interactive' &&
    info.transport === 'chat' &&
    (info.source !== 'schedule' || Boolean(info.lastResumedAt))
  );
}
function promptRow(row: Record<string, unknown>): QueuedPrompt {
  return {
    id: String(row.id),
    sessionId: String(row.sessionId),
    prompt: String(row.prompt),
    settings: JSON.parse(String(row.settings)) as ChatSettings,
    attachments: JSON.parse(
      String(row.attachments ?? '[]'),
    ) as FileAttachment[],
    status: row.status as QueuedPrompt['status'],
    error: row.error === null ? null : String(row.error),
    createdAt: String(row.createdAt),
  };
}
export function chatQueue(sessionId: string) {
  const entries = database
    .prepare(
      'SELECT * FROM chat_prompt_queue WHERE sessionId=? ORDER BY position',
    )
    .all(sessionId)
    .map(promptRow);
  const state = database
    .prepare('SELECT paused,reason FROM chat_queue_state WHERE sessionId=?')
    .get(sessionId);
  return {
    entries,
    paused: Boolean(state?.paused),
    reason: state?.reason ? String(state.reason) : null,
  };
}
export function pauseChatQueue(sessionId: string, reason: string | null) {
  database
    .prepare(
      'INSERT INTO chat_queue_state(sessionId,paused,reason) VALUES(?,?,?) ON CONFLICT(sessionId) DO UPDATE SET paused=excluded.paused,reason=excluded.reason',
    )
    .run(sessionId, reason === null ? 0 : 1, reason);
}
export function enqueuePrompt(
  sessionId: string,
  prompt: string,
  settings: ChatSettings,
  attachments: FileAttachment[] = [],
) {
  if (chatQueue(sessionId).entries.length >= 50)
    throw new RequestError(400, 'This session already has 50 queued prompts.');
  const id = randomUUID();
  database
    .prepare(
      "INSERT INTO chat_prompt_queue(id,sessionId,prompt,settings,attachments,status,createdAt) VALUES(?,?,?,?,?,'queued',?)",
    )
    .run(
      id,
      sessionId,
      prompt,
      JSON.stringify(settings),
      JSON.stringify(attachments),
      new Date().toISOString(),
    );
  return id;
}
export function updateQueuedPrompt(
  sessionId: string,
  id: string,
  prompt: string,
) {
  const result = database
    .prepare(
      "UPDATE chat_prompt_queue SET prompt=?,status='queued',error=NULL WHERE sessionId=? AND id=? AND status!='sending'",
    )
    .run(prompt, sessionId, id);
  if (!result.changes)
    throw new RequestError(
      409,
      'This prompt is being sent or is no longer queued.',
    );
}
export function removeQueuedPrompt(sessionId: string, id: string) {
  const result = database
    .prepare(
      "DELETE FROM chat_prompt_queue WHERE sessionId=? AND id=? AND status!='sending'",
    )
    .run(sessionId, id);
  if (!result.changes)
    throw new RequestError(
      409,
      'This prompt is being sent or is no longer queued.',
    );
}
export function claimQueuedPrompt(sessionId: string): QueuedPrompt | null {
  const queue = chatQueue(sessionId);
  if (
    queue.paused ||
    !queue.entries.length ||
    queue.entries[0].status !== 'queued'
  )
    return null;
  const first = queue.entries[0];
  const claimed = database
    .prepare(
      "UPDATE chat_prompt_queue SET status='sending' WHERE sessionId=? AND id=? AND status='queued'",
    )
    .run(sessionId, first.id);
  return claimed.changes ? { ...first, status: 'sending' } : null;
}
export function completeQueuedPrompt(id: string) {
  database.prepare('DELETE FROM chat_prompt_queue WHERE id=?').run(id);
}
export function failQueuedPrompt(id: string, error: string) {
  database
    .prepare("UPDATE chat_prompt_queue SET status='failed',error=? WHERE id=?")
    .run(error, id);
}
export function recoverChatQueues() {
  database
    .prepare(
      "INSERT INTO chat_queue_state(sessionId,paused,reason) SELECT DISTINCT sessionId,1,'Server restarted. Review pending prompts before resuming the queue.' FROM chat_prompt_queue WHERE 1 ON CONFLICT(sessionId) DO UPDATE SET paused=1,reason=excluded.reason",
    )
    .run();
  database
    .prepare(
      "UPDATE chat_prompt_queue SET status='failed',error='Delivery was interrupted. Check the conversation before retrying this prompt.' WHERE status='sending'",
    )
    .run();
}
