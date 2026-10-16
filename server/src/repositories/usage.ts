import { database } from '../lib/database.js';
import type { SessionInfo } from './sessions.js';

export type TokenCounters = {
  input: number | null;
  output: number | null;
  total: number | null;
  cached: number | null;
  cacheWrite: number | null;
  reasoning: number | null;
};
export const emptyCounters = (): TokenCounters => ({
  input: null,
  output: null,
  total: null,
  cached: null,
  cacheWrite: null,
  reasoning: null,
});
export const count = (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export function normalizeUsage(
  provider: SessionInfo['provider'],
  value: unknown,
): TokenCounters {
  const raw = object(value);
  if (provider === 'codex')
    return {
      input: count(raw.inputTokens),
      output: count(raw.outputTokens),
      total: count(raw.totalTokens),
      cached: count(raw.cachedInputTokens),
      cacheWrite: count(raw.cacheWriteInputTokens),
      reasoning: count(raw.reasoningOutputTokens),
    };
  if (provider === 'antigravity')
    return {
      input: count(raw.input_tokens),
      output: count(raw.output_tokens),
      total: count(raw.total_tokens),
      cached: count(raw.cache_read_tokens),
      cacheWrite: null,
      reasoning: count(raw.thinking_tokens),
    };
  const cache = object(raw.cache);
  const input = count(raw.input),
    output = count(raw.output),
    cached = count(cache.read),
    cacheWrite = count(cache.write);
  // OpenCode reports uncached input and visible output separately from cache
  // reads/writes and reasoning. Normalize them to inclusive input/output totals.
  const fullInput =
    input === null || cached === null || cacheWrite === null
      ? null
      : input + cached + cacheWrite;
  const reasoning = count(raw.reasoning);
  const fullOutput =
    output === null || reasoning === null ? null : output + reasoning;
  return {
    input: fullInput,
    output: fullOutput,
    total:
      count(raw.total) ??
      (fullInput !== null && fullOutput !== null
        ? fullInput + fullOutput
        : null),
    cached,
    cacheWrite,
    reasoning,
  };
}
export function addCounters(values: TokenCounters[]): TokenCounters {
  const result = emptyCounters();
  for (const key of Object.keys(result) as (keyof TokenCounters)[]) {
    const known = values
      .map((value) => value[key])
      .filter((value) => value !== null);
    result[key] = known.length
      ? known.reduce((sum, value) => sum + value, 0)
      : null;
  }
  return result;
}
export type UsageRecord = {
  sessionId: string;
  sourceKey: string;
  turnId: string;
  provider: SessionInfo['provider'];
  agentId: number | null;
  agentName: string | null;
  model: string | null;
  observedAt: string;
  counters: TokenCounters;
};
export function usageRecords(
  sessionId?: string,
  range?: { from: string; to: string },
): UsageRecord[] {
  const conditions: string[] = [];
  const parameters: string[] = [];
  if (sessionId) {
    conditions.push('sessionId=?');
    parameters.push(sessionId);
  }
  if (range) {
    conditions.push('observedAt>=? AND observedAt<?');
    parameters.push(range.from, range.to);
  }
  const rows = database
    .prepare(
      `SELECT * FROM usage_records${conditions.length ? ` WHERE ${conditions.join(' AND ')}` : ''}`,
    )
    .all(...parameters);
  return rows.map((row) => ({
    sessionId: String(row.sessionId),
    sourceKey: String(row.sourceKey),
    turnId: String(row.turnId),
    provider: row.provider as SessionInfo['provider'],
    agentId: row.agentId === null ? null : Number(row.agentId),
    agentName: row.agentName === null ? null : String(row.agentName),
    model: row.model === null ? null : String(row.model),
    observedAt: String(row.observedAt),
    counters: JSON.parse(String(row.counters)) as TokenCounters,
  }));
}
function agentSnapshot(info: SessionInfo) {
  const first = database
    .prepare(
      'SELECT agentId,agentName FROM usage_turns WHERE sessionId=? ORDER BY observedAt LIMIT 1',
    )
    .get(info.id);
  return first
    ? {
        id: first.agentId === null ? null : Number(first.agentId),
        name: first.agentName === null ? null : String(first.agentName),
      }
    : { id: info.agentId, name: info.agentName };
}
export function beginUsage(
  info: SessionInfo,
  turnId: string,
  model = info.chatSettings?.model ?? null,
) {
  const agent = agentSnapshot(info);
  database
    .prepare(
      'INSERT OR IGNORE INTO usage_turns(sessionId,turnId,provider,agentId,agentName,model,observedAt) VALUES(?,?,?,?,?,?,?)',
    )
    .run(
      info.id,
      turnId,
      info.provider,
      agent.id,
      agent.name,
      model,
      new Date().toISOString(),
    );
}
export function markUsagePartial(sessionId: string, turnId: string) {
  database
    .prepare('UPDATE usage_turns SET partial=1 WHERE sessionId=? AND turnId=?')
    .run(sessionId, turnId);
}
export function finishUsage(
  sessionId: string,
  turnId: string,
  complete: boolean,
) {
  database
    .prepare('UPDATE usage_turns SET complete=? WHERE sessionId=? AND turnId=?')
    .run(complete ? 1 : 0, sessionId, turnId);
}
export function saveUsage(
  info: SessionInfo,
  sourceKey: string,
  turnId: string,
  counters: TokenCounters,
  raw: unknown,
  model = info.chatSettings?.model ?? null,
  observedAt = new Date().toISOString(),
) {
  if (Object.values(counters).every((value) => value === null)) return;
  const agent = agentSnapshot(info);
  database
    .prepare(
      `INSERT INTO usage_records(sessionId,sourceKey,turnId,provider,agentId,agentName,model,observedAt,counters,raw) VALUES(?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(sessionId,sourceKey) DO UPDATE SET counters=excluded.counters,raw=excluded.raw,model=COALESCE(excluded.model,usage_records.model)`,
    )
    .run(
      info.id,
      sourceKey,
      turnId,
      info.provider,
      agent.id,
      agent.name,
      model,
      observedAt,
      JSON.stringify(counters),
      JSON.stringify(raw),
    );
}
export function usageSummary(sessionId: string) {
  const rows = usageRecords(sessionId);
  const turns = database
    .prepare(
      'SELECT turnId,complete,partial FROM usage_turns WHERE sessionId=?',
    )
    .all(sessionId);
  const counters = addCounters(rows.map((row) => row.counters));
  return {
    ...counters,
    coverage: !rows.length
      ? ('unavailable' as const)
      : turns.some(
            (turn) =>
              !turn.complete ||
              turn.partial ||
              !rows.some((row) => row.turnId === turn.turnId),
          ) ||
          rows.some(
            (row) =>
              row.counters.input === null ||
              row.counters.output === null ||
              row.counters.total === null,
          )
        ? ('partial' as const)
        : ('reported' as const),
  };
}

// A persisted cumulative baseline prevents replayed thread totals being charged
// again. For a pre-tracking conversation, only the last response is recoverable.
export function saveCumulativeUsage(
  info: SessionInfo,
  sourceKey: string,
  turnId: string,
  raw: unknown,
  lastRaw: unknown,
  model: string | null,
  resumed: boolean,
) {
  const current = normalizeUsage(info.provider, raw),
    last = normalizeUsage(info.provider, lastRaw);
  if (current.total === null) return;
  const checkpoint = database
    .prepare(
      'SELECT counters FROM usage_checkpoints WHERE sessionId=? AND source=?',
    )
    .get(info.id, sourceKey);
  const previous = checkpoint
    ? (JSON.parse(String(checkpoint.counters)) as TokenCounters)
    : null;
  // Thread totals are monotonic. Ignore duplicates and stale notifications.
  if (
    previous?.total !== null &&
    previous?.total !== undefined &&
    current.total <= previous.total
  )
    return;
  const tracked = Boolean(
    turnId &&
    database
      .prepare('SELECT 1 FROM usage_turns WHERE sessionId=? AND turnId=?')
      .get(info.id, turnId),
  );
  const delta = emptyCounters();
  for (const key of Object.keys(delta) as (keyof TokenCounters)[]) {
    const now = current[key],
      before = previous?.[key] ?? null;
    delta[key] =
      now === null
        ? null
        : before !== null && now >= before
          ? now - before
          : resumed
            ? last[key]
            : now;
  }
  database.exec('SAVEPOINT usage_update');
  try {
    if (tracked) {
      // Each cumulative advance becomes one immutable delta, so a long turn
      // crossing midnight contributes to the day each update was recorded.
      const recordKey = `${turnId}:${model ?? 'unknown'}:${current.total}`;
      if (!previous && resumed) markUsagePartial(info.id, turnId);
      saveUsage(
        info,
        recordKey,
        turnId,
        delta,
        { total: raw, last: lastRaw },
        model,
      );
    }
    database
      .prepare(
        'INSERT INTO usage_checkpoints(sessionId,source,counters) VALUES(?,?,?) ON CONFLICT(sessionId,source) DO UPDATE SET counters=excluded.counters',
      )
      .run(info.id, sourceKey, JSON.stringify(current));
    database.exec('RELEASE usage_update');
  } catch (error) {
    database.exec('ROLLBACK TO usage_update; RELEASE usage_update');
    throw error;
  }
}
