import { mentionedSkills } from './skills.js';
import { antigravitySkillPrompt } from '../lib/providers/antigravity/skills.js';
import { randomUUID } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { executeAntigravity } from '../lib/providers/antigravity/execution.js';
import { isAvailable } from '../lib/providers/providers.js';
import { RequestError } from '../lib/http/errors.js';
import {
  listSessionItems,
  saveSessionItem,
  type ChatItem,
} from '../repositories/sessionItems.js';
import { saveSession, type SessionInfo } from '../repositories/sessions.js';
import { defaultChatSettings, type ChatSettings } from './chatSettings.js';
import type { ChatRequest } from './chat.js';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown) => (typeof value === 'string' ? value : '');
const limit = (value: string) => value.slice(0, 1024 * 1024);

export class AntigravityChatSession {
  readonly events = new EventEmitter();
  readonly items = new Map<string, ChatItem>();
  readonly requests = new Map<string, ChatRequest>();
  readonly ready: Promise<void>;
  process?: ChildProcess;
  state: 'starting' | 'idle' | 'working' | 'stopping' | 'closed' = 'starting';
  error: string | null = null;
  private ending = false;
  private interrupted = false;
  private killTimer?: ReturnType<typeof setTimeout>;
  private flushTimer?: ReturnType<typeof setTimeout>;
  private dirty = new Set<string>();
  readonly info: SessionInfo;
  private cwd: string;
  private onClose: (code: number | null) => void;
  constructor(
    info: SessionInfo,
    cwd: string,
    onClose: (code: number | null) => void,
  ) {
    this.info = info;
    this.cwd = cwd;
    this.onClose = onClose;
    for (const item of listSessionItems(info.id)) this.items.set(item.id, item);
    this.ready = isAvailable('agy').then((available) => {
      if (!available) {
        this.finish(1);
        throw Error('Antigravity CLI was not found.');
      }
      if (this.ending || this.state === 'closed') return;
      this.state = 'idle';
      saveSession(info);
      this.changed();
    });
  }
  snapshot() {
    return {
      items: [...this.items.values()],
      requests: [],
      state: this.state,
      error: this.error,
      settings: this.info.chatSettings ?? defaultChatSettings,
    };
  }
  private changed() {
    this.events.emit('change', {
      type: 'state',
      state: this.state,
      error: this.error,
      requests: [],
      settings: this.info.chatSettings ?? defaultChatSettings,
    });
  }
  private update(item: ChatItem) {
    item.text = limit(item.text);
    this.items.set(item.id, item);
    this.dirty.add(item.id);
    if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), 100);
    this.events.emit('change', { type: 'item', item });
  }
  private flush() {
    clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    for (const id of this.dirty)
      saveSessionItem(this.info.id, this.items.get(id)!);
    this.dirty.clear();
  }
  private finish(code: number | null) {
    if (this.state === 'closed') return;
    clearTimeout(this.killTimer);
    this.flush();
    this.state = 'closed';
    this.changed();
    this.onClose(code);
  }
  async send(prompt: string, settings?: ChatSettings) {
    await this.ready;
    if (this.state !== 'idle' || this.process)
      throw new RequestError(409, 'Wait for the current response to finish.');
    const selected = settings ?? this.info.chatSettings ?? defaultChatSettings;
    const turnId = randomUUID();
    let resultSeen = false;
    let succeeded = false;
    let diagnostics = '';
    this.state = 'working';
    this.error = null;
    this.interrupted = false;
    this.changed();
    const user: ChatItem = {
      id: `${turnId}-user`,
      turnId,
      type: 'userMessage',
      role: 'user',
      title: 'You',
      text: prompt,
      status: 'completed',
    };
    const assistant: ChatItem = {
      id: `${turnId}-assistant`,
      turnId,
      type: 'agentMessage',
      role: 'assistant',
      title: 'Antigravity',
      text: '',
      status: 'inProgress',
    };
    this.update(user);
    this.update(assistant);
    let child: ChildProcess;
    try {
      child = executeAntigravity(
        {
          cwd: this.cwd,
          prompt: antigravitySkillPrompt(prompt, mentionedSkills(prompt)),
          instructions: this.info.agentInstructions,
          conversationId: this.info.providerConversationId,
          settings: selected,
        },
        (event) => {
          const payload = record(event[event.event as string]);
          const conversationId =
            text(event.conversation_id) || text(payload.conversation_id);
          if (conversationId && /^[a-zA-Z0-9-]{1,100}$/.test(conversationId)) {
            this.info.providerConversationId = conversationId;
            saveSession(this.info);
          }
          if (event.event === 'step_update') {
            if (payload.step_type === 'agent_response') {
              assistant.text += text(payload.text_delta);
              this.update(assistant);
            } else if (payload.step_type === 'tool') {
              const tool = record(payload.tool_info);
              const parameters = record(tool.parameters);
              const command = payload.tool_name === 'run_command';
              this.update({
                id: `${turnId}-step-${String(payload.step_index)}`,
                turnId,
                type: command ? 'commandExecution' : 'tool',
                role: 'activity',
                title:
                  text(parameters.CommandLine) ||
                  text(payload.tool_name) ||
                  'Tool',
                text: text(tool.output) || JSON.stringify(tool, null, 2),
                status: payload.state === 'DONE' ? 'completed' : 'inProgress',
              });
            }
          } else if (event.event === 'result') {
            resultSeen = true;
            succeeded = payload.status === 'SUCCESS';
            assistant.text = text(payload.response) || assistant.text;
            assistant.status = succeeded ? 'completed' : 'failed';
            this.update(assistant);
            if (!succeeded)
              this.error =
                text(payload.error) ||
                `Antigravity returned ${text(payload.status) || 'an error'}.`;
          }
        },
        (chunk) => {
          diagnostics = limit(diagnostics + chunk);
        },
      );
      this.process = child;
      await once(child, 'spawn');
      this.info.chatSettings = selected;
      saveSession(this.info);
      this.changed();
    } catch (error) {
      this.process = undefined;
      this.state = 'idle';
      this.error =
        error instanceof Error ? error.message : 'Could not start Antigravity.';
      this.update({ ...assistant, status: 'failed' });
      this.changed();
      throw error;
    }
    child.on('error', (error) => {
      this.error = error.message;
    });
    child.on('close', (code) => {
      if ((this.interrupted || this.ending) && child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch (error) {
          if (!(
            error &&
            typeof error === 'object' &&
            'code' in error &&
            error.code === 'ESRCH'
          ))
            throw error;
        }
      }
      clearTimeout(this.killTimer);
      this.process = undefined;
      for (const item of this.items.values())
        if (item.turnId === turnId && item.status === 'inProgress')
          this.update({
            ...item,
            status: this.interrupted || this.ending ? 'interrupted' : 'failed',
          });
      if (this.interrupted || this.ending) {
        this.update({ ...assistant, status: 'interrupted' });
        this.error = null;
      } else if (code !== 0 || !resultSeen || !succeeded) {
        this.error ??=
          'Antigravity did not complete the response. Check that agy is signed in and try again.';
      }
      if (diagnostics.trim())
        this.update({
          id: `${turnId}-diagnostics`,
          turnId,
          type: 'diagnostics',
          role: 'activity',
          title: 'Antigravity notices',
          text: diagnostics,
          status: 'completed',
        });
      this.flush();
      if (this.ending) this.finish(code);
      else {
        this.state = 'idle';
        this.changed();
        this.events.emit(
          'turn',
          this.interrupted
            ? 'interrupted'
            : this.error
              ? 'failed'
              : 'completed',
        );
      }
    });
  }
  async interrupt() {
    if (this.state !== 'working') return;
    this.interrupted = true;
    this.state = 'stopping';
    this.changed();
    this.kill();
  }
  respond() {
    throw new RequestError(
      400,
      'Antigravity CLI does not support approval responses over its chat protocol.',
    );
  }
  close() {
    this.ending = true;
    if (this.process) {
      this.state = 'stopping';
      this.changed();
      this.kill();
    } else queueMicrotask(() => this.finish(0));
  }
  private kill() {
    const pid = this.process?.pid;
    if (!pid) return;
    const signal = (value: NodeJS.Signals) => {
      try {
        process.kill(-pid, value);
      } catch (error) {
        if (!(
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'ESRCH'
        ))
          throw error;
      }
    };
    signal('SIGTERM');
    this.killTimer = setTimeout(() => signal('SIGKILL'), 2000);
    this.killTimer.unref();
  }
}
