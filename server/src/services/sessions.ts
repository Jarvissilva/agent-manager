import { skillInstructions } from './skills.js';
import { OpenCodeChatSession } from './opencodeChat.js';
import { randomUUID } from 'node:crypto';
import { ChatSession } from './chat.js';
import { AntigravityChatSession } from './antigravityChat.js';
import type { AgentProvider } from '../lib/providers/types.js';
import { defaultChatSettings, type ChatSettings } from './chatSettings.js';
import { EventEmitter, once } from 'node:events';
import { spawn, type IPty } from 'node-pty';
import type { ChildProcess } from 'node:child_process';
import {
  queuedSessionCount,
  insertSession,
  saveSession,
  listUnfinishedSessions,
  recoverSessionHistory,
  type SessionInfo,
} from '../repositories/sessions.js';
import type { Agent } from './agents.js';
import {
  createCodexLogDirectory,
  readCodexConversationId,
  removeCodexLogDirectory,
} from '../lib/providers/codex/conversation.js';

type Session = {
  info: SessionInfo;
  terminal?: IPty;
  process?: ChildProcess;
  events: EventEmitter;
  output: string;
  killTimer?: ReturnType<typeof setTimeout>;
  captureTimer?: ReturnType<typeof setInterval>;
  chat?: ChatSession | AntigravityChatSession | OpenCodeChatSession;
};

const sessions = new Map<string, Session>();
const maxOutputCharacters = 1024 * 1024;
export function projectBusy(projectId: number | null) {
  const session = projectId === null ? undefined : getSession(projectId);
  return Boolean(session && session.info.status !== 'exited');
}
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

function captureConversation(session: Session) {
  if (session.info.codexConversationId) return;
  try {
    const id = readCodexConversationId(session.info.id);
    if (!id) return;
    session.info.codexConversationId = id;
    saveSession(session.info);
    clearInterval(session.captureTimer);
    session.events.emit('status', session.info);
  } catch (error) {
    clearInterval(session.captureTimer);
    console.error('Could not capture Codex conversation ID:', error);
  }
}

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
  transport: 'terminal' | 'chat' = 'terminal',
  settings?: ChatSettings,
  provider: AgentProvider = resume?.provider ?? agent?.provider ?? 'codex',
) {
  cwd = resume?.workingDirectory ?? cwd;
  const existing =
    projectId !== null
      ? getSession(projectId)
      : resume
        ? getSessionById(resume.id)
        : undefined;
  if (existing && existing.info.status !== 'exited') {
    throw new Error('A session is already running for this project.');
  }
  if (
    projectId !== null &&
    resume?.status !== 'queued' &&
    queuedSessionCount(projectId)
  )
    throw new Error(
      'This project has queued sessions. Wait for them to finish or cancel them.',
    );

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
  if (provider !== 'codex' && transport !== 'chat')
    throw new Error('This provider uses chat.');
  if (resume) {
    saveSession(info);
  } else {
    insertSession(info);
  }
  if (transport === 'chat') {
    const session: Session = { info, events: new EventEmitter(), output: '' };
    sessions.set(info.id, session);
    const onClose = (exitCode: number | null) => {
      signalSession(session, 'SIGKILL');
      clearTimeout(session.killTimer);
      info.status = 'exited';
      info.exitCode = exitCode;
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
    if (session.chat instanceof ChatSession)
      session.process = session.chat.rpc.child;
    return session;
  }
  let terminal: IPty;
  try {
    const directory = createCodexLogDirectory(info.id);
    const args = info.codexConversationId
      ? ['resume', info.codexConversationId]
      : [];
    args.push(
      '--no-daemon',
      '--cd',
      cwd,
      '-c',
      `log_dir=${JSON.stringify(directory)}`,
    );
    if (info.agentInstructions)
      args.push(
        '-c',
        `developer_instructions=${JSON.stringify(info.agentInstructions)}`,
      );
    terminal = spawn('codex', args, {
      cwd,
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        RUST_LOG: `${process.env.RUST_LOG ?? 'warn'},codex_core::session=info`,
      },
    });
  } catch (error) {
    if (resume) {
      saveSession(resume);
    } else {
      info.status = 'exited';
      info.endedAt = new Date().toISOString();
      saveSession(info);
    }
    removeCodexLogDirectory(info.id);
    throw error;
  }
  const session: Session = {
    info,
    terminal,
    events: new EventEmitter(),
    output: '',
  };
  sessions.set(info.id, session);
  if (!info.codexConversationId) {
    session.captureTimer = setInterval(() => captureConversation(session), 250);
    session.captureTimer.unref();
  }

  terminal.onData((data) => {
    session.output = (session.output + data).slice(-maxOutputCharacters);
    session.events.emit('output', data);
  });
  terminal.onExit(({ exitCode }) => {
    clearInterval(session.captureTimer);
    captureConversation(session);
    if (session.info.status === 'stopping') {
      signalSession(session, 'SIGKILL');
    }
    clearTimeout(session.killTimer);
    session.info.status = 'exited';
    session.info.exitCode = exitCode;
    session.info.endedAt = new Date().toISOString();
    saveSession(session.info);
    try {
      removeCodexLogDirectory(info.id);
    } catch (error) {
      console.error('Could not remove Codex log directory:', error);
    }
    session.events.emit('exit', session.info);
  });

  return session;
}

function signalSession(session: Session, signal: NodeJS.Signals) {
  try {
    // A Unix PTY owns a process group; stop its children along with Codex.
    const pid =
      session.terminal?.pid ??
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
  if (session.info.status !== 'running') {
    return;
  }

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
