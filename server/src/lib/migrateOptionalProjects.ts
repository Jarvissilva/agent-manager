import { existsSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';

export function migrateOptionalProjects(db: DatabaseSync, path: string) {
  const tables = ['sessions', 'schedules'].filter((table) =>
    db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .some((column) => column.name === 'projectId' && column.notnull === 1),
  );
  if (!tables.length) return;
  const backup = `${path}.before-optional-projects.sqlite`;
  if (path !== ':memory:' && !existsSync(backup))
    db.prepare('VACUUM INTO ?').run(backup);
  db.exec('PRAGMA foreign_keys=OFF');
  try {
    db.exec('BEGIN IMMEDIATE');
    for (const table of tables) {
      const schema = String(
        db
          .prepare(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name=?",
          )
          .get(table)!.sql,
      );
      const indexes = db
        .prepare(
          "SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL",
        )
        .all(table);
      const next = schema
        .replace(
          new RegExp('CREATE TABLE "?' + table + '"?'),
          `CREATE TABLE ${table}_optional`,
        )
        .replace(/projectId INTEGER NOT NULL/i, 'projectId INTEGER');
      if (next === schema || /projectId INTEGER NOT NULL/i.test(next))
        throw Error('Could not migrate optional projects.');
      db.exec(next);
      db.exec(
        `INSERT INTO ${table}_optional SELECT * FROM ${table}; DROP TABLE ${table}; ALTER TABLE ${table}_optional RENAME TO ${table};`,
      );
      for (const index of indexes) db.exec(String(index.sql));
    }
    if (db.prepare('PRAGMA foreign_key_check').all().length)
      throw Error(
        'Optional project migration failed foreign-key verification.',
      );
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys=ON');
  }
}
