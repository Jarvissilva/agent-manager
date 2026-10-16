import { database } from '../lib/database.js';
import type { ChatSettings } from '../lib/providers/types.js';

export type SessionSnapshot = {
  provider: SessionInfo['provider'];
  projectName: string | null;
  workingDirectory: string;
  agentId: number | null;
  agentName: string | null;
  instructions: string | null;
  skills: {
    id: number;
    name: string;
    nativeName?: string;
    description?: string;
    path?: string;
    instructions?: string; // Legacy snapshots retain their original text.
  }[];
  prompt: string;
  settings: ChatSettings;
  timeoutMinutes: number;
};

export type SessionInfo = {
  occurrenceId?: string | null;
  stepIndex?: number | null;
  stepName?: string | null;
  source?: 'manual' | 'schedule';
  scheduleId?: number | null;
  scheduleName?: string | null;
  scheduledFor?: string | null;
  createdAt?: string;
  snapshot?: SessionSnapshot;
  outcome?:
    | 'succeeded'
    | 'failed'
    | 'cancelled'
    | 'timed_out'
    | 'interrupted'
    | 'skipped'
    | null;
  error?: string | null;
  result?: string | null;
  legacyRunId?: string | null;
  id: string;
  name: string | null;
  projectId: number | null;
  workingDirectory: string;
  provider: 'codex' | 'antigravity' | 'opencode';
  providerConversationId?: string | null;
  status: 'queued' | 'running' | 'stopping' | 'exited' | 'interrupted';
  startedAt: string;
  endedAt: string | null;
  exitCode: number | null;
  codexConversationId: string | null;
  resumedFrom: string | null;
  lastResumedAt: string | null;
  agentId: number | null;
  agentName: string | null;
  agentInstructions: string | null;
  mode: 'interactive' | 'exec';
  transport?: 'terminal' | 'chat';
  chatSettings?: ChatSettings;
};

const insertStatement = database.prepare(`
  INSERT INTO sessions (id, projectId, provider, status, startedAt, codexConversationId, resumedFrom, agentId, agentName, agentInstructions, mode, transport, providerConversationId,chatSettings,source,scheduleId,scheduleName,scheduledFor,createdAt,snapshot,occurrenceId,stepIndex,stepName,workingDirectory,name)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
const updateSession = database.prepare(
  'UPDATE sessions SET status = ?, endedAt = ?, exitCode = ?, codexConversationId = ?, lastResumedAt = ?, transport = ?, chatSettings = ?, providerConversationId = ?, outcome = ?, error = ?, result = ?, startedAt = ? WHERE id = ?',
);
const projectHistory = database.prepare(
  'SELECT * FROM sessions WHERE projectId = ? AND resumedFrom IS NULL ORDER BY COALESCE(lastResumedAt, startedAt) DESC, rowid DESC',
);

export function insertSession(info: SessionInfo) {
  insertStatement.run(
    info.id,
    info.projectId,
    info.provider,
    info.status,
    info.startedAt,
    info.codexConversationId,
    info.resumedFrom,
    info.agentId,
    info.agentName,
    info.agentInstructions,
    info.mode,
    info.transport ?? 'chat',
    info.providerConversationId ?? null,
    JSON.stringify(info.chatSettings ?? null),
    info.source ?? 'manual',
    info.scheduleId ?? null,
    info.scheduleName ?? null,
    info.scheduledFor ?? null,
    info.createdAt ?? info.startedAt,
    info.snapshot ? JSON.stringify(info.snapshot) : null,
    info.occurrenceId ?? null,
    info.stepIndex ?? null,
    info.stepName ?? null,
    info.workingDirectory,
    info.name,
  );
}

function sessionRow(row: Record<string, unknown>): SessionInfo {
  return {
    ...row,
    ...(row.snapshot ? { snapshot: JSON.parse(String(row.snapshot)) } : {}),
    chatSettings: row.chatSettings
      ? JSON.parse(String(row.chatSettings))
      : undefined,
  } as SessionInfo;
}

export function listUnfinishedSessions() {
  return database
    .prepare("SELECT * FROM sessions WHERE status IN ('running', 'stopping')")
    .all()
    .map(sessionRow);
}

export function recoverSessionHistory() {
  database
    .prepare(
      `
  UPDATE sessions SET status = 'interrupted', endedAt = ?, outcome = CASE WHEN source='schedule' AND outcome IS NULL THEN 'interrupted' ELSE outcome END, error = CASE WHEN source='schedule' AND outcome IS NULL THEN 'Server stopped before execution finished.' ELSE error END
  WHERE status IN ('running', 'stopping')
`,
    )
    .run(new Date().toISOString());

  // Keep old launch records in SQLite, but fold their latest state into the
  // original session. Repeated startups must not overwrite a newer resume.
  for (const row of database
    .prepare(
      'SELECT * FROM sessions WHERE resumedFrom IS NOT NULL ORDER BY startedAt ASC, rowid ASC',
    )
    .all()) {
    const copy = row as unknown as SessionInfo;
    const original = findSavedSession(copy.projectId, copy.id);
    if (
      !original ||
      original.id === copy.id ||
      original.codexConversationId !== copy.codexConversationId
    )
      continue;
    const resumedAt = copy.lastResumedAt ?? copy.startedAt;
    if (resumedAt <= (original.lastResumedAt ?? original.startedAt)) continue;
    saveSession({
      ...original,
      status: copy.status,
      endedAt: copy.endedAt,
      exitCode: copy.exitCode,
      lastResumedAt: resumedAt,
    });
  }
}

export function listSessions(projectId?: number) {
  return (
    projectId === undefined
      ? database
          .prepare(
            'SELECT * FROM sessions WHERE resumedFrom IS NULL ORDER BY COALESCE(lastResumedAt, startedAt) DESC, rowid DESC',
          )
          .all()
      : projectHistory.all(projectId)
  ).map(sessionRow);
}

export function findSessionById(id: string) {
  const row = database.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
  return row ? sessionRow(row) : undefined;
}

export function sessionAliases(id: string) {
  return database
    .prepare(
      `WITH RECURSIVE aliases(id) AS (SELECT ? UNION SELECT sessions.id FROM sessions JOIN aliases ON sessions.resumedFrom=aliases.id) SELECT sessions.* FROM sessions JOIN aliases ON sessions.id=aliases.id`,
    )
    .all(id)
    .map(sessionRow);
}

export function deleteSessionRecords(id: string) {
  database
    .prepare(
      `WITH RECURSIVE aliases(id) AS (SELECT ? UNION SELECT sessions.id FROM sessions JOIN aliases ON sessions.resumedFrom=aliases.id) DELETE FROM sessions WHERE id IN (SELECT id FROM aliases)`,
    )
    .run(id);
}

export function findSavedSession(projectId: number | null, id: string) {
  const find = database.prepare(
    'SELECT * FROM sessions WHERE projectId IS ? AND id = ?',
  );
  const row = find.get(projectId, id);
  let saved = row ? sessionRow(row) : undefined;
  const visited = new Set<string>();
  while (saved?.resumedFrom) {
    if (visited.has(saved.id)) return undefined;
    visited.add(saved.id);
    const originalRow = find.get(projectId, saved.resumedFrom);
    const original = originalRow ? sessionRow(originalRow) : undefined;
    if (!original || original.codexConversationId !== saved.codexConversationId)
      return undefined;
    saved = original;
  }
  return saved;
}

export function saveSession(info: SessionInfo) {
  updateSession.run(
    info.status,
    info.endedAt,
    info.exitCode,
    info.codexConversationId,
    info.lastResumedAt,
    info.transport ?? 'chat',
    JSON.stringify(info.chatSettings ?? null),
    info.providerConversationId ?? null,
    info.outcome ?? null,
    info.error ?? null,
    info.result ?? null,
    info.startedAt,
    info.id,
  );
}

export function queuedSessions() {
  return database
    .prepare(
      "SELECT * FROM sessions WHERE status='queued' ORDER BY createdAt,rowid",
    )
    .all()
    .map(sessionRow);
}
export function queuedSessionCount(projectId: number) {
  return Number(
    database
      .prepare(
        "SELECT COUNT(*) AS count FROM sessions WHERE projectId=? AND status='queued'",
      )
      .get(projectId)!.count,
  );
}
export function scheduleSessions(scheduleId: number) {
  return database
    .prepare(
      'SELECT * FROM sessions WHERE scheduleId=? ORDER BY createdAt DESC,occurrenceId,stepIndex,rowid DESC',
    )
    .all(scheduleId)
    .map(sessionRow);
}
export function legacySession(id: string) {
  const row = database
    .prepare('SELECT * FROM sessions WHERE legacyRunId=?')
    .get(id);
  return row ? sessionRow(row) : undefined;
}

export function scheduledOccurrence(
  scheduleId: number,
  scheduledFor: string | null,
) {
  const row = database
    .prepare(
      'SELECT * FROM sessions WHERE scheduleId=? AND scheduledFor=? ORDER BY stepIndex LIMIT 1',
    )
    .get(scheduleId, scheduledFor);
  return row ? sessionRow(row) : undefined;
}

export function occurrenceSessions(occurrenceId: string) {
  return database
    .prepare('SELECT * FROM sessions WHERE occurrenceId=? ORDER BY stepIndex')
    .all(occurrenceId)
    .map(sessionRow);
}
export function skipFollowingSessions(info: SessionInfo) {
  if (
    !info.occurrenceId ||
    info.stepIndex === null ||
    info.stepIndex === undefined
  )
    return;
  database
    .prepare(
      "UPDATE sessions SET status='exited',outcome='skipped',endedAt=?,error=? WHERE occurrenceId=? AND stepIndex>? AND status='queued'",
    )
    .run(
      new Date().toISOString(),
      `Skipped because ${info.stepName ?? 'the previous session'} ${info.outcome ?? 'did not succeed'}.`,
      info.occurrenceId,
      info.stepIndex,
    );
}

export function updateSessionProject(id: string, projectId: number | null) {
  database
    .prepare(
      `WITH RECURSIVE aliases(id) AS (SELECT ? UNION SELECT sessions.id FROM sessions JOIN aliases ON sessions.resumedFrom=aliases.id) UPDATE sessions SET projectId=? WHERE id IN (SELECT id FROM aliases)`,
    )
    .run(id, projectId);
  return findSessionById(id)!;
}

export function renameSession(id: string, name: string) {
  database
    .prepare(
      `WITH RECURSIVE aliases(id) AS (SELECT ? UNION SELECT sessions.id FROM sessions JOIN aliases ON sessions.resumedFrom=aliases.id) UPDATE sessions SET name=? WHERE id IN (SELECT id FROM aliases)`,
    )
    .run(id, name);
  return findSessionById(id)!;
}

export function nameSessionFromPrompt(id: string, prompt: string) {
  const name = prompt.replace(/\s+/g, ' ').trim().slice(0, 100);
  database
    .prepare('UPDATE sessions SET name=? WHERE id=? AND name IS NULL')
    .run(name, id);
  return findSessionById(id)!;
}
