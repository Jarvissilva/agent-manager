import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { removeConnectors } from '../src/lib/removeConnectors.ts';

test('connector removal backs up configuration and preserves session history on repeated startup', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'manager-remove-connectors-'));
  const path = join(dir, 'test.sqlite');
  const db = new DatabaseSync(path);
  try {
    db.exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE agents(id INTEGER PRIMARY KEY,name TEXT);
      CREATE TABLE connectors(id INTEGER PRIMARY KEY,credential TEXT);
      CREATE TABLE agent_connectors(agentId INTEGER REFERENCES agents(id),connectorId INTEGER REFERENCES connectors(id));
      CREATE TABLE sessions(id TEXT PRIMARY KEY,connectors TEXT,snapshot TEXT,result TEXT);
      CREATE TABLE session_items(sessionId TEXT REFERENCES sessions(id),item TEXT);
      INSERT INTO agents VALUES(1,'Reviewer');
      INSERT INTO connectors VALUES(1,'encrypted-token');
      INSERT INTO agent_connectors VALUES(1,1);
      INSERT INTO sessions VALUES('saved','[{"id":1}]','{"connectors":[{"id":1}],"prompt":"Review","skills":[]}', 'Saved reply');
      INSERT INTO sessions VALUES('manual','[]',NULL,NULL);
      INSERT INTO session_items VALUES('saved','Saved transcript');`);
    removeConnectors(db, path);
    assert.equal(
      db
        .prepare("SELECT name FROM sqlite_master WHERE name='connectors'")
        .get(),
      undefined,
    );
    assert.equal(
      db
        .prepare("SELECT name FROM sqlite_master WHERE name='agent_connectors'")
        .get(),
      undefined,
    );
    assert.ok(
      !db
        .prepare('PRAGMA table_info(sessions)')
        .all()
        .some((c) => c.name === 'connectors'),
    );
    assert.equal(db.prepare('SELECT name FROM agents').get().name, 'Reviewer');
    const sessions = db.prepare('SELECT * FROM sessions ORDER BY id').all();
    assert.equal(sessions[0].snapshot, null);
    assert.deepEqual(JSON.parse(sessions[1].snapshot), {
      prompt: 'Review',
      skills: [],
    });
    assert.equal(sessions[1].result, 'Saved reply');
    assert.equal(
      db.prepare('SELECT item FROM session_items').get().item,
      'Saved transcript',
    );
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    const backupPath = `${path}.before-remove-connectors.sqlite`;
    const before = await stat(backupPath);
    const backup = new DatabaseSync(backupPath, { readOnly: true });
    try {
      assert.equal(
        backup.prepare('SELECT credential FROM connectors').get().credential,
        'encrypted-token',
      );
    } finally {
      backup.close();
    }
    removeConnectors(db, path);
    assert.deepEqual(
      db.prepare('SELECT * FROM sessions ORDER BY id').all(),
      sessions,
    );
    assert.equal((await stat(backupPath)).mtimeMs, before.mtimeMs);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
