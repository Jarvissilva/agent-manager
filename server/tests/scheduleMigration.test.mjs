import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

test('transactional migration preserves sessions, schedules, deleted task history, queued snapshots and legacy links', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'manager-migration-'));
  const path = join(dir, 'test.sqlite');
  let db = new DatabaseSync(path);
  try {
    db.exec(`CREATE TABLE projects(id INTEGER PRIMARY KEY,name TEXT,path TEXT);
 CREATE TABLE agents(id INTEGER PRIMARY KEY,name TEXT NOT NULL COLLATE NOCASE UNIQUE,provider TEXT NOT NULL CHECK(provider IN ('codex','antigravity','opencode')),instructions TEXT,createdAt TEXT,updatedAt TEXT);
 CREATE TABLE sessions(id TEXT PRIMARY KEY,projectId INTEGER REFERENCES projects(id),provider TEXT,status TEXT NOT NULL CHECK (status IN ('running', 'stopping', 'exited', 'interrupted')),startedAt TEXT NOT NULL,endedAt TEXT,exitCode INTEGER,codexConversationId TEXT);
 CREATE TABLE jobs(id INTEGER PRIMARY KEY,name TEXT,projectId INTEGER,agentId INTEGER,prompt TEXT,permissions TEXT,timeoutMinutes INTEGER,enabled INTEGER);
 CREATE TABLE schedules(id INTEGER PRIMARY KEY,jobId INTEGER,name TEXT,kind TEXT,runAt TEXT,cron TEXT,timezone TEXT,enabled INTEGER,completed INTEGER,nextRunAt TEXT,lastTriggeredAt TEXT,createdAt TEXT,updatedAt TEXT);
 CREATE TABLE runs(id TEXT PRIMARY KEY,jobId INTEGER,scheduleId INTEGER,projectId INTEGER,sessionId TEXT,snapshot TEXT,source TEXT,scheduledFor TEXT,retryOf TEXT,status TEXT,createdAt TEXT,startedAt TEXT,endedAt TEXT,exitCode INTEGER,error TEXT,result TEXT);
 CREATE TABLE run_events(id INTEGER PRIMARY KEY,runId TEXT,kind TEXT,text TEXT,createdAt TEXT);
 INSERT INTO projects VALUES(1,'Test','/tmp');
 INSERT INTO sessions VALUES('original',1,'codex','exited','2026-01-01',NULL,0,'12345678-1234-5678-9012-123456789012');
 INSERT INTO jobs VALUES(1,'Task',1,NULL,'Review','read-only',30,0);
 INSERT INTO schedules VALUES(1,1,'Daily','cron',NULL,'0 9 * * *','UTC',1,0,'2026-10-11T09:00:00.000Z',NULL,'2026-01-01','2026-01-01');`);
    const snapshot = {
      provider: 'codex',
      jobName: 'Task',
      scheduleName: 'Daily',
      projectName: 'Test',
      projectPath: '/tmp',
      agentId: null,
      agentName: null,
      instructions: null,
      skills: [],
      prompt: 'Review',
      permissions: 'read-only',
      timeoutMinutes: 30,
    };
    const insert = db.prepare(
      'INSERT INTO runs VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    );
    insert.run(
      'old-run',
      1,
      1,
      1,
      'original',
      JSON.stringify(snapshot),
      'schedule',
      '2026-01-01',
      null,
      'succeeded',
      '2026-01-01',
      '2026-01-01',
      '2026-01-02',
      0,
      null,
      'Saved result',
    );
    insert.run(
      'deleted-run',
      null,
      null,
      1,
      null,
      JSON.stringify({ ...snapshot, jobName: 'Deleted task' }),
      'manual',
      null,
      null,
      'failed',
      '2026-01-01',
      null,
      '2026-01-02',
      1,
      'Saved error',
      null,
    );
    insert.run(
      'queued-run',
      1,
      1,
      1,
      null,
      JSON.stringify(snapshot),
      'schedule',
      '2026-01-03',
      null,
      'queued',
      '2026-01-03',
      null,
      null,
      null,
      null,
      null,
    );
    db.exec(
      "INSERT INTO run_events VALUES(1,'old-run','stdout','Saved output','2026-01-01')",
    );
    const migrate = () =>
      execFileSync(
        process.execPath,
        [
          '--import',
          'tsx',
          '--input-type=module',
          '-e',
          "const {database}=await import('./src/lib/database.ts');database.close();",
        ],
        {
          cwd: new URL('..', import.meta.url),
          env: { ...process.env, AGENT_MANAGER_DB_PATH: path },
          encoding: 'utf8',
        },
      );
    migrate();
    // The migration runs in a separate process and rebuilds the sessions table.
    // Reopen so this connection does not keep the pre-migration schema.
    db.close();
    db = new DatabaseSync(path);
    const first = db.prepare('SELECT * FROM sessions ORDER BY id').all();
    assert.equal(first.length, 3);
    assert.equal(
      first.find((s) => s.id === 'original').codexConversationId,
      '12345678-1234-5678-9012-123456789012',
    );
    assert.equal(first.find((s) => s.id === 'original').legacyRunId, 'old-run');
    assert.equal(
      first.find((s) => s.id === 'deleted-run').error,
      'Saved error',
    );
    const queued = first.find((s) => s.id === 'queued-run');
    assert.equal(queued.status, 'queued');
    assert.equal(JSON.parse(queued.snapshot).settings.permissions, 'read-only');
    assert.equal(
      db.prepare('SELECT enabled FROM schedules WHERE id=1').get().enabled,
      0,
    );
    assert.equal(
      db.prepare('SELECT prompt FROM schedule_steps WHERE scheduleId=1').get()
        .prompt,
      'Review',
    );
    const history = db
      .prepare(
        "SELECT item FROM session_items WHERE sessionId='original' ORDER BY position",
      )
      .all()
      .map((i) => JSON.parse(i.item));
    assert.deepEqual(
      history.map((i) => i.text),
      ['Review', 'Saved output', 'Saved result'],
    );
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE name IN ('jobs','runs','run_events')",
        )
        .all().length,
      0,
    );
    await stat(path + '.before-session-schedules.sqlite');
    await stat(path + '.before-schedule-steps.sqlite');
    assert.equal(
      db.prepare('SELECT name FROM schedule_steps WHERE scheduleId=1').get()
        .name,
      'Session 1',
    );
    assert.equal(queued.occurrenceId, queued.id);
    assert.equal(queued.stepIndex, 0);
    assert.equal(queued.stepName, 'Session 1');
    migrate();
    assert.deepEqual(
      db.prepare('SELECT * FROM sessions ORDER BY id').all(),
      first,
    );
    assert.equal(
      db.prepare('SELECT COUNT(*) AS n FROM session_items').get().n,
      5,
    );
    const { migrateSchedules } = await import('../src/lib/migrateSchedules.ts');
    const broken = new DatabaseSync(path + '.before-session-schedules.sqlite');
    try {
      broken
        .prepare("UPDATE runs SET snapshot='invalid-json' WHERE id='old-run'")
        .run();
      assert.throws(() =>
        migrateSchedules(broken, path + '.before-session-schedules.sqlite'),
      );
      assert.equal(broken.prepare('SELECT COUNT(*) AS n FROM runs').get().n, 3);
      assert.equal(
        broken
          .prepare('PRAGMA table_info(sessions)')
          .all()
          .some((c) => c.name === 'source'),
        false,
      );
      assert.equal(broken.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    } finally {
      broken.close();
    }
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('ordered-session migration rolls back all schema changes on invalid legacy data', async () => {
  const { migrateScheduleSteps } =
    await import('../src/lib/migrateScheduleSteps.ts');
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE agents(id INTEGER PRIMARY KEY);
      CREATE TABLE schedules(id INTEGER PRIMARY KEY,agentId INTEGER,provider TEXT,prompt TEXT,settings TEXT,timeoutMinutes INTEGER);
      CREATE TABLE sessions(id TEXT PRIMARY KEY,source TEXT,scheduleId INTEGER,scheduledFor TEXT);
      INSERT INTO schedules VALUES(1,NULL,'invalid-provider','Keep prompt','{}',30);
      INSERT INTO sessions VALUES('saved','schedule',1,'2026-01-01');`);
    assert.throws(() => migrateScheduleSteps(db, ':memory:'));
    assert.equal(
      db.prepare('SELECT prompt FROM schedules').get().prompt,
      'Keep prompt',
    );
    assert.equal(db.prepare('SELECT id FROM sessions').get().id, 'saved');
    assert.equal(
      db
        .prepare("SELECT name FROM sqlite_master WHERE name='schedule_steps'")
        .get(),
      undefined,
    );
    assert.ok(
      !db
        .prepare('PRAGMA table_info(sessions)')
        .all()
        .some((column) => column.name === 'stepIndex'),
    );
  } finally {
    db.close();
  }
});
