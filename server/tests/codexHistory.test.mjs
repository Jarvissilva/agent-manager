import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  readCodexHistory,
  readCodexHistoryDatabase,
} from '../src/lib/providers/codex/history.ts';

test('Codex native structured history fallback is read-only, paginated and scoped to one thread', async () => {
  const directory = await mkdtemp(
    join(tmpdir(), 'agent-manager-native-history-'),
  );
  const folder = join(directory, 'sessions', '2026', '10', '16');
  await mkdir(folder, { recursive: true });
  const database = new DatabaseSync(join(directory, 'thread_history_1.sqlite'));
  database.exec(
    'CREATE TABLE thread_items(thread_id TEXT,turn_id TEXT,item_id TEXT,item_json TEXT,rollout_ordinal INTEGER); CREATE TABLE thread_turns(thread_id TEXT,turn_id TEXT,status TEXT)',
  );
  const insert = database.prepare('INSERT INTO thread_items VALUES(?,?,?,?,?)');
  for (let index = 0; index < 205; index++)
    insert.run(
      'thread',
      'turn',
      `item-${index}`,
      JSON.stringify({
        id: `item-${index}`,
        type: 'agentMessage',
        text: `Message ${index}`,
      }),
      index,
    );
  insert.run(
    'other',
    'turn',
    'private',
    JSON.stringify({ id: 'private', text: 'Other thread' }),
    0,
  );
  database
    .prepare('INSERT INTO thread_turns VALUES(?,?,?)')
    .run('thread', 'turn', 'inProgress');
  const thread = {
    id: 'thread',
    historyMode: 'paginated',
    path: join(folder, 'rollout.jsonl'),
  };
  const items = [];
  try {
    await readCodexHistory(
      {
        async request() {
          throw Error('thread/items/list is not supported yet');
        },
      },
      thread,
      (item, turnId, completed) => items.push({ item, turnId, completed }),
    );
    assert.equal(items.length, 205);
    assert.equal(items[0].item.text, 'Message 0');
    assert.equal(items.at(-1).item.text, 'Message 204');
    assert.ok(items.every((item) => item.turnId === 'turn' && !item.completed));
    assert.equal(
      database.prepare('SELECT count(*) AS n FROM thread_items').get().n,
      206,
    );
    await assert.rejects(
      readCodexHistory(
        {
          async request() {
            throw Error('Permission denied');
          },
        },
        thread,
        () => {},
      ),
      /Permission denied/,
    );
    assert.throws(
      () =>
        readCodexHistoryDatabase('/tmp/unrelated.jsonl', 'thread', () => {}),
      /locate Codex/,
    );
  } finally {
    database.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('Codex history rejects repeated cursors and hydrates legacy metadata explicitly', async () => {
  await assert.rejects(
    readCodexHistory(
      {
        async request() {
          return { data: [], nextCursor: 'same' };
        },
      },
      { id: 'thread', historyMode: 'paginated' },
      () => {},
    ),
    /repeated history cursor/,
  );
  const items = [];
  await readCodexHistory(
    {
      async request(method, params) {
        assert.equal(method, 'thread/read');
        assert.equal(params.includeTurns, true);
        return {
          thread: {
            turns: [
              { id: 'turn', status: 'completed', items: [{ id: 'item' }] },
            ],
          },
        };
      },
    },
    { id: 'thread', turns: [] },
    (item) => items.push(item),
    true,
  );
  assert.deepEqual(items, [{ id: 'item' }]);
});
