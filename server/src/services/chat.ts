import { readCodexHistory } from '../lib/providers/codex/history.js';
import {
  mcpElicitation,
  mcpElicitationResponse,
  automaticMcpConfirmation,
} from '../lib/providers/codex/elicitation.js';
import {
  attachmentPrompt,
  validateAttachments,
  type FileAttachment,
} from './files.js';
import {
  beginUsage,
  finishUsage,
  saveCumulativeUsage,
  usageSummary,
} from '../repositories/usage.js';
import { mentionedSkills, skillCatalogRevision } from './skills.js';
import { codexSkillInput } from '../lib/providers/codex/skills.js';
import { EventEmitter } from 'node:events';
import {
  createAppServer,
  type RpcMessage,
} from '../lib/providers/codex/appServer.js';
import { RequestError } from '../lib/http/errors.js';
import {
  listSessionItems,
  saveSessionItem,
  type ChatItem,
} from '../repositories/sessionItems.js';
import { saveSession, type SessionInfo } from '../repositories/sessions.js';
import { defaultChatSettings, type ChatSettings } from './chatSettings.js';

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown) => (typeof value === 'string' ? value : '');
const array = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];
const limit = (value: string) =>
  value.length > 1024 * 1024
    ? value.slice(0, 1024 * 1024) + '\n[Output truncated]'
    : value;

export type ChatRequest = {
  id: string | number;
  kind: 'approval' | 'question' | 'mcp';
  elicitation?: {
    mode: 'form' | 'url' | 'unsupported';
    schema?: Record<string, unknown>;
    url?: string;
  };
  title: string;
  detail: string;
  questions: {
    id: string;
    question: string;
    secret: boolean;
    inputType?: string;
    required?: boolean;
    options: { label: string; description: string; value?: string }[];
  }[];
};

export function projectCodexItem(
  raw: unknown,
  turnId: string,
  completed: boolean,
  previous?: ChatItem,
): ChatItem | undefined {
  const item = record(raw);
  const id = text(item.id);
  const type = text(item.type);
  if (!id || !type) return;
  let body: string;
  let title = type.replace(/([a-z])([A-Z])/g, '$1 $2');
  let role: ChatItem['role'] = 'activity';
  if (type === 'userMessage') {
    role = 'user';
    title = 'You';
    body = array(item.content)
      .map((part) => text(record(part).text))
      .filter(Boolean)
      .join('\n');
  } else if (type === 'agentMessage' || type === 'plan') {
    role = 'assistant';
    title = type === 'plan' ? 'Plan' : 'Codex';
    body = text(item.text);
  } else if (type === 'commandExecution') {
    title = text(item.command) || 'Command';
    body = text(item.aggregatedOutput);
    if (typeof item.exitCode === 'number')
      body += `\nExit code: ${item.exitCode}`;
  } else if (type === 'fileChange') {
    title = 'File changes';
    body = array(item.changes)
      .map((value) => {
        const change = record(value);
        return `${text(change.path)}\n${text(change.diff)}`;
      })
      .join('\n\n');
  } else if (type === 'reasoning') {
    title = 'Thinking';
    body = array(item.summary).map(text).join('\n');
    if (!body) return;
  } else if (type === 'mcpToolCall') {
    title = `${text(item.server)} · ${text(item.tool)}`;
    body = JSON.stringify(
      { arguments: item.arguments, result: item.result, error: item.error },
      null,
      2,
    );
  } else {
    body = text(item.text) || JSON.stringify(item, null, 2);
  }
  return {
    id,
    turnId,
    type,
    role,
    title,
    text: limit(body || previous?.text || ''),
    status: text(item.status) || (completed ? 'completed' : 'inProgress'),
  };
}

export class ChatSession {
  readonly info: SessionInfo;
  readonly events = new EventEmitter();
  readonly items = new Map<string, ChatItem>();
  readonly requests = new Map<string, ChatRequest>();
  readonly rpc;
  readonly ready: Promise<void>;
  state: 'starting' | 'idle' | 'working' | 'stopping' | 'closed' = 'starting';
  turnId: string | null = null;
  error: string | null = null;
  private dirty = new Set<string>();
  private flushTimer?: ReturnType<typeof setTimeout>;
  private stopRequested = false;
  private sending = false;
  private usageModel: string | null = null;
  private resumedUsage = false;
  private readonly cwd: string;
  private skillRevision = skillCatalogRevision();

  constructor(
    info: SessionInfo,
    cwd: string,
    onClose: (code: number | null, error?: string) => void,
  ) {
    this.cwd = cwd;
    this.info = info;
    this.resumedUsage = Boolean(info.codexConversationId);
    for (const item of listSessionItems(info.id)) this.items.set(item.id, item);
    this.rpc = createAppServer(
      cwd,
      (message) => this.receive(message),
      (code, error) => {
        this.state = 'closed';
        this.turnId = null;
        this.requests.clear();
        for (const item of this.items.values()) {
          if (item.status === 'inProgress')
            this.update({ ...item, status: 'interrupted' });
        }
        this.flush();
        if (error || code)
          this.error = 'Codex disconnected. Resume this session to continue.';
        this.changed();
        onClose(code, error);
      },
    );
    this.ready = this.initialize(cwd).catch((error: unknown) => {
      this.error =
        error instanceof Error
          ? error.message
          : 'Could not initialize Codex chat.';
      this.rpc.child.kill('SIGTERM');
      throw error;
    });
  }

  snapshot() {
    return {
      items: [...this.items.values()],
      requests: [...this.requests.values()],
      state: this.state,
      error: this.error,
      usage: usageSummary(this.info.id),
      settings: this.info.chatSettings ?? defaultChatSettings,
    };
  }
  private changed() {
    this.events.emit('change', {
      type: 'state',
      state: this.state,
      error: this.error,
      requests: [...this.requests.values()],
      usage: usageSummary(this.info.id),
      settings: this.info.chatSettings ?? defaultChatSettings,
    });
  }
  private flush() {
    clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    for (const id of this.dirty)
      saveSessionItem(this.info.id, this.items.get(id)!);
    this.dirty.clear();
  }
  private update(item: ChatItem) {
    item.text = limit(item.text);
    this.items.set(item.id, item);
    this.dirty.add(item.id);
    if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), 100);
    this.events.emit('change', { type: 'item', item });
  }
  private item(raw: unknown, turnId: string, completed: boolean) {
    const item = projectCodexItem(
      raw,
      turnId,
      completed,
      this.items.get(text(record(raw).id)),
    );
    if (item) this.update(item);
  }
  private async initialize(cwd: string) {
    await this.rpc.request('initialize', {
      clientInfo: {
        name: 'agent_manager',
        title: 'Agent Manager',
        version: '0.0.0',
      },
      capabilities: { experimentalApi: true },
    });
    this.rpc.notify('initialized');
    const resumed = Boolean(this.info.codexConversationId);
    const settings = this.info.chatSettings ?? defaultChatSettings;
    const result = await this.rpc.request(
      resumed ? 'thread/resume' : 'thread/start',
      {
        ...(resumed ? { threadId: this.info.codexConversationId } : {}),
        cwd,
        sandbox: settings.permissions,
        ...(settings.model ? { model: settings.model } : {}),
        ...(settings.effort
          ? { config: { model_reasoning_effort: settings.effort } }
          : {}),
        approvalPolicy: settings.approvalPolicy ?? 'on-request',
        approvalsReviewer: 'user',
        developerInstructions: this.info.agentInstructions,
      },
    );
    const thread = record(result.thread);
    const id = text(thread.id);
    if (!id) throw Error('Codex did not return a conversation ID.');
    this.info.codexConversationId = id;
    this.info.chatSettings = {
      ...settings,
      model: text(result.model) || settings.model,
      effort: text(result.reasoningEffort) || settings.effort,
    };
    saveSession(this.info);
    // Resume the provider's saved conversation as well as our locally cached
    // transcript, including conversations originally created in the terminal.
    if (resumed)
      await readCodexHistory(this.rpc, thread, (item, turnId, completed) =>
        this.item(item, turnId, completed),
      );
    this.flush();
    this.state = 'idle';
    this.changed();
  }
  private receive(message: RpcMessage) {
    const method = message.method ?? '';
    const params = message.params ?? {};
    if (
      params.threadId &&
      this.info.codexConversationId &&
      params.threadId !== this.info.codexConversationId
    )
      return;
    if (message.id !== undefined) {
      if (method === 'mcpServer/elicitation/request') {
        const request = mcpElicitation(message.id, params);
        const automatic = automaticMcpConfirmation(request);
        if (automatic) {
          this.rpc.respond(request.id, automatic);
          return;
        }
        this.requests.set(String(request.id), request);
        this.changed();
        return;
      }
      const question = method === 'item/tool/requestUserInput';
      if (
        question ||
        method === 'item/commandExecution/requestApproval' ||
        method === 'item/fileChange/requestApproval'
      ) {
        const request: ChatRequest = {
          id: message.id,
          kind: question ? 'question' : 'approval',
          title: question
            ? 'Codex needs your input'
            : method.includes('fileChange')
              ? 'Approve file changes'
              : 'Approve command',
          detail: [
            text(params.command),
            text(params.reason),
            text(params.grantRoot),
          ]
            .filter(Boolean)
            .join('\n'),
          questions: array(params.questions).map((value) => {
            const q = record(value);
            return {
              id: text(q.id),
              question: text(q.question),
              secret: q.isSecret === true,
              options: array(q.options).map((option) => ({
                label: text(record(option).label),
                description: text(record(option).description),
              })),
            };
          }),
        };
        this.requests.set(String(request.id), request);
        this.changed();
      } else {
        this.rpc.reject(message.id);
        this.error = `Codex requested an unsupported interaction: ${method}.`;
        this.changed();
      }
      return;
    }
    if (method === 'serverRequest/resolved') {
      this.requests.delete(String(params.requestId));
      this.changed();
    } else if (method === 'model/rerouted') {
      this.usageModel = text(params.toModel) || this.usageModel;
    } else if (method === 'thread/tokenUsage/updated') {
      const usage = record(params.tokenUsage);
      saveCumulativeUsage(
        this.info,
        'codex',
        text(params.turnId),
        usage.total,
        usage.last,
        this.usageModel ?? this.info.chatSettings?.model ?? null,
        this.resumedUsage,
      );
      this.changed();
    } else if (method === 'turn/started') {
      this.turnId = text(record(params.turn).id);
      beginUsage(this.info, this.turnId, this.usageModel);
      this.state = this.stopRequested ? 'stopping' : 'working';
      this.changed();
    } else if (method === 'turn/completed') {
      const turn = record(params.turn);
      finishUsage(this.info.id, text(turn.id), turn.status === 'completed');
      for (const item of array(turn.items))
        this.item(item, text(turn.id), true);
      this.error =
        text(record(turn.error).message) ||
        (turn.status === 'failed'
          ? 'The turn failed. You can try again.'
          : null);
      for (const item of this.items.values()) {
        if (item.turnId === this.turnId && item.status === 'inProgress')
          this.update({
            ...item,
            status: turn.status === 'interrupted' ? 'interrupted' : 'completed',
          });
      }
      this.turnId = null;
      this.requests.clear();
      this.stopRequested = false;
      this.state = 'idle';
      this.flush();
      this.changed();
      this.events.emit(
        'turn',
        this.error
          ? 'failed'
          : turn.status === 'interrupted'
            ? 'interrupted'
            : 'completed',
      );
    } else if (method === 'item/started' || method === 'item/completed') {
      this.item(params.item, text(params.turnId), method === 'item/completed');
    } else if (
      method === 'item/agentMessage/delta' ||
      method === 'item/plan/delta' ||
      method === 'item/commandExecution/outputDelta'
    ) {
      const id = text(params.itemId);
      if (!id) return;
      const existing = this.items.get(id);
      const command = method.includes('commandExecution');
      this.update({
        id,
        turnId: text(params.turnId),
        type: command
          ? 'commandExecution'
          : method.includes('/plan/')
            ? 'plan'
            : 'agentMessage',
        role: command ? 'activity' : 'assistant',
        title: command ? 'Command' : 'Codex',
        status: 'inProgress',
        ...existing,
        text: (existing?.text ?? '') + text(params.delta),
      });
    } else if (method === 'error' && params.willRetry !== true) {
      this.error =
        text(record(params.error).message) || 'Codex reported an error.';
      this.changed();
    }
  }
  async send(
    prompt: string,
    settings: ChatSettings = this.info.chatSettings ?? defaultChatSettings,
    attachments: FileAttachment[] = [],
  ) {
    const files = await validateAttachments(attachments);
    const message = attachmentPrompt(prompt, files);
    if (this.state !== 'idle' || this.sending)
      throw new RequestError(
        409,
        'Wait for Codex to finish or stop the current response.',
      );
    this.sending = true;
    this.usageModel = settings.model ?? this.info.chatSettings?.model ?? null;
    this.state = 'working';
    this.error = null;
    this.changed();
    try {
      const revision = skillCatalogRevision();
      if (revision !== this.skillRevision) {
        await this.rpc.request('skills/list', {
          cwds: [this.cwd],
          forceReload: true,
        });
        this.skillRevision = revision;
      }
      const model = settings.model ?? this.info.chatSettings?.model;
      if (!model) throw new RequestError(503, 'Codex did not resolve a model.');
      const result = await this.rpc.request('turn/start', {
        threadId: this.info.codexConversationId,
        approvalPolicy: settings.approvalPolicy ?? 'on-request',
        input: [
          ...codexSkillInput(message, mentionedSkills(prompt)),
          ...files.map((file) =>
            file.mime.startsWith('image/')
              ? { type: 'localImage', path: file.path }
              : { type: 'mention', name: file.name, path: file.path },
          ),
        ],
        collaborationMode: {
          mode: settings.mode ?? 'default',
          settings: {
            model,
            reasoning_effort: settings.effort,
            developer_instructions: null,
          },
        },
        ...(settings.model ? { model: settings.model } : {}),
        ...(settings.effort ? { effort: settings.effort } : {}),
        sandboxPolicy:
          settings.permissions === 'danger-full-access'
            ? { type: 'dangerFullAccess' }
            : settings.permissions === 'read-only'
              ? {
                  type: 'readOnly',
                  networkAccess: settings.networkAccess ?? false,
                }
              : {
                  type: 'workspaceWrite',
                  writableRoots: [],
                  networkAccess: settings.networkAccess ?? false,
                  excludeTmpdirEnvVar: false,
                  excludeSlashTmp: false,
                },
      });
      this.info.chatSettings = settings;
      saveSession(this.info);
      this.changed();
      // Notifications can precede the RPC response, including completion.
      if (this.state === 'working' || this.state === 'stopping')
        this.turnId = text(record(result.turn).id) || this.turnId;
      if (this.stopRequested && this.turnId) await this.interrupt();
    } catch (error) {
      if (this.snapshot().state !== 'closed') this.state = 'idle';
      this.error =
        error instanceof Error ? error.message : 'Could not send the message.';
      this.changed();
      throw error;
    } finally {
      this.sending = false;
    }
  }
  async interrupt() {
    if (this.state !== 'working' && this.state !== 'stopping') return;
    this.stopRequested = true;
    this.state = 'stopping';
    this.changed();
    if (!this.turnId) return;
    try {
      await this.rpc.request('turn/interrupt', {
        threadId: this.info.codexConversationId,
        turnId: this.turnId,
      });
    } catch (error) {
      this.stopRequested = false;
      this.state = 'working';
      this.changed();
      throw error;
    }
  }
  respond(id: string, body: Record<string, unknown>) {
    if (
      this.state !== 'working' &&
      !(this.state === 'idle' && this.requests.get(id)?.kind === 'mcp')
    )
      throw new RequestError(409, 'This turn is no longer waiting for input.');
    const request = this.requests.get(id);
    if (!request)
      throw new RequestError(409, 'This request has already been resolved.');
    let result: object;
    if (request.kind === 'mcp') {
      result = mcpElicitationResponse(request, body);
    } else if (request.kind === 'approval') {
      if (body.decision !== 'accept' && body.decision !== 'decline')
        throw new RequestError(400, 'Choose approve or decline.');
      result = { decision: body.decision };
    } else {
      const answers = record(body.answers);
      const mapped: Record<string, { answers: string[] }> = {};
      for (const question of request.questions) {
        const answer = answers[question.id];
        if (
          typeof answer !== 'string' ||
          !answer.trim() ||
          answer.length > 10000
        )
          throw new RequestError(400, 'Answer each question.');
        mapped[question.id] = { answers: [answer] };
      }
      result = { answers: mapped };
    }
    this.rpc.respond(request.id, result);
    this.requests.delete(id);
    this.changed();
  }
}
