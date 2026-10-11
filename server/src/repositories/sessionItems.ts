import { database } from '../lib/database.js';

export type ChatItem = {
  id: string;
  turnId: string;
  type: string;
  role: 'user' | 'assistant' | 'activity';
  title: string;
  text: string;
  status: string;
};

export function saveSessionItem(sessionId: string, item: ChatItem) {
  database
    .prepare(
      `
    INSERT INTO session_items (sessionId, itemId, item) VALUES (?, ?, ?)
    ON CONFLICT(sessionId, itemId) DO UPDATE SET item = excluded.item
  `,
    )
    .run(sessionId, item.id, JSON.stringify(item));
}

export function listSessionItems(sessionId: string): ChatItem[] {
  return database
    .prepare(
      'SELECT item FROM session_items WHERE sessionId = ? ORDER BY position',
    )
    .all(sessionId)
    .map((row) => JSON.parse(String(row.item)) as ChatItem);
}
