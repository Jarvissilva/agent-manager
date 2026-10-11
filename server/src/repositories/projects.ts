import { database } from '../lib/database.js';
export type Project = { id: number; name: string };
export function findProject(id: number) {
  return database.prepare('SELECT * FROM projects WHERE id=?').get(id) as
    Project | undefined;
}

export function renameProject(id: number, name: string) {
  database.prepare('UPDATE projects SET name=? WHERE id=?').run(name, id);
  return findProject(id)!;
}

export function projectDependencies(id: number) {
  const sessions = database
    .prepare(
      "SELECT COUNT(*) AS count, COALESCE(SUM(status IN ('running','stopping')),0) AS active FROM sessions WHERE projectId=?",
    )
    .get(id)!;
  const schedules = database
    .prepare('SELECT COUNT(*) AS count FROM schedules WHERE projectId=?')
    .get(id)!;
  return {
    sessionCount: Number(sessions.count),
    activeSessionCount: Number(sessions.active),
    scheduleCount: Number(schedules.count),
  };
}

export function removeProject(id: number, sessions: 'keep' | 'delete') {
  database.exec('BEGIN IMMEDIATE');
  try {
    if (sessions === 'delete')
      database.prepare('DELETE FROM sessions WHERE projectId=?').run(id);
    else
      database
        .prepare('UPDATE sessions SET projectId=NULL WHERE projectId=?')
        .run(id);
    database
      .prepare(
        'UPDATE schedules SET projectId=NULL,updatedAt=? WHERE projectId=?',
      )
      .run(new Date().toISOString(), id);
    database.prepare('DELETE FROM projects WHERE id=?').run(id);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}
