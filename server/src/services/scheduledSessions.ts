import { database } from '../lib/database.js';
import { skillInstructions } from './skills.js';
import { randomUUID } from 'node:crypto';
import { requireWorkingDirectory } from '../lib/directories.js';
import { findAgent } from './agents.js';
import { findProject } from '../repositories/projects.js';
import type { Schedule } from '../repositories/schedules.js';
import {
  scheduledOccurrence,
  occurrenceSessions,
  skipFollowingSessions,
  findSessionById,
  insertSession,
  queuedSessions,
  saveSession,
  type SessionInfo,
  type SessionSnapshot,
} from '../repositories/sessions.js';
import {
  getSessionById,
  projectBusy,
  startSession,
  stopSession,
} from './sessions.js';
import { RequestError } from '../lib/http/errors.js';

export function enqueueSchedule(schedule: Schedule) {
  const existing = scheduledOccurrence(schedule.id, schedule.nextRunAt);
  if (existing) return existing;
  const project =
    schedule.projectId === null ? undefined : findProject(schedule.projectId);
  const occurrenceId = randomUUID();
  const createdAt = new Date().toISOString();
  database.exec('SAVEPOINT enqueue_schedule');
  try {
    const sessions = schedule.steps.map((step, stepIndex) => {
      const agent = step.agentId === null ? undefined : findAgent(step.agentId);
      const skills =
        agent?.skills.map(({ id, name, nativeName, description, path }) => ({
          id,
          name,
          nativeName,
          description,
          path,
        })) ?? [];
      const snapshot: SessionSnapshot = {
        provider: agent?.provider ?? step.provider,
        projectName: project?.name ?? null,
        workingDirectory: step.workingDirectory,
        agentId: agent?.id ?? null,
        agentName: agent?.name ?? null,
        instructions: agent
          ? skillInstructions(agent.instructions, agent.skills)
          : null,
        skills,
        prompt: step.prompt,
        settings: step.settings,
        timeoutMinutes: step.timeoutMinutes,
      };
      const info: SessionInfo = {
        id: randomUUID(),
        name: step.name.slice(0, 100),
        occurrenceId,
        stepIndex,
        stepName: step.name,
        projectId: schedule.projectId,
        workingDirectory: snapshot.workingDirectory,
        provider: snapshot.provider,
        status: 'queued',
        startedAt: createdAt,
        createdAt,
        endedAt: null,
        exitCode: null,
        codexConversationId: null,
        resumedFrom: null,
        lastResumedAt: null,
        agentId: snapshot.agentId,
        agentName: snapshot.agentName,
        agentInstructions: snapshot.instructions,
        mode: 'interactive',
        transport: 'chat',
        chatSettings: snapshot.settings,
        source: 'schedule',
        scheduleId: schedule.id,
        scheduleName: schedule.name,
        scheduledFor: schedule.nextRunAt,
        snapshot,
      };
      insertSession(info);
      return info;
    });
    database.exec('RELEASE enqueue_schedule');
    return sessions[0]!;
  } catch (error) {
    database.exec('ROLLBACK TO enqueue_schedule; RELEASE enqueue_schedule');
    throw error;
  }
}

type Active = {
  timer: ReturnType<typeof setTimeout>;
  outcome: SessionInfo['outcome'];
  error?: string;
};
const active = new Map<string, Active>();
let stopped = true;
let dispatching = false;
export function initializeScheduledSessions() {
  stopped = false;
  for (const queued of queuedSessions()) {
    if (!queued.occurrenceId) continue;
    const failed = occurrenceSessions(queued.occurrenceId).find(
      (session) => session.outcome && session.outcome !== 'succeeded',
    );
    if (failed) skipFollowingSessions(failed);
  }
}
function end(id: string, outcome: SessionInfo['outcome'], error?: string) {
  const state = active.get(id);
  if (!state || state.outcome) return;
  state.outcome = outcome;
  state.error = error;
  const runtime = getSessionById(id);
  if (runtime) stopSession(runtime);
}
export async function dispatchScheduledSessions() {
  if (stopped || dispatching) return;
  dispatching = true;
  try {
    const blockedProjects = new Set<number>();
    for (const entry of queuedSessions()) {
      if (stopped) break;
      const queued = findSessionById(entry.id);
      if (!queued || queued.status !== 'queued') continue;
      if (queued.projectId !== null) {
        if (blockedProjects.has(queued.projectId)) continue;
        blockedProjects.add(queued.projectId);
      }
      if (projectBusy(queued.projectId)) continue;
      const previous =
        queued.occurrenceId && (queued.stepIndex ?? 0) > 0
          ? occurrenceSessions(queued.occurrenceId).find(
              (session) => session.stepIndex === queued.stepIndex! - 1,
            )
          : undefined;
      if ((queued.stepIndex ?? 0) > 0 && !previous) {
        queued.status = 'exited';
        queued.outcome = 'failed';
        queued.endedAt = new Date().toISOString();
        queued.error = 'Previous session is missing.';
        saveSession(queued);
        skipFollowingSessions(queued);
        continue;
      }
      if (previous && previous.outcome !== 'succeeded') {
        if (previous.status === 'exited' || previous.status === 'interrupted')
          skipFollowingSessions(previous);
        continue;
      }
      try {
        const snapshot = queued.snapshot;
        if (!snapshot)
          throw Error('Scheduled session configuration is missing.');
        await requireWorkingDirectory(snapshot.workingDirectory);
        if (
          snapshot.instructions &&
          Buffer.byteLength(JSON.stringify(snapshot.instructions)) > 100000
        )
          throw Error(
            'The combined agent and skill instructions are too large.',
          );
        if (stopped) break;
        const current = findSessionById(queued.id);
        if (!current || current.status !== 'queued') continue;
        queued.projectId = current.projectId;
        if (projectBusy(queued.projectId)) continue;
        queued.startedAt = new Date().toISOString();
        // startSession preserves the queued record and its frozen configuration.
        const runtime = startSession(
          queued.projectId,
          snapshot.workingDirectory,
          queued,
          undefined,
          'chat',
          queued.chatSettings,
          queued.provider,
        );
        const info = runtime.info;
        const state: Active = {
          outcome: null,
          timer: setTimeout(
            () => end(info.id, 'timed_out', 'Execution exceeded its timeout.'),
            snapshot.timeoutMinutes * 60000,
          ),
        };
        state.timer.unref();
        active.set(info.id, state);
        runtime.events.once('exit', () => {
          clearTimeout(state.timer);
          active.delete(info.id);
          info.outcome =
            state.outcome ?? (runtime.chat?.error ? 'failed' : 'cancelled');
          info.error =
            state.error ??
            (info.outcome === 'failed' ? runtime.chat?.error : null);
          info.result =
            [...(runtime.chat?.items.values() ?? [])]
              .filter((i) => i.role === 'assistant')
              .at(-1)?.text ?? null;
          saveSession(info);
          if (info.outcome !== 'succeeded') skipFollowingSessions(info);
          void dispatchScheduledSessions().catch((error) =>
            console.error('Session queue failed:', error),
          );
        });
        runtime.chat!.events.once('turn', (outcome: string) => {
          end(
            info.id,
            outcome === 'completed' || outcome === 'succeeded'
              ? 'succeeded'
              : outcome === 'interrupted'
                ? 'cancelled'
                : 'failed',
            runtime.chat?.error ?? undefined,
          );
        });
        // Do not await a provider here: other projects can start while it initializes.
        void runtime
          .chat!.ready.then(async () => {
            if (!state.outcome)
              await runtime.chat!.send(
                previous?.result
                  ? `${snapshot.prompt}\n\n--- Previous session final response (${previous.stepName ?? 'previous session'}) ---\n${previous.result}`
                  : snapshot.prompt,
                queued.chatSettings,
              );
          })
          .catch((error: unknown) =>
            end(
              info.id,
              'failed',
              error instanceof Error
                ? error.message
                : 'Could not start scheduled session.',
            ),
          );
      } catch (error) {
        queued.status = 'exited';
        queued.outcome = 'failed';
        queued.endedAt = new Date().toISOString();
        queued.error =
          error instanceof Error
            ? error.message
            : 'Could not start scheduled session.';
        saveSession(queued);
        skipFollowingSessions(queued);
      }
    }
  } finally {
    dispatching = false;
  }
}
export function cancelScheduledSession(id: string) {
  const info = findSessionById(id);
  if (!info) throw new RequestError(404, 'Session not found.');
  if (info.status === 'queued') {
    info.status = 'exited';
    info.outcome = 'cancelled';
    info.endedAt = new Date().toISOString();
    saveSession(info);
    skipFollowingSessions(info);
  } else if (active.has(id)) end(id, 'cancelled');
  else {
    const runtime = getSessionById(id);
    if (runtime) stopSession(runtime);
  }
  return findSessionById(id)!;
}
export function stopScheduledSessions() {
  stopped = true;
  for (const id of active.keys())
    end(id, 'interrupted', 'Server stopped during execution.');
}
