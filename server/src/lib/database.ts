import { migrateOptionalProjects } from './migrateOptionalProjects.js';
import { migrateSessionDirectories } from './migrateSessionDirectories.js';
import { migrateScheduleSteps } from './migrateScheduleSteps.js';
import { removeConnectors } from './removeConnectors.js';
import { migrateSchedules } from './migrateSchedules.js';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const databasePath = resolve(
  process.env.AGENT_MANAGER_DB_PATH ??
    resolve(import.meta.dirname, '../../data/agent-manager.sqlite'),
);

mkdirSync(dirname(databasePath), { recursive: true });

export const database = new DatabaseSync(databasePath);
database.exec('PRAGMA foreign_keys = ON');

database.exec(`
  CREATE TABLE IF NOT EXISTS agents (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    provider TEXT NOT NULL CHECK (provider IN ('codex', 'antigravity', 'opencode')),
    instructions TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )
`);

database.exec(`
  CREATE TABLE IF NOT EXISTS skills (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    instructions TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS agent_skills (
    agentId INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    skillId INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    PRIMARY KEY (agentId, skillId)
  );
`);

// Preserve legacy text while native files are migrated successfully.
const skillColumns = database.prepare('PRAGMA table_info(skills)').all();
for (const [name, definition] of [
  ['nativeName', 'TEXT'],
  ['description', 'TEXT'],
  ['source', "TEXT NOT NULL DEFAULT 'managed'"],
  ['path', 'TEXT'],
] as const) {
  if (!skillColumns.some((column) => column.name === name))
    database.exec(`ALTER TABLE skills ADD COLUMN ${name} ${definition}`);
}
database.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS skills_native_name ON skills(nativeName);
  CREATE TABLE IF NOT EXISTS skill_publications (
    skillId INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    path TEXT PRIMARY KEY,
    target TEXT NOT NULL,
    mode TEXT NOT NULL,
    owner TEXT NOT NULL
  );
`);

database.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE
  )
`);

database.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    projectId INTEGER NOT NULL REFERENCES projects(id),
    provider TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('running', 'stopping', 'exited', 'interrupted')),
    startedAt TEXT NOT NULL,
    endedAt TEXT,
    exitCode INTEGER
  );
  CREATE INDEX IF NOT EXISTS sessions_project_started ON sessions(projectId, startedAt DESC);
`);

// Rebuild the original single-provider table while preserving its IDs and links.
const agentSchema = database
  .prepare("SELECT sql FROM sqlite_master WHERE name = 'agents'")
  .get();
if (!String(agentSchema?.sql).includes("'opencode'")) {
  database.exec('PRAGMA foreign_keys = OFF');
  try {
    database.exec(`BEGIN;
      CREATE TABLE agents_new (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        provider TEXT NOT NULL CHECK (provider IN ('codex', 'antigravity', 'opencode')),
        instructions TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL
      );
      INSERT INTO agents_new SELECT * FROM agents;
      DROP TABLE agents;
      ALTER TABLE agents_new RENAME TO agents;
      COMMIT;`);
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  } finally {
    database.exec('PRAGMA foreign_keys = ON');
  }
}

const sessionColumns = database.prepare('PRAGMA table_info(sessions)').all();
if (
  !sessionColumns.some((column) => column.name === 'providerConversationId')
) {
  database.exec('ALTER TABLE sessions ADD COLUMN providerConversationId TEXT');
}
if (!sessionColumns.some((column) => column.name === 'codexConversationId')) {
  database.exec('ALTER TABLE sessions ADD COLUMN codexConversationId TEXT');
}
if (!sessionColumns.some((column) => column.name === 'resumedFrom')) {
  database.exec(
    'ALTER TABLE sessions ADD COLUMN resumedFrom TEXT REFERENCES sessions(id)',
  );
}
if (!sessionColumns.some((column) => column.name === 'lastResumedAt')) {
  database.exec('ALTER TABLE sessions ADD COLUMN lastResumedAt TEXT');
}
if (!sessionColumns.some((column) => column.name === 'agentId')) {
  database.exec(
    'ALTER TABLE sessions ADD COLUMN agentId INTEGER REFERENCES agents(id) ON DELETE SET NULL',
  );
}
if (!sessionColumns.some((column) => column.name === 'agentName')) {
  database.exec('ALTER TABLE sessions ADD COLUMN agentName TEXT');
}
if (!sessionColumns.some((column) => column.name === 'agentInstructions')) {
  database.exec('ALTER TABLE sessions ADD COLUMN agentInstructions TEXT');
}
if (!sessionColumns.some((column) => column.name === 'mode')) {
  database.exec(
    "ALTER TABLE sessions ADD COLUMN mode TEXT NOT NULL DEFAULT 'interactive' CHECK (mode IN ('interactive', 'exec'))",
  );
}
if (!sessionColumns.some((column) => column.name === 'transport')) {
  database.exec(
    "ALTER TABLE sessions ADD COLUMN transport TEXT NOT NULL DEFAULT 'terminal' CHECK (transport IN ('terminal', 'chat'))",
  );
}
if (!sessionColumns.some((column) => column.name === 'chatSettings')) {
  database.exec('ALTER TABLE sessions ADD COLUMN chatSettings TEXT');
}
database.exec(`
  CREATE TABLE IF NOT EXISTS session_items (
    position INTEGER PRIMARY KEY AUTOINCREMENT,
    sessionId TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    itemId TEXT NOT NULL,
    item TEXT NOT NULL,
    UNIQUE(sessionId, itemId)
  );
`);

migrateSchedules(database, databasePath);

removeConnectors(database, databasePath);

migrateScheduleSteps(database, databasePath);

migrateSessionDirectories(database, databasePath);

migrateOptionalProjects(database, databasePath);

if (
  !database
    .prepare('PRAGMA table_info(sessions)')
    .all()
    .some((column) => column.name === 'name')
) {
  database.exec('ALTER TABLE sessions ADD COLUMN name TEXT');
  const updateName = database.prepare('UPDATE sessions SET name=? WHERE id=?');
  for (const row of database
    .prepare(
      `SELECT sessions.id, sessions.stepName,
    (SELECT json_extract(item, '$.text') FROM session_items
     WHERE sessionId=sessions.id AND json_extract(item, '$.role')='user'
     ORDER BY position LIMIT 1) AS prompt FROM sessions`,
    )
    .all()) {
    const text = row.stepName ?? row.prompt;
    if (typeof text === 'string' && text.trim())
      updateName.run(text.replace(/\s+/g, ' ').trim().slice(0, 100), row.id);
  }
}

// Usage is intentionally independent of session/agent foreign keys: deleting
// conversation content must not rewrite historical consumption reports.
database.exec(`
  CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS usage_records (
    sessionId TEXT NOT NULL, sourceKey TEXT NOT NULL, turnId TEXT NOT NULL,
    provider TEXT NOT NULL, agentId INTEGER, agentName TEXT, model TEXT,
    observedAt TEXT NOT NULL, counters TEXT NOT NULL, raw TEXT NOT NULL,
    PRIMARY KEY(sessionId, sourceKey)
  );
  CREATE INDEX IF NOT EXISTS usage_records_date ON usage_records(observedAt);
  CREATE TABLE IF NOT EXISTS usage_turns (
    sessionId TEXT NOT NULL, turnId TEXT NOT NULL, provider TEXT NOT NULL,
    agentId INTEGER, agentName TEXT, model TEXT, observedAt TEXT NOT NULL,
    complete INTEGER NOT NULL DEFAULT 0, partial INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(sessionId, turnId)
  );
  CREATE INDEX IF NOT EXISTS usage_turns_date ON usage_turns(observedAt);
  CREATE INDEX IF NOT EXISTS usage_records_turn ON usage_records(sessionId,turnId);
  CREATE TABLE IF NOT EXISTS usage_checkpoints (
    sessionId TEXT NOT NULL, source TEXT NOT NULL, counters TEXT NOT NULL,
    PRIMARY KEY(sessionId, source)
  );
`);

if (
  !database
    .prepare('PRAGMA table_info(usage_turns)')
    .all()
    .some((column) => column.name === 'partial')
)
  database.exec(
    'ALTER TABLE usage_turns ADD COLUMN partial INTEGER NOT NULL DEFAULT 0',
  );

// Prompt queues belong to saved conversations and are deleted with them.
database.exec(`
  CREATE TABLE IF NOT EXISTS chat_prompt_queue (
    position INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    sessionId TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    prompt TEXT NOT NULL, settings TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('queued','sending','failed')),
    error TEXT, createdAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS chat_prompt_queue_session ON chat_prompt_queue(sessionId,position);
  CREATE TABLE IF NOT EXISTS chat_queue_state (
    sessionId TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    paused INTEGER NOT NULL DEFAULT 0, reason TEXT
  );
`);
if (
  !database
    .prepare('PRAGMA table_info(chat_prompt_queue)')
    .all()
    .some((column) => column.name === 'attachments')
)
  database.exec(
    "ALTER TABLE chat_prompt_queue ADD COLUMN attachments TEXT NOT NULL DEFAULT '[]'",
  );
