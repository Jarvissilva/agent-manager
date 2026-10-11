import assert from 'node:assert/strict';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { migrateOptionalProjects } from '../src/lib/migrateOptionalProjects.ts';
function fixture(db) {
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE projects(id INTEGER PRIMARY KEY,name TEXT);
    CREATE TABLE schedules(id INTEGER PRIMARY KEY,projectId INTEGER NOT NULL REFERENCES projects(id),name TEXT);
    CREATE TABLE sessions(id TEXT PRIMARY KEY,projectId INTEGER NOT NULL REFERENCES projects(id),scheduleId INTEGER REFERENCES schedules(id),resumedFrom TEXT REFERENCES sessions(id),snapshot TEXT);
    CREATE UNIQUE INDEX sessions_occurrence_step ON sessions(scheduleId,id);
    CREATE TABLE schedule_steps(scheduleId INTEGER REFERENCES schedules(id),position INTEGER);
    CREATE TABLE session_items(sessionId TEXT REFERENCES sessions(id),text TEXT);
    INSERT INTO projects VALUES(1,'Acme');
    INSERT INTO schedules VALUES(7,1,'Review');
    INSERT INTO schedule_steps VALUES(7,0);
    INSERT INTO sessions VALUES('original',1,7,NULL,'{"prompt":"Frozen"}');
    INSERT INTO sessions VALUES('copy',1,7,'original',NULL);
    INSERT INTO session_items VALUES('original','Transcript');`);
}
test('optional projects migration preserves references, indexes, snapshots, backup and repeated startup', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'manager-optional-projects-'));
  const path = join(dir, 'test.sqlite');
  const db = new DatabaseSync(path);
  try {
    fixture(db);
    migrateOptionalProjects(db, path);
    migrateOptionalProjects(db, path);
    await access(`${path}.before-optional-projects.sqlite`);
    assert.equal(
      db.prepare('SELECT projectId FROM sessions WHERE id=?').get('original')
        .projectId,
      1,
    );
    assert.equal(
      JSON.parse(
        db.prepare('SELECT snapshot FROM sessions WHERE id=?').get('original')
          .snapshot,
      ).prompt,
      'Frozen',
    );
    assert.equal(
      db.prepare('SELECT text FROM session_items').get().text,
      'Transcript',
    );
    assert.equal(
      db.prepare('SELECT resumedFrom FROM sessions WHERE id=?').get('copy')
        .resumedFrom,
      'original',
    );
    assert.ok(
      db
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE name='sessions_occurrence_step'",
        )
        .get(),
    );
    db.exec(
      "INSERT INTO schedules(id,projectId,name) VALUES(8,NULL,'Standalone'); INSERT INTO sessions(id,projectId,scheduleId) VALUES('standalone',NULL,8)",
    );
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.throws(() =>
      db.exec("INSERT INTO sessions(id,projectId) VALUES('invalid',999)"),
    );
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
test('optional project migration rolls back both tables on foreign key failure', () => {
  const db = new DatabaseSync(':memory:');
  try {
    fixture(db);
    db.exec(
      "PRAGMA foreign_keys=OFF; INSERT INTO sessions(id,projectId) VALUES('bad',999); PRAGMA foreign_keys=ON",
    );
    assert.throws(() => migrateOptionalProjects(db, ':memory:'));
    for (const table of ['sessions', 'schedules'])
      assert.equal(
        db
          .prepare(`PRAGMA table_info(${table})`)
          .all()
          .find((column) => column.name === 'projectId').notnull,
        1,
      );
    assert.equal(
      db.prepare('SELECT count(*) AS count FROM sessions').get().count,
      3,
    );
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  } finally {
    db.close();
  }
});
