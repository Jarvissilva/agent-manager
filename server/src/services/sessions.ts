import { attachChatQueue } from './chatQueue.js';
import {
  recoverChatQueues,
  pauseChatQueue,
  supportsChatQueue,
} from '../repositories/chatQueue.js';
import { skillInstructions } from './skills.js';
import { sessionActivity } from '../lib/sessionActivity.js';
import { OpenCodeChatSession } from './opencodeChat.js';
import { randomUUID } from 'node:crypto';
import { ChatSession } from './chat.js';
import { AntigravityChatSession } from './antigravityChat.js';
import type { AgentProvider } from '../lib/providers/types.js';
import { defaultChatSettings, type ChatSettings } from './chatSettings.js';
import { EventEmitter, once } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import {
  insertSession,
  saveSession,
  listUnfinishedSessions,
  recoverSessionHistory,
  findSessionById,
  findSavedSession,
  sessionAliases,
  deleteSessionRecords,
  occurrenceSessions,
  type SessionInfo,
} from '../repositories/sessions.js';
import type { Agent } from './agents.js';
import { RequestError } from '../lib/http/errors.js';
import {
  readCodexConversationId,
  removeCodexLogDirectory,
} from '../lib/providers/codex/conversation.js';

type Session = {
  info: SessionInfo;
  process?: ChildProcess;
  events: EventEmitter;
  killTimer?: ReturnType<typeof setTimeout>;
  chat?: ChatSession | AntigravityChatSession | OpenCodeChatSession;
};

const sessions = new Map<string, Session>();
for (const row of listUnfinishedSessions()) {
  if (row.provider !== 'codex') continue;
  const id = String(row.id);
  try {
    const conversationId = row.codexConversationId
      ? null
      : readCodexConversationId(id);
    if (conversationId)
      saveSession({ ...row, codexConversationId: conversationId });
    removeCodexLogDirectory(id);
  } catch (error) {
    console.error('Could not recover Codex conversation ID:', error);
  }
}

recoverSessionHistory();
recoverChatQueues();

export function getSession(projectId: number) {
  return (
    [...sessions.values()]
      .reverse()
      .find(
        (session) =>
          session.info.projectId === projectId &&
          session.info.status !== 'exited',
      ) ??
    [...sessions.values()]
      .reverse()
      .find((session) => session.info.projectId === projectId)
  );
}

export function getSessionById(id: string) {
  return sessions.get(id);
}

export function withSessionActivity(info: SessionInfo) {
  const runtime = getSessionById(info.id);
  return {
    ...info,
    activity: sessionActivity(runtime?.info ?? info, runtime?.chat),
  };
}

export function deleteSession(id: string) {
  const row = findSessionById(id);
  const saved = row ? findSavedSession(row.projectId, row.id) : undefined;
  if (!saved) throw new RequestError(404, 'Session not found.');
  const aliases = sessionAliases(saved.id);
  for (const session of aliases) {
    if (
      !['exited', 'interrupted'].includes(session.status) ||
      (sessions.has(session.id) &&
        !['exited', 'interrupted'].includes(
          sessions.get(session.id)!.info.status,
        ))
    )
      throw new RequestError(
        409,
        'End running sessions or cancel queued sessions before deleting them.',
      );
    if (
      session.occurrenceId &&
      occurrenceSessions(session.occurrenceId).some((step) =>
        ['queued', 'running', 'stopping'].includes(step.status),
      )
    )
      throw new RequestError(
        409,
        'Wait for all sessions in this scheduled execution to finish before deleting its history.',
      );
  }
  deleteSessionRecords(saved.id);
  for (const session of aliases) sessions.delete(session.id);
}

export function detachProject(projectId: number, deleteSessions: boolean) {
  for (const [id, session] of sessions) {
    if (session.info.projectId !== projectId) continue;
    if (deleteSessions) sessions.delete(id);
    else {
      session.info.projectId = null;
      session.events.emit('status', session.info);
    }
  }
}

export function detachAgent(agentId: number) {
  for (const session of sessions.values()) {
    if (session.info.agentId === agentId) {
      session.info.agentId = null;
      session.events.emit('status', session.info);
    }
  }
}

export function startSession(
  projectId: number | null,
  cwd: string,
  resume?: SessionInfo,
  agent?: Agent,
  transport: 'chat' = 'chat',
  settings?: ChatSettings,
  provider: AgentProvider = resume?.provider ?? 'codex',
) {
  cwd = resume?.workingDirectory ?? cwd;
  const existing = resume ? getSessionById(resume.id) : undefined;
  if (existing && existing.info.status !== 'exited') {
    throw new RequestError(409, 'This conversation is already open.');
  }

  // Keep active runtimes and the latest ended runtime in each grouping.
  for (const [id, session] of sessions) {
    if (
      session.info.projectId === projectId &&
      session.info.status === 'exited'
    )
      sessions.delete(id);
  }
  const info: SessionInfo = {
    ...resume,
    id: resume?.id ?? randomUUID(),
    name: resume?.name ?? null,
    projectId,
    workingDirectory: resume?.workingDirectory ?? cwd,
    provider,
    providerConversationId: resume?.providerConversationId ?? null,
    status: 'running',
    startedAt: resume?.startedAt ?? new Date().toISOString(),
    endedAt: null,
    exitCode: null,
    codexConversationId: resume?.codexConversationId ?? null,
    resumedFrom: null,
    lastResumedAt:
      resume && resume.status !== 'queued' ? new Date().toISOString() : null,
    agentId: resume ? resume.agentId : (agent?.id ?? null),
    agentName: resume ? resume.agentName : (agent?.name ?? null),
    agentInstructions: resume
      ? resume.agentInstructions
      : agent
        ? skillInstructions(agent.instructions, agent.skills)
        : null,
    mode: 'interactive',
    transport,
    ...(transport === 'chat'
      ? {
          chatSettings: settings ??
            resume?.chatSettings ?? { ...defaultChatSettings },
        }
      : {}),
  };
  if (transport !== 'chat')
    throw new RequestError(400, 'Only chat sessions are supported.');
  if (resume) {
    saveSession(info);
  } else {
    insertSession(info);
  }
  const session: Session = { info, events: new EventEmitter() };
  sessions.set(info.id, session);
  const onClose = (exitCode: number | null) => {
    const stopped = info.status === 'stopping';
    signalSession(session, 'SIGKILL');
    clearTimeout(session.killTimer);
    info.status = 'exited';
    info.exitCode = exitCode;
    if (info.source !== 'schedule') {
      info.error = stopped ? null : (session.chat?.error ?? null);
      info.outcome = stopped
        ? 'cancelled'
        : info.error || exitCode
          ? 'failed'
          : null;
    }
    info.endedAt = new Date().toISOString();
    saveSession(info);
    session.events.emit('exit', info);
  };
  session.chat =
    provider === 'opencode'
      ? new OpenCodeChatSession(info, cwd, onClose)
      : provider === 'antigravity'
        ? new AntigravityChatSession(info, cwd, onClose)
        : new ChatSession(info, cwd, onClose);
  session.chat.events.on(
    'change',
    (event: { type: string; error?: string | null; state?: string }) => {
      if (event.type !== 'state') return;
      const error =
        info.status === 'stopping' && event.state === 'closed'
          ? null
          : (event.error ?? null);
      if (info.error !== error) {
        info.error = error;
        saveSession(info);
      }
    },
  );
  attachChatQueue(session.chat);
  if (session.chat instanceof ChatSession)
    session.process = session.chat.rpc.child;
  return session;
}

function signalSession(session: Session, signal: NodeJS.Signals) {
  try {
    // Provider processes own a group; stop their tool children as well.
    const pid =
      session.process?.pid ??
      (session.chat instanceof AntigravityChatSession ||
      session.chat instanceof OpenCodeChatSession
        ? session.chat.process?.pid
        : undefined);
    if (pid !== undefined) process.kill(-pid, signal);
  } catch (error) {
    if (!(
      error instanceof Error &&
      'code' in error &&
      error.code === 'ESRCH'
    )) {
      throw error;
    }
  }
}

export function stopSession(session: Session) {
  if (session.info.status !== 'running') return;
  if (supportsChatQueue(session.info))
    pauseChatQueue(
      session.info.id,
      'Session ended. Resume the session before continuing its queue.',
    );

  session.info.status = 'stopping';
  if (
    session.chat instanceof AntigravityChatSession ||
    session.chat instanceof OpenCodeChatSession
  )
    session.chat.close();
  else signalSession(session, 'SIGTERM');
  saveSession(session.info);
  session.events.emit('status', session.info);
  session.killTimer = setTimeout(() => {
    if (session.info.status !== 'exited') {
      signalSession(session, 'SIGKILL');
    }
  }, 2000);
  session.killTimer.unref();
}

export async function shutdownSessions() {
  await Promise.all(
    [...sessions.values()].map(async (session) => {
      if (session.info.status === 'exited') return;
      const exited = once(session.events, 'exit');
      stopSession(session);
      await exited;
    }),
  );
}
