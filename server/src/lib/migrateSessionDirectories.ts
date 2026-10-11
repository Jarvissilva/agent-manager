import { existsSync } from 'node:fs';
import { normalize } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

export function migrateSessionDirectories(db: DatabaseSync, path: string) {
  if (
    !db
      .prepare('PRAGMA table_info(projects)')
      .all()
      .some((c) => c.name === 'path')
  )
    return;
  const backup = `${path}.before-session-directories.sqlite`;
  if (path !== ':memory:' && !existsSync(backup))
    db.prepare('VACUUM INTO ?').run(backup);
  db.exec('PRAGMA foreign_keys=OFF');
  try {
    db.exec('BEGIN IMMEDIATE');
    db.exec(`ALTER TABLE sessions ADD COLUMN workingDirectory TEXT NOT NULL DEFAULT '';
      ALTER TABLE schedule_steps ADD COLUMN workingDirectory TEXT NOT NULL DEFAULT '';`);
    const projects = db.prepare('SELECT id,path FROM projects').all();
    for (const project of projects) {
      const fallback = normalize(String(project.path));
      db.prepare(
        'UPDATE schedule_steps SET workingDirectory=? WHERE scheduleId IN (SELECT id FROM schedules WHERE projectId=?)',
      ).run(fallback, project.id);
      for (const session of db
        .prepare('SELECT id,snapshot FROM sessions WHERE projectId=?')
        .all(project.id)) {
        const snapshot = session.snapshot
          ? JSON.parse(String(session.snapshot))
          : null;
        const directory = normalize(
          snapshot?.workingDirectory ?? snapshot?.projectPath ?? fallback,
        );
        if (snapshot) {
          snapshot.workingDirectory = directory;
          delete snapshot.projectPath;
        }
        db.prepare(
          'UPDATE sessions SET workingDirectory=?,snapshot=? WHERE id=?',
        ).run(
          directory,
          snapshot ? JSON.stringify(snapshot) : null,
          session.id,
        );
      }
    }
    db.exec(`CREATE TABLE projects_new(id INTEGER PRIMARY KEY,name TEXT NOT NULL);
      INSERT INTO projects_new(id,name) SELECT id,name FROM projects;
      DROP TABLE projects;
      ALTER TABLE projects_new RENAME TO projects;`);
    if (db.prepare('PRAGMA foreign_key_check').all().length)
      throw Error(
        'Session directory migration failed foreign-key verification.',
      );
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys=ON');
  }
}
