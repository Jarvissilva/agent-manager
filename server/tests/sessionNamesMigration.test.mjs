import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

test('session names backfill existing chats and schedule steps once', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'manager-session-names-'));
  const path = join(directory, 'test.sqlite');
  const migrate = () => {
    const result = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        "const { database } = await import('./src/lib/database.ts'); database.close();",
      ],
      {
        cwd: new URL('..', import.meta.url),
        env: { ...process.env, AGENT_MANAGER_DB_PATH: path },
        encoding: 'utf8',
      },
    );
    assert.equal(result.status, 0, result.stderr);
  };
  let database;
  try {
    migrate();
    database = new DatabaseSync(path);
    database.exec('ALTER TABLE sessions DROP COLUMN name');
    const insert = database.prepare(
      "INSERT INTO sessions(id,projectId,workingDirectory,provider,status,startedAt,stepName) VALUES(?,NULL,?,'codex','exited',?,?)",
    );
    for (const [id, stepName] of [
      ['chat', null],
      ['scheduled', 'Review changes'],
      ['empty', null],
    ])
      insert.run(id, directory, new Date().toISOString(), stepName);
    const item = database.prepare(
      'INSERT INTO session_items(sessionId,itemId,item) VALUES(?,?,?)',
    );
    item.run(
      'chat',
      'assistant',
      JSON.stringify({ role: 'assistant', text: 'Ignore this' }),
    );
    item.run(
      'chat',
      'first',
      JSON.stringify({ role: 'user', text: '  Review\n the API  ' }),
    );
    item.run(
      'chat',
      'later',
      JSON.stringify({ role: 'user', text: 'Later message' }),
    );
    database.close();
    database = undefined;
    migrate();
    database = new DatabaseSync(path);
    const names = () =>
      database
        .prepare('SELECT id,name FROM sessions ORDER BY id')
        .all()
        .map((row) => ({ ...row }));
    assert.deepEqual(names(), [
      { id: 'chat', name: 'Review the API' },
      { id: 'empty', name: null },
      { id: 'scheduled', name: 'Review changes' },
    ]);
    database
      .prepare('UPDATE sessions SET name=? WHERE id=?')
      .run('My chosen name', 'chat');
    database.close();
    database = undefined;
    migrate();
    database = new DatabaseSync(path);
    assert.equal(
      database.prepare('SELECT name FROM sessions WHERE id=?').get('chat').name,
      'My chosen name',
    );
    assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    database?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
