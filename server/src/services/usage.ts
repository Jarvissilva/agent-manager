import { database } from '../lib/database.js';
import { getSettings } from '../repositories/settings.js';
import {
  addCounters,
  usageRecords,
  type TokenCounters,
} from '../repositories/usage.js';
import { RequestError } from '../lib/http/errors.js';

let dayFormatter:
  { timezone: string; formatter: Intl.DateTimeFormat } | undefined;
export function localDay(value: string, timezone: string) {
  if (dayFormatter?.timezone !== timezone)
    dayFormatter = {
      timezone,
      formatter: new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }),
    };
  const parts = dayFormatter.formatter.formatToParts(new Date(value));
  return ['year', 'month', 'day']
    .map((type) => parts.find((part) => part.type === type)!.value)
    .join('-');
}
export function usageReport(query: Record<string, unknown>) {
  const timezone = getSettings().timezone;
  const today = localDay(new Date().toISOString(), timezone);
  const before = new Date(`${today}T00:00:00Z`);
  before.setUTCDate(before.getUTCDate() - 29);
  const from = query.from ?? before.toISOString().slice(0, 10),
    to = query.to ?? today;
  for (const date of [from, to])
    if (
      typeof date !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date
    )
      throw new RequestError(400, 'Choose valid report dates.');
  if (
    String(from) > String(to) ||
    (Date.parse(String(to)) - Date.parse(String(from))) / 86400000 > 366
  )
    throw new RequestError(400, 'Choose a date range of up to one year.');
  for (const field of ['provider', 'model', 'agentId', 'sessionId'])
    if (
      query[field] !== undefined &&
      (typeof query[field] !== 'string' || String(query[field]).length > 200)
    )
      throw new RequestError(400, 'Invalid usage filter.');
  if (
    query.provider &&
    !['codex', 'opencode', 'antigravity'].includes(String(query.provider))
  )
    throw new RequestError(400, 'Invalid provider.');
  if (
    query.agentId &&
    query.agentId !== 'none' &&
    !/^[1-9]\d*$/.test(String(query.agentId))
  )
    throw new RequestError(400, 'Invalid agent.');
  const matches = (row: Record<string, unknown>) => {
    const day = localDay(String(row.observedAt), timezone);
    return (
      day >= String(from) &&
      day <= String(to) &&
      (!query.provider || row.provider === query.provider) &&
      (!query.agentId ||
        (query.agentId === 'none'
          ? row.agentId === null
          : String(row.agentId) === query.agentId)) &&
      (!query.model || row.model === query.model) &&
      (!query.sessionId || row.sessionId === query.sessionId)
    );
  };
  // Expand by a day on either side, then apply the exact saved-timezone dates.
  const lower = new Date(Date.parse(String(from)) - 86400000).toISOString();
  const upper = new Date(Date.parse(String(to)) + 2 * 86400000).toISOString();
  const rows = usageRecords(
    typeof query.sessionId === 'string' ? query.sessionId : undefined,
    { from: lower, to: upper },
  ).filter(matches);
  const turns = database
    .prepare(
      `SELECT * FROM usage_turns WHERE (observedAt>=? AND observedAt<?) OR EXISTS (
    SELECT 1 FROM usage_records r WHERE r.sessionId=usage_turns.sessionId AND r.turnId=usage_turns.turnId AND r.observedAt>=? AND r.observedAt<?
  )`,
    )
    .all(lower, upper, lower, upper);
  const turnKey = (row: Record<string, unknown>) =>
    JSON.stringify([row.sessionId, row.turnId]);
  const recordedTurns = new Set(rows.map(turnKey));
  const missingTurns = turns.filter(
    (turn) => matches(turn) && !recordedTurns.has(turnKey(turn)),
  ).length;
  const partialTurns = turns.filter(
    (turn) =>
      (!turn.complete || turn.partial) && recordedTurns.has(turnKey(turn)),
  ).length;
  const daily = new Map<string, TokenCounters[]>();
  const start = new Date(`${from}T00:00:00Z`),
    end = new Date(`${to}T00:00:00Z`);
  for (
    let date = start;
    date <= end;
    date = new Date(date.getTime() + 86400000)
  )
    daily.set(date.toISOString().slice(0, 10), []);
  for (const row of rows)
    daily.get(localDay(row.observedAt, timezone))!.push(row.counters);
  const groups = new Map<
    string,
    {
      provider: string;
      agentId: number | null;
      agentName: string | null;
      model: string | null;
      counters: TokenCounters[];
      sessions: Set<string>;
    }
  >();
  for (const row of rows) {
    const key = JSON.stringify([
      row.provider,
      row.agentId,
      row.agentName,
      row.model,
    ]);
    let group = groups.get(key);
    if (!group) {
      group = { ...row, counters: [], sessions: new Set() };
      groups.set(key, group);
    }
    group.counters.push(row.counters);
    group.sessions.add(row.sessionId);
  }
  const historical = database
    .prepare(
      `SELECT id AS sessionId,provider,agentId,chatSettings,startedAt AS observedAt FROM sessions WHERE resumedFrom IS NULL AND NOT EXISTS(SELECT 1 FROM usage_turns WHERE sessionId=sessions.id)`,
    )
    .all()
    .filter((row) =>
      matches({
        ...row,
        model: JSON.parse(String(row.chatSettings ?? 'null'))?.model ?? null,
      }),
    ).length;
  const counters = addCounters(rows.map((row) => row.counters));
  return {
    timezone,
    from: String(from),
    to: String(to),
    ...counters,
    coverage: !rows.length
      ? 'unavailable'
      : missingTurns ||
          partialTurns ||
          historical ||
          rows.some(
            (row) =>
              row.counters.input === null ||
              row.counters.output === null ||
              row.counters.total === null,
          )
        ? 'partial'
        : 'reported',
    missingTurns,
    partialTurns,
    unavailableSessions: historical,
    daily: [...daily].map(([day, values]) => ({ day, ...addCounters(values) })),
    breakdown: [...groups.values()]
      .map((group) => ({
        provider: group.provider,
        agentId: group.agentId,
        agentName: group.agentName,
        model: group.model,
        sessions: group.sessions.size,
        ...addCounters(group.counters),
      }))
      .sort((a, b) => (b.total ?? 0) - (a.total ?? 0)),
    agents: database
      .prepare(
        'SELECT agentId AS id, MAX(agentName) AS name FROM usage_turns WHERE agentId IS NOT NULL GROUP BY agentId ORDER BY name',
      )
      .all()
      .map((row) => ({
        id: Number(row.id),
        name: String(row.name ?? 'Deleted agent'),
      })),
    models: database
      .prepare(
        'SELECT DISTINCT model FROM usage_records WHERE model IS NOT NULL ORDER BY model',
      )
      .all()
      .map((row) => String(row.model)),
  };
}
