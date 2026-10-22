import {
  bodyObject,
  positiveId,
  RequestError,
  textField,
} from '../../lib/http/errors.js';
import { cronDates, validTimezone } from '../../lib/scheduling/cron.js';
import { findProject } from '../../repositories/projects.js';
import { findAgent } from '../../services/agents.js';
import { validateChatSettings } from '../../services/chatSettings.js';
import { workingDirectory } from '../../lib/directories.js';
import type {
  Schedule,
  ScheduleInput,
  ScheduleStepInput,
} from '../../repositories/schedules.js';
export async function validateSchedule(
  body: unknown,
  old?: Schedule,
  now = new Date(),
) {
  const value = bodyObject(body);
  const projectId =
    value.projectId === undefined || value.projectId === null
      ? null
      : positiveId(value.projectId, 'project');
  if (projectId !== null && !findProject(projectId))
    throw new RequestError(404, 'Project not found.');
  const definitions =
    value.steps === undefined ? [{ ...value, name: 'Session 1' }] : value.steps;
  if (
    !Array.isArray(definitions) ||
    definitions.length < 1 ||
    definitions.length > 20
  )
    throw new RequestError(400, 'Add between 1 and 20 sessions.');
  const steps: ScheduleStepInput[] = [];
  for (const definition of definitions) {
    const value = bodyObject(definition);
    const agentId =
      value.agentId === null || value.agentId === undefined
        ? null
        : positiveId(value.agentId, 'agent');
    const agent = agentId === null ? undefined : findAgent(agentId);
    if (agentId !== null && !agent)
      throw new RequestError(404, 'Agent not found.');
    const provider = value.provider ?? 'codex';
    if (
      provider !== 'codex' &&
      provider !== 'antigravity' &&
      provider !== 'opencode'
    )
      throw new RequestError(400, 'Choose a valid provider.');
    const directory = await workingDirectory(value.workingDirectory);
    const prompt = textField(value.prompt, 'a prompt', 20000);
    const settings = await validateChatSettings(
      value.settings ?? {
        model: null,
        effort: null,
        permissions: 'workspace-write',
      },
      provider,
      directory,
    );
    const timeoutMinutes = value.timeoutMinutes ?? 30;
    if (
      typeof timeoutMinutes !== 'number' ||
      !Number.isInteger(timeoutMinutes) ||
      timeoutMinutes < 1 ||
      timeoutMinutes > 1440
    )
      throw new RequestError(400, 'Timeout must be 1–1,440 minutes.');
    steps.push({
      name: textField(value.name, 'a session name', 100),
      workingDirectory: directory,
      agentId,
      provider,
      prompt,
      settings,
      timeoutMinutes,
    });
  }
  const name = textField(value.name, 'a schedule name', 100);
  const kind = value.kind;
  if (kind !== 'once' && kind !== 'cron')
    throw new RequestError(400, 'Choose a one-time or cron schedule.');
  const timezone = textField(value.timezone, 'a timezone', 100);
  if (!validTimezone(timezone))
    throw new RequestError(400, 'Choose a valid IANA timezone.');
  const enabled = value.enabled ?? true;
  if (typeof enabled !== 'boolean')
    throw new RequestError(400, 'Enabled must be true or false.');
  let runAt: string | null = null;
  let cron: string | null = null;
  let dates: string[];
  if (kind === 'once') {
    if (
      typeof value.runAt !== 'string' ||
      !/(Z|[+-]\d{2}:\d{2})$/.test(value.runAt) ||
      !Number.isFinite(Date.parse(value.runAt))
    )
      throw new RequestError(
        400,
        'Choose a valid date and time with a timezone.',
      );
    runAt = new Date(value.runAt).toISOString();
    const unchanged = old?.kind === 'once' && old.runAt === runAt;
    if (!unchanged && Date.parse(runAt) <= now.getTime())
      throw new RequestError(400, 'Choose a future date and time.');
    dates = [runAt];
  } else {
    cron = textField(value.cron, 'a cron expression', 200);
    try {
      dates = cronDates(cron, timezone, now);
    } catch (error) {
      throw new RequestError(
        400,
        error instanceof Error ? error.message : 'Invalid cron expression.',
      );
    }
  }
  const unchanged =
    old?.kind === kind &&
    old.cron === cron &&
    old.runAt === runAt &&
    old.timezone === timezone;
  const completed = Boolean(unchanged && old?.completed);
  const input: ScheduleInput = {
    projectId,
    steps,
    name,
    kind,
    runAt,
    cron,
    timezone,
    enabled: completed ? false : enabled,
  };
  return {
    input,
    dates,
    completed,
    nextRunAt: completed ? null : unchanged ? old!.nextRunAt : dates[0],
  };
}
