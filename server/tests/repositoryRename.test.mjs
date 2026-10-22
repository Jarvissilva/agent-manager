import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  mkdtempSync,
  mkdirSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { migrateRepository } from '../../migrate-repository.mjs';

test('repository move preserves data, repairs owned links, and is idempotent', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-manager-rename-'));
  const from = join(dir, 'agent-manager-old');
  const to = join(dir, 'agent-manager');
  mkdirSync(to);
  const databasePath = join(dir, 'data.sqlite');
  const link = join(dir, 'published-skill');
  symlinkSync(join(from, 'skills/example'), link);
  const db = new DatabaseSync(databasePath);
  db.exec(`
    CREATE TABLE sessions (workingDirectory TEXT);
    CREATE TABLE skills (path TEXT);
    CREATE TABLE skill_publications (path TEXT, target TEXT, mode TEXT);
    CREATE TABLE session_items (item TEXT);
  `);
  for (const value of [
    from,
    join(from, 'child'),
    from + '-other',
    '/unrelated',
    null,
  ])
    db.prepare('INSERT INTO sessions VALUES (?)').run(value);
  db.prepare('INSERT INTO skills VALUES (?)').run(join(from, 'skills/example'));
  db.prepare('INSERT INTO skill_publications VALUES (?, ?, ?)').run(
    link,
    join(from, 'skills/example'),
    'link',
  );
  db.prepare('INSERT INTO skill_publications VALUES (?, ?, ?)').run(
    join(dir, 'copy'),
    join(from, 'skills/example'),
    'copy',
  );
  db.prepare('INSERT INTO session_items VALUES (?)').run(from);
  try {
    const before = db.prepare('SELECT * FROM sessions').all();
    db.exec(`CREATE TRIGGER block_update BEFORE UPDATE ON skills
      BEGIN SELECT RAISE(ABORT, 'blocked update'); END`);
    await assert.rejects(
      migrateRepository({ databasePath, from, to }),
      /blocked update/,
    );
    assert.deepEqual(db.prepare('SELECT * FROM sessions').all(), before);
    assert.equal(readlinkSync(link), join(from, 'skills/example'));
    db.exec('DROP TRIGGER block_update');
    const result = await migrateRepository({ databasePath, from, to });
    assert.equal(result.changes, 5);
    assert.equal(result.links, 1);
    assert.equal(statSync(result.backupPath).mode & 0o777, 0o600);
    const saved = new DatabaseSync(result.backupPath, { readOnly: true });
    assert.deepEqual(saved.prepare('SELECT * FROM sessions').all(), before);
    saved.close();
    assert.deepEqual(
      db
        .prepare('SELECT workingDirectory FROM sessions')
        .all()
        .map((row) => row.workingDirectory),
      [to, join(to, 'child'), from + '-other', '/unrelated', null],
    );
    assert.equal(
      db.prepare('SELECT path FROM skills').get().path,
      join(to, 'skills/example'),
    );
    assert.equal(
      db
        .prepare(
          'SELECT COUNT(*) AS count FROM skill_publications WHERE target = ?',
        )
        .get(join(to, 'skills/example')).count,
      2,
    );
    assert.equal(readlinkSync(link), join(to, 'skills/example'));
    assert.equal(db.prepare('SELECT item FROM session_items').get().item, from);
    assert.deepEqual(await migrateRepository({ databasePath, from, to }), {
      changes: 0,
      links: 0,
      backupPath: null,
    });
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('repository move refuses to overwrite an externally changed skill link', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-manager-rename-conflict-'));
  const from = join(dir, 'agent-manager-old');
  const to = join(dir, 'agent-manager');
  mkdirSync(to);
  const databasePath = join(dir, 'data.sqlite');
  const link = join(dir, 'published-skill');
  symlinkSync('/external/skill', link);
  const db = new DatabaseSync(databasePath);
  db.exec(
    'CREATE TABLE sessions (workingDirectory TEXT); CREATE TABLE skills (path TEXT); CREATE TABLE skill_publications (path TEXT, target TEXT, mode TEXT)',
  );
  db.prepare('INSERT INTO skills VALUES (?)').run(from);
  db.prepare('INSERT INTO skill_publications VALUES (?, ?, ?)').run(
    link,
    from,
    'link',
  );
  try {
    await assert.rejects(
      migrateRepository({ databasePath, from, to }),
      /points elsewhere/,
    );
    assert.equal(readlinkSync(link), '/external/skill');
    assert.equal(db.prepare('SELECT path FROM skills').get().path, from);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
