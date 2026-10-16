import { closeSync, openSync, readSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { databasePath } from '../../database.js';

export const conversationIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function codexLogDirectory(sessionId: string) {
  return join(dirname(databasePath), 'codex-logs', sessionId);
}

export function readCodexConversationId(sessionId: string) {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(
      join(codexLogDirectory(sessionId), 'codex-tui.log'),
      'r',
    );
    // Startup is at the beginning of a fresh per-launch log. Bound reads even
    // when the user's logging configuration produces a large file.
    const buffer = Buffer.alloc(1024 * 1024);
    const length = readSync(descriptor, buffer, 0, buffer.length, 0);
    const match =
      /session_loop\{thread_id=([0-9a-f-]{36})\}: codex_core::session: new(?:\r?\n|$)/i.exec(
        buffer.toString('utf8', 0, length),
      );
    return match && conversationIdPattern.test(match[1]) ? match[1] : null;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
      return null;
    throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

export function removeCodexLogDirectory(sessionId: string) {
  rmSync(codexLogDirectory(sessionId), { recursive: true, force: true });
}
