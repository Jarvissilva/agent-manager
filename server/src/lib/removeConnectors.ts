import { existsSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';

export function removeConnectors(db: DatabaseSync, path: string) {
  const hasColumn = db
    .prepare('PRAGMA table_info(sessions)')
    .all()
    .some((column) => column.name === 'connectors');
  const hasTables = db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name IN ('connectors','agent_connectors') LIMIT 1",
    )
    .get();
  const hasSnapshots = db
    .prepare(
      "SELECT 1 FROM sessions WHERE snapshot IS NOT NULL AND json_type(snapshot,'$.connectors') IS NOT NULL LIMIT 1",
    )
    .get();
  if (!hasColumn && !hasTables && !hasSnapshots) return;

  const backup = `${path}.before-remove-connectors.sqlite`;
  if (path !== ':memory:' && !existsSync(backup))
    db.prepare('VACUUM INTO ?').run(backup);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(
      'DROP TABLE IF EXISTS agent_connectors; DROP TABLE IF EXISTS connectors',
    );
    if (hasColumn) db.exec('ALTER TABLE sessions DROP COLUMN connectors');
    db.exec(
      "UPDATE sessions SET snapshot=json_remove(snapshot,'$.connectors') WHERE snapshot IS NOT NULL AND json_type(snapshot,'$.connectors') IS NOT NULL",
    );
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
