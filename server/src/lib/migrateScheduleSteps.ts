import { existsSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';

export function migrateScheduleSteps(db: DatabaseSync, path: string) {
  if (
    db.prepare("SELECT 1 FROM sqlite_master WHERE name='schedule_steps'").get()
  )
    return;
  const backup = `${path}.before-schedule-steps.sqlite`;
  if (path !== ':memory:' && !existsSync(backup))
    db.prepare('VACUUM INTO ?').run(backup);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`CREATE TABLE schedule_steps (
      scheduleId INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
      position INTEGER NOT NULL, name TEXT NOT NULL,
      agentId INTEGER REFERENCES agents(id) ON DELETE RESTRICT,
      provider TEXT NOT NULL CHECK(provider IN ('codex','antigravity','opencode')),
      prompt TEXT NOT NULL, settings TEXT NOT NULL, timeoutMinutes INTEGER NOT NULL,
      PRIMARY KEY(scheduleId,position)
    );
    INSERT INTO schedule_steps SELECT id,0,'Session 1',agentId,provider,prompt,settings,timeoutMinutes FROM schedules;
    ALTER TABLE schedules DROP COLUMN agentId;
    ALTER TABLE schedules DROP COLUMN provider;
    ALTER TABLE schedules DROP COLUMN prompt;
    ALTER TABLE schedules DROP COLUMN settings;
    ALTER TABLE schedules DROP COLUMN timeoutMinutes;
    ALTER TABLE sessions ADD COLUMN occurrenceId TEXT;
    ALTER TABLE sessions ADD COLUMN stepIndex INTEGER;
    ALTER TABLE sessions ADD COLUMN stepName TEXT;
    UPDATE sessions SET occurrenceId=id,stepIndex=0,stepName='Session 1' WHERE source='schedule';
    DROP INDEX IF EXISTS sessions_occurrence;
    CREATE UNIQUE INDEX sessions_occurrence ON sessions(scheduleId,scheduledFor,stepIndex);
    CREATE UNIQUE INDEX sessions_occurrence_step ON sessions(occurrenceId,stepIndex);`);
    if (db.prepare('PRAGMA foreign_key_check').all().length)
      throw Error('Schedule step migration failed foreign-key verification.');
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
