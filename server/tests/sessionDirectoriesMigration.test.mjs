import assert from 'node:assert/strict';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { migrateSessionDirectories } from '../src/lib/migrateSessionDirectories.ts';

function fixture(db) {
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE projects(id INTEGER PRIMARY KEY,name TEXT NOT NULL,path TEXT NOT NULL UNIQUE);
    CREATE TABLE schedules(id INTEGER PRIMARY KEY,projectId INTEGER REFERENCES projects(id));
    CREATE TABLE schedule_steps(scheduleId INTEGER REFERENCES schedules(id),position INTEGER);
    CREATE TABLE sessions(id TEXT PRIMARY KEY,projectId INTEGER REFERENCES projects(id),snapshot TEXT);
    CREATE TABLE session_items(sessionId TEXT REFERENCES sessions(id),text TEXT);
    INSERT INTO projects VALUES(1,'Acme','/unavailable/code/');
    INSERT INTO schedules VALUES(7,1);
    INSERT INTO schedule_steps VALUES(7,0);
    INSERT INTO sessions VALUES('manual',1,NULL);
    INSERT INTO session_items VALUES('manual','Saved conversation');`);
  db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(
    'queued',
    1,
    JSON.stringify({
      projectPath: '/unavailable/worktree',
      prompt: 'Review',
      settings: { model: null },
    }),
  );
}

test('directory migration preserves history and queued snapshots, backs up, and is idempotent', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'manager-directory-migration-'));
  const path = join(dir, 'test.sqlite');
  const db = new DatabaseSync(path);
  try {
    fixture(db);
    migrateSessionDirectories(db, path);
    await access(`${path}.before-session-directories.sqlite`);
    assert.deepEqual(
      db
        .prepare('PRAGMA table_info(projects)')
        .all()
        .map((c) => c.name),
      ['id', 'name'],
    );
    const manual = db.prepare("SELECT * FROM sessions WHERE id='manual'").get();
    assert.equal(manual.workingDirectory, '/unavailable/code/');
    const queued = db.prepare("SELECT * FROM sessions WHERE id='queued'").get();
    assert.equal(queued.workingDirectory, '/unavailable/worktree');
    assert.deepEqual(JSON.parse(queued.snapshot), {
      workingDirectory: '/unavailable/worktree',
      prompt: 'Review',
      settings: { model: null },
    });
    assert.equal(
      db.prepare('SELECT workingDirectory FROM schedule_steps').get()
        .workingDirectory,
      '/unavailable/code/',
    );
    assert.equal(
      db.prepare('SELECT text FROM session_items').get().text,
      'Saved conversation',
    );
    migrateSessionDirectories(db, path);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    db.prepare('INSERT INTO projects(name) VALUES(?)').run('Another project');
    const backup = new DatabaseSync(
      `${path}.before-session-directories.sqlite`,
    );
    assert.ok(
      backup
        .prepare('PRAGMA table_info(projects)')
        .all()
        .some((c) => c.name === 'path'),
    );
    backup.close();
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('directory migration rolls back schema and data on invalid snapshot', () => {
  const db = new DatabaseSync(':memory:');
  try {
    fixture(db);
    db.exec("UPDATE sessions SET snapshot='invalid' WHERE id='queued'");
    assert.throws(() => migrateSessionDirectories(db, ':memory:'));
    assert.ok(
      db
        .prepare('PRAGMA table_info(projects)')
        .all()
        .some((c) => c.name === 'path'),
    );
    assert.ok(
      !db
        .prepare('PRAGMA table_info(sessions)')
        .all()
        .some((c) => c.name === 'workingDirectory'),
    );
    assert.equal(
      db.prepare('SELECT count(*) AS count FROM sessions').get().count,
      2,
    );
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  } finally {
    db.close();
  }
});
