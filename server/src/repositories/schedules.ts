import { database } from '../lib/database.js';
import type { AgentProvider, ChatSettings } from '../lib/providers/types.js';
export type ScheduleStepInput = {
  name: string;
  workingDirectory: string;
  agentId: number | null;
  provider: AgentProvider;
  prompt: string;
  settings: ChatSettings;
  timeoutMinutes: number;
};
export type ScheduleInput = {
  name: string;
  projectId: number | null;
  steps: ScheduleStepInput[];
  kind: 'once' | 'cron';
  runAt: string | null;
  cron: string | null;
  timezone: string;
  enabled: boolean;
};
export type Schedule = ScheduleInput & {
  id: number;
  projectName: string | null;
  steps: (ScheduleStepInput & { agentName: string | null })[];
  completed: boolean;
  nextRunAt: string | null;
  lastTriggeredAt: string | null;
  createdAt: string;
  updatedAt: string;
};
const select =
  'SELECT schedules.*,projects.name AS projectName FROM schedules LEFT JOIN projects ON projects.id=schedules.projectId';
function row(value: Record<string, unknown>): Schedule {
  const steps = database
    .prepare(
      'SELECT schedule_steps.*,agents.name AS agentName FROM schedule_steps LEFT JOIN agents ON agents.id=schedule_steps.agentId WHERE scheduleId=? ORDER BY position',
    )
    .all(value.id as number)
    .map((step) => ({
      name: step.name,
      workingDirectory: step.workingDirectory,
      agentId: step.agentId,
      agentName: step.agentName,
      provider: step.provider,
      prompt: step.prompt,
      settings: JSON.parse(String(step.settings)),
      timeoutMinutes: step.timeoutMinutes,
    }));
  return {
    ...value,
    steps,
    enabled: Boolean(value.enabled),
    completed: Boolean(value.completed),
  } as Schedule;
}
export function listSchedules(projectId?: number) {
  return database
    .prepare(
      select +
        (projectId ? ' WHERE schedules.projectId=?' : '') +
        ' ORDER BY schedules.id DESC',
    )
    .all(...(projectId ? [projectId] : []))
    .map(row);
}
export function findSchedule(id: number) {
  const value = database.prepare(select + ' WHERE schedules.id=?').get(id);
  return value ? row(value) : undefined;
}
function values(input: ScheduleInput) {
  return [
    input.name,
    input.projectId,
    input.kind,
    input.runAt,
    input.cron,
    input.timezone,
    Number(input.enabled),
  ];
}
function saveSteps(id: number, steps: ScheduleStepInput[]) {
  database.prepare('DELETE FROM schedule_steps WHERE scheduleId=?').run(id);
  const insert = database.prepare(
    'INSERT INTO schedule_steps(scheduleId,position,name,agentId,provider,prompt,settings,timeoutMinutes,workingDirectory) VALUES(?,?,?,?,?,?,?,?,?)',
  );
  steps.forEach((step, index) =>
    insert.run(
      id,
      index,
      step.name,
      step.agentId,
      step.provider,
      step.prompt,
      JSON.stringify(step.settings),
      step.timeoutMinutes,
      step.workingDirectory,
    ),
  );
}
export function createSchedule(input: ScheduleInput, nextRunAt: string | null) {
  database.exec('BEGIN IMMEDIATE');
  try {
    const now = new Date().toISOString();
    const result = database
      .prepare(
        'INSERT INTO schedules(name,projectId,kind,runAt,cron,timezone,enabled,nextRunAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?,?,?,?,?)',
      )
      .run(...values(input), nextRunAt, now, now);
    const id = Number(result.lastInsertRowid);
    saveSteps(id, input.steps);
    database.exec('COMMIT');
    return findSchedule(id)!;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}
export function updateSchedule(
  id: number,
  input: ScheduleInput,
  nextRunAt: string | null,
  completed = false,
) {
  database.exec('BEGIN IMMEDIATE');
  try {
    database
      .prepare(
        'UPDATE schedules SET name=?,projectId=?,kind=?,runAt=?,cron=?,timezone=?,enabled=?,nextRunAt=?,completed=?,updatedAt=? WHERE id=?',
      )
      .run(
        ...values(input),
        nextRunAt,
        Number(completed),
        new Date().toISOString(),
        id,
      );
    saveSteps(id, input.steps);
    database.exec('COMMIT');
    return findSchedule(id)!;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}
export function deleteSchedule(id: number) {
  database.exec('BEGIN IMMEDIATE');
  try {
    database
      .prepare(
        "UPDATE sessions SET status='exited',outcome='cancelled',endedAt=?,error='Schedule deleted before execution.' WHERE scheduleId=? AND status='queued'",
      )
      .run(new Date().toISOString(), id);
    database.prepare('DELETE FROM schedules WHERE id=?').run(id);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}
export function dueSchedules(now: string) {
  return database
    .prepare(
      select +
        ' WHERE schedules.enabled=1 AND schedules.completed=0 AND nextRunAt<=? ORDER BY nextRunAt,schedules.id',
    )
    .all(now)
    .map(row);
}
export function advanceSchedule(
  id: number,
  nextRunAt: string | null,
  now: string,
) {
  database
    .prepare(
      'UPDATE schedules SET nextRunAt=?,completed=?,enabled=?,lastTriggeredAt=?,updatedAt=? WHERE id=?',
    )
    .run(
      nextRunAt,
      Number(nextRunAt === null),
      Number(nextRunAt !== null),
      now,
      now,
      id,
    );
}
export function agentHasSchedules(id: number) {
  return Boolean(
    database
      .prepare('SELECT scheduleId FROM schedule_steps WHERE agentId=? LIMIT 1')
      .get(id),
  );
}
