import { DatabaseSync } from 'node:sqlite';
import { dirname, basename, join } from 'node:path';
import type { createAppServer } from './appServer.js';

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
type ImportItem = (item: unknown, turnId: string, completed: boolean) => void;

// Codex 0.163 advertises paginated history but does not implement its list RPCs.
// Its native structured projection is readable without touching the CLI runtime.
export function readCodexHistoryDatabase(
  path: string,
  threadId: string,
  importItem: ImportItem,
) {
  let root = dirname(path);
  while (
    basename(root) !== 'sessions' &&
    basename(root) !== 'archived_sessions'
  ) {
    const parent = dirname(root);
    if (parent === root)
      throw Error('Could not locate Codex native history storage.');
    root = parent;
  }
  const database = new DatabaseSync(
    join(dirname(root), 'thread_history_1.sqlite'),
    { readOnly: true },
  );
  try {
    database.exec('BEGIN');
    const query = database.prepare(`SELECT i.item_json, i.turn_id, t.status
      FROM thread_items i LEFT JOIN thread_turns t ON t.thread_id=i.thread_id AND t.turn_id=i.turn_id
      WHERE i.thread_id=? ORDER BY i.rollout_ordinal, i.item_id LIMIT 100 OFFSET ?`);
    for (let offset = 0; ; offset += 100) {
      const rows = query.all(threadId, offset);
      for (const row of rows)
        importItem(
          JSON.parse(String(row.item_json)),
          String(row.turn_id),
          row.status !== 'inProgress' && row.status !== 'in_progress',
        );
      if (rows.length < 100) break;
    }
    database.exec('COMMIT');
  } finally {
    database.close();
  }
}

export async function readCodexHistory(
  rpc: Pick<ReturnType<typeof createAppServer>, 'request'>,
  thread: Record<string, unknown>,
  importItem: ImportItem,
  metadataOnly = false,
) {
  const threadId = String(thread.id);
  try {
    if (thread.historyMode === 'paginated') {
      let cursor: string | null = null;
      const seen = new Set<string>();
      do {
        const page = await rpc.request('thread/items/list', {
          threadId,
          cursor,
          limit: 100,
          sortDirection: 'asc',
        });
        for (const raw of list(page.data)) {
          const entry = object(raw);
          importItem(entry.item, String(entry.turnId ?? ''), true);
        }
        cursor =
          typeof page.nextCursor === 'string' && page.nextCursor
            ? page.nextCursor
            : null;
        if (cursor && seen.has(cursor))
          throw Error('Codex returned a repeated history cursor.');
        if (cursor) seen.add(cursor);
      } while (cursor);
    } else {
      const full =
        !metadataOnly && Array.isArray(thread.turns)
          ? thread
          : object(
              (
                await rpc.request('thread/read', {
                  threadId,
                  includeTurns: true,
                })
              ).thread,
            );
      for (const raw of list(full.turns)) {
        const turn = object(raw);
        for (const item of list(turn.items))
          importItem(item, String(turn.id ?? ''), turn.status !== 'inProgress');
      }
    }
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !/not supported yet|method not found|unknown method/i.test(
        error.message,
      ) ||
      typeof thread.path !== 'string'
    )
      throw error;
    readCodexHistoryDatabase(thread.path, threadId, importItem);
  }
}
