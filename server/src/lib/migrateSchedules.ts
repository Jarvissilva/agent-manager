import type { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';

const scheduleSchema = `CREATE TABLE schedules (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
 projectId INTEGER NOT NULL REFERENCES projects(id),
 agentId INTEGER REFERENCES agents(id) ON DELETE RESTRICT,
 provider TEXT NOT NULL CHECK(provider IN ('codex','antigravity','opencode')),
 prompt TEXT NOT NULL, settings TEXT NOT NULL, timeoutMinutes INTEGER NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('once','cron')), runAt TEXT, cron TEXT,
 timezone TEXT NOT NULL, enabled INTEGER NOT NULL, completed INTEGER NOT NULL DEFAULT 0,
 nextRunAt TEXT, lastTriggeredAt TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
)`;

export function migrateSchedules(db: DatabaseSync, path: string) {
  const columns = db.prepare('PRAGMA table_info(sessions)').all();
  if (columns.some((c) => c.name === 'source')) return;
  const legacy = Boolean(
    db.prepare("SELECT name FROM sqlite_master WHERE name='runs'").get(),
  );
  const backup = `${path}.before-session-schedules.sqlite`;
  if (path !== ':memory:' && existsSync(path) && !existsSync(backup))
    db.prepare('VACUUM INTO ?').run(backup);
  db.exec('PRAGMA foreign_keys=OFF');
  try {
    db.exec('BEGIN IMMEDIATE');
    // Preserve every existing column and foreign key while allowing queued sessions.
    const schema = String(
      db.prepare("SELECT sql FROM sqlite_master WHERE name='sessions'").get()!
        .sql,
    );
    db.exec(
      schema
        .replace('CREATE TABLE sessions', 'CREATE TABLE sessions_new')
        .replace(
          "'running', 'stopping', 'exited', 'interrupted'",
          "'queued', 'running', 'stopping', 'exited', 'interrupted'",
        ),
    );
    db.exec(`INSERT INTO sessions_new SELECT * FROM sessions; DROP TABLE sessions; ALTER TABLE sessions_new RENAME TO sessions;
   ALTER TABLE sessions ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
   ALTER TABLE sessions ADD COLUMN scheduleId INTEGER REFERENCES schedules(id) ON DELETE SET NULL;
   ALTER TABLE sessions ADD COLUMN scheduleName TEXT;
   ALTER TABLE sessions ADD COLUMN scheduledFor TEXT;
   ALTER TABLE sessions ADD COLUMN createdAt TEXT;
   ALTER TABLE sessions ADD COLUMN snapshot TEXT;
   ALTER TABLE sessions ADD COLUMN outcome TEXT;
   ALTER TABLE sessions ADD COLUMN error TEXT;
   ALTER TABLE sessions ADD COLUMN result TEXT;
   ALTER TABLE sessions ADD COLUMN legacyRunId TEXT;
   UPDATE sessions SET createdAt=startedAt;
   CREATE UNIQUE INDEX sessions_occurrence ON sessions(scheduleId,scheduledFor);
   CREATE UNIQUE INDEX sessions_legacy_run ON sessions(legacyRunId);
   CREATE INDEX sessions_queue ON sessions(status,createdAt);
   CREATE INDEX sessions_project_started ON sessions(projectId,startedAt DESC);`);
    if (legacy) {
      db.exec(
        scheduleSchema.replace(
          'CREATE TABLE schedules',
          'CREATE TABLE schedules_new',
        ),
      );
      db.exec(`INSERT INTO schedules_new SELECT s.id,s.name,j.projectId,j.agentId,COALESCE(a.provider,'codex'),j.prompt,
    json_object('model',NULL,'effort',NULL,'permissions',j.permissions),j.timeoutMinutes,
    s.kind,s.runAt,s.cron,s.timezone,s.enabled AND j.enabled,s.completed,s.nextRunAt,s.lastTriggeredAt,s.createdAt,s.updatedAt
    FROM schedules s JOIN jobs j ON j.id=s.jobId LEFT JOIN agents a ON a.id=j.agentId;
    DROP TABLE schedules; ALTER TABLE schedules_new RENAME TO schedules;`);
      for (const run of db
        .prepare('SELECT * FROM runs ORDER BY createdAt,rowid')
        .all()) {
        const snapshot = JSON.parse(String(run.snapshot));
        const id = String(run.sessionId ?? run.id);
        const settings = JSON.stringify({
          model: null,
          effort: null,
          permissions: snapshot.permissions,
        });
        db.prepare(
          `INSERT OR IGNORE INTO sessions(id,projectId,provider,status,startedAt,mode,transport,agentId,agentName,agentInstructions,chatSettings)
     VALUES(?,?,?,'exited',?,'interactive','chat',?,?,?,?)`,
        ).run(
          id,
          run.projectId,
          snapshot.provider ?? 'codex',
          run.startedAt ?? run.createdAt,
          snapshot.agentId &&
            db.prepare('SELECT id FROM agents WHERE id=?').get(snapshot.agentId)
            ? snapshot.agentId
            : null,
          snapshot.agentName,
          snapshot.instructions,
          settings,
        );
        db.prepare(
          `UPDATE sessions SET mode='interactive',transport='chat',source=?,scheduleId=?,scheduleName=?,scheduledFor=?,createdAt=?,snapshot=?,outcome=?,error=?,result=?,legacyRunId=?,status=?,endedAt=?,exitCode=?,chatSettings=COALESCE(chatSettings,?) WHERE id=?`,
        ).run(
          run.source === 'schedule' ? 'schedule' : 'manual',
          run.scheduleId,
          snapshot.scheduleName ?? snapshot.jobName,
          run.scheduledFor,
          run.createdAt,
          JSON.stringify({
            ...snapshot,
            legacy: {
              runId: run.id,
              jobId: run.jobId,
              source: run.source,
              retryOf: run.retryOf,
            },
            provider: snapshot.provider ?? 'codex',
            settings: JSON.parse(settings),
          }),
          run.status === 'queued'
            ? null
            : ['running', 'cancelling'].includes(String(run.status))
              ? 'interrupted'
              : run.status,
          run.error ??
            (['running', 'cancelling'].includes(String(run.status))
              ? 'Server stopped before execution finished.'
              : null),
          run.result,
          run.id,
          run.status === 'queued'
            ? 'queued'
            : ['running', 'cancelling'].includes(String(run.status))
              ? 'interrupted'
              : 'exited',
          run.endedAt ??
            (['running', 'cancelling'].includes(String(run.status))
              ? new Date().toISOString()
              : null),
          run.exitCode,
          settings,
          id,
        );
        const item = db.prepare(
          'INSERT OR IGNORE INTO session_items(sessionId,itemId,item) VALUES(?,?,?)',
        );
        const add = (
          key: string,
          role: string,
          title: string,
          text: string,
          status = 'completed',
        ) =>
          item.run(
            id,
            key,
            JSON.stringify({
              id: key,
              turnId: `legacy-${run.id}`,
              type: 'legacy',
              role,
              title,
              text,
              status,
            }),
          );
        if (run.status !== 'queued')
          add(`legacy-${run.id}-prompt`, 'user', 'You', snapshot.prompt);
        for (const event of db
          .prepare('SELECT * FROM run_events WHERE runId=? ORDER BY id')
          .all(run.id))
          add(
            `legacy-event-${event.id}`,
            'activity',
            `${event.kind} · ${event.createdAt}`,
            String(event.text),
          );
        if (run.result)
          add(
            `legacy-${run.id}-result`,
            'assistant',
            'Result',
            String(run.result),
          );
        if (run.error)
          add(
            `legacy-${run.id}-error`,
            'activity',
            'Error',
            String(run.error),
            'failed',
          );
      }
      db.exec('DROP TABLE run_events; DROP TABLE runs; DROP TABLE jobs');
    } else db.exec(scheduleSchema);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS sessions_occurrence ON sessions(scheduleId,scheduledFor);
   CREATE UNIQUE INDEX IF NOT EXISTS sessions_legacy_run ON sessions(legacyRunId);
   CREATE INDEX IF NOT EXISTS sessions_queue ON sessions(status,createdAt);
   CREATE INDEX IF NOT EXISTS sessions_project_started ON sessions(projectId,startedAt DESC);`);
    const violations = db.prepare('PRAGMA foreign_key_check').all();
    if (violations.length)
      throw Error('Session migration failed foreign-key verification.');
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys=ON');
  }
}
