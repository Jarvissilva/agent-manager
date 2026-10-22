import { openCodeHistoryItems } from '../lib/providers/opencode/history.js';
import {
  attachmentPrompt,
  validateAttachments,
  openCodeAttachments,
  type FileAttachment,
} from './files.js';
import { randomUUID } from 'node:crypto';
import {
  beginUsage,
  finishUsage,
  normalizeUsage,
  markUsagePartial,
  saveUsage,
  usageSummary,
} from '../repositories/usage.js';
import { listSkills, mentionedSkills, skillCatalogRevision } from './skills.js';
import {
  openCodeSkillPrompt,
  waitForNativeSkills,
} from '../lib/providers/opencode/skills.js';
import { EventEmitter } from 'node:events';
import {
  OpenCodeServer,
  record,
  array,
  text,
} from '../lib/providers/opencode/server.js';
import {
  modelRef,
  readOpenCodeModels,
  locationQuery,
} from '../lib/providers/opencode/models.js';
import { RequestError } from '../lib/http/errors.js';
import {
  listSessionItems,
  saveSessionItem,
  type ChatItem,
} from '../repositories/sessionItems.js';
import { saveSession, type SessionInfo } from '../repositories/sessions.js';
import { defaultChatSettings, type ChatSettings } from './chatSettings.js';
import type { ChatRequest } from './chat.js';

function permissions(settings: ChatSettings, cwd: string) {
  if (settings.permissions === 'read-only')
    return [
      { action: '*', resource: '*', effect: 'deny' },
      ...['read', 'glob', 'grep', 'skill'].map((action) => ({
        action,
        resource: '*',
        effect: 'allow',
      })),
    ];
  // Without prompts, deny gated tools in workspace mode. Full access explicitly
  // allows every tool; these are tool rules, not an OS or network sandbox.
  return [
    {
      action: '*',
      resource: '*',
      effect:
        settings.approvalPolicy === 'never'
          ? settings.permissions === 'danger-full-access'
            ? 'allow'
            : 'deny'
          : 'ask',
    },
    ...['read', 'glob', 'grep', 'skill'].map((action) => ({
      action,
      resource: '*',
      effect: 'allow',
    })),
    {
      action: 'edit',
      resource:
        settings.permissions === 'danger-full-access' ? '*' : cwd + '/**',
      effect: 'allow',
    },
  ];
}

export class OpenCodeChatSession {
  readonly events = new EventEmitter();
  readonly items = new Map<string, ChatItem>();
  readonly requests = new Map<string, ChatRequest>();
  readonly server: OpenCodeServer;
  readonly ready: Promise<void>;
  state: 'starting' | 'idle' | 'working' | 'stopping' | 'closed' = 'starting';
  error: string | null = null;
  private timer?: ReturnType<typeof setTimeout>;
  private refreshing?: Promise<void>;
  private seenIdle = new Set<string>();
  private seenMessageIds = new Set<string>();
  private turnBaseline = new Set<string>();
  private forms = new Map<string, Record<string, unknown>[]>();
  private fragments = new Map<string, Map<string, string>>();
  private closing = false;
  private sending = false;
  private usageTurnId: string | null = null;
  private dirty = new Set<string>();
  private flushTimer?: ReturnType<typeof setTimeout>;
  readonly info: SessionInfo;
  private cwd: string;
  private skillRevision = skillCatalogRevision();
  private previousSkills = listSkills().filter(
    (skill) =>
      !skill.error &&
      skill.publications.some(
        (publication) =>
          publication.provider === 'Codex / OpenCode' && !publication.error,
      ),
  );
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
    this.server = new OpenCodeServer(cwd);
    this.server.child.once('close', (code) => this.finish(code));
    this.ready = this.initialize().catch((error) => {
      this.error =
        error instanceof Error ? error.message : 'OpenCode could not start.';
      this.close();
      throw error;
    });
  }
  get process() {
    return this.server.child;
  }
  private path(suffix = '') {
    return `/api/session/${encodeURIComponent(this.info.providerConversationId!)}${suffix}`;
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
  private update(item: ChatItem) {
    item.text = item.text.slice(0, 1024 * 1024);
    if (JSON.stringify(this.items.get(item.id)) === JSON.stringify(item))
      return;
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
  private async initialize() {
    await this.server.ready;
    if (this.closing) return;
    if (this.info.providerConversationId) {
      const native = record((await this.server.request(this.path())).data);
      if (record(native.location).directory !== this.cwd)
        throw new RequestError(
          409,
          'This OpenCode session belongs to a different project directory.',
        );
      // A resumed chat starts paused; never replay an unfinished user turn.
      await this.server.request(this.path('/interrupt'), 'POST');
    } else {
      const settings = this.info.chatSettings ?? defaultChatSettings;
      const models = await readOpenCodeModels(this.server, this.cwd);
      const model =
        models.find((model) => model.model === settings.model) ??
        models.find((model) => model.isDefault);
      if (!model)
        throw new RequestError(
          503,
          'No OpenCode model is configured. Connect a model provider in OpenCode, then refresh this page.',
        );
      const native = record(
        (
          await this.server.request('/api/session', 'POST', {
            location: { directory: this.cwd },
            title: this.info.agentName ?? 'Agent OS',
            agent: settings.mode === 'plan' ? 'plan' : 'build',
            model: modelRef(model.model, settings.effort),
            permissions: permissions(settings, this.cwd),
          })
        ).data,
      );
      if (!/^ses[a-zA-Z0-9_-]+$/.test(text(native.id)))
        throw Error('OpenCode returned an invalid session ID.');
      this.info.providerConversationId = text(native.id);
      saveSession(this.info);
    }
    if (this.closing) return;
    await this.configure(this.info.chatSettings ?? defaultChatSettings);
    await this.server.request(
      `/api/experimental/session/${encodeURIComponent(this.info.providerConversationId!)}/instructions/entries/agent-manager`,
      'PUT',
      { value: this.info.agentInstructions ?? '' },
    );
    await this.refresh(true);
    if (this.closing) return;
    this.state = 'idle';
    this.changed();
    void this.server
      .events((event) => this.event(event))
      .catch((error) => {
        if (!this.closing) {
          this.error =
            error instanceof Error ? error.message : 'OpenCode disconnected.';
          this.close();
        }
      });
    this.schedule();
  }
  private async configure(settings: ChatSettings) {
    let model = settings.model;
    if (!model || settings.mode === 'plan') {
      const catalog = await readOpenCodeModels(this.server, this.cwd);
      model ??= catalog.find((model) => model.isDefault)?.model ?? null;
      if (!model)
        throw new RequestError(
          503,
          'No OpenCode model is configured. Connect a model provider in OpenCode, then refresh this page.',
        );
    }
    const rules = permissions(settings, this.cwd);
    if (settings.mode === 'plan') {
      const agents = await this.server.request(
        '/api/agent' + locationQuery(this.cwd),
      );
      const plan = array(agents.data)
        .map(record)
        .find((agent) => agent.id === 'plan');
      if (!plan)
        throw new RequestError(
          503,
          'The OpenCode Plan agent is unavailable. Enable it in OpenCode, then try again.',
        );
      // Session permissions override agent permissions. Preserve native Plan edit
      // restrictions (including its plan-directory exception) after our rules.
      if (settings.permissions !== 'read-only') {
        for (const rule of array(plan.permissions).map(record)) {
          if (
            rule.action === 'edit' &&
            typeof rule.resource === 'string' &&
            (rule.effect === 'allow' ||
              rule.effect === 'deny' ||
              rule.effect === 'ask')
          )
            rules.push({
              action: 'edit',
              resource: rule.resource,
              effect: rule.effect,
            });
        }
      }
    }
    await this.server.request(this.path(), 'PATCH', { permissions: rules });
    await this.server.request(this.path('/agent'), 'POST', {
      agent: settings.mode === 'plan' ? 'plan' : 'build',
    });
    await this.server.request(this.path('/model'), 'POST', {
      model: modelRef(model, settings.effort),
    });
  }
  private event(event: Record<string, unknown>) {
    const data = record(event.data);
    if (data.sessionID !== this.info.providerConversationId || this.closing)
      return;
    const type = text(event.type);
    const reasoning = type.startsWith('session.next.reasoning.');
    if (
      (type.startsWith('session.next.text.') || reasoning) &&
      (type.endsWith('.delta') || type.endsWith('.ended'))
    ) {
      const id =
        text(data.assistantMessageID) + (reasoning ? '-reasoning' : '');
      let fragments = this.fragments.get(id);
      if (!fragments) {
        fragments = new Map();
        this.fragments.set(id, fragments);
      }
      const part = text(reasoning ? data.reasoningID : data.textID);
      fragments.set(
        part,
        type.endsWith('.delta')
          ? (fragments.get(part) ?? '') + text(data.delta)
          : text(data.text),
      );
      this.update({
        id,
        turnId: text(data.assistantMessageID),
        type: reasoning ? 'reasoning' : 'agentMessage',
        role: reasoning ? 'activity' : 'assistant',
        title: reasoning ? 'Reasoning' : 'OpenCode',
        text: [...fragments.values()].join(''),
        status: 'inProgress',
      });
    }
    if (type === 'session.next.step.failed')
      this.error =
        text(record(data.error).message) || 'OpenCode failed to respond.';
    // Durable projections repair missed stream fragments and supply tools/requests.
  }
  private schedule() {
    clearTimeout(this.timer);
    if (this.closing) return;
    this.timer = setTimeout(
      () => {
        void this.refresh()
          .catch((error) => {
            if (!this.closing) {
              this.error =
                error instanceof Error
                  ? error.message
                  : 'OpenCode could not refresh.';
              this.changed();
            }
          })
          .finally(() => this.schedule());
      },
      this.state === 'working' || this.state === 'stopping' ? 250 : 1000,
    );
    this.timer.unref();
  }
  private refresh(initial = false): Promise<void> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.read(initial).finally(() => {
      this.refreshing = undefined;
    });
    return this.refreshing;
  }
  private async read(initial: boolean) {
    let cursor: string | undefined;
    let outcome = '';
    const cursors = new Set<string>();
    do {
      const query = new URLSearchParams({
        limit: '100',
        // Continuation cursors carry the ordering; OpenCode rejects both together.
        ...(cursor ? { cursor } : { order: 'asc' }),
      });
      const page = await this.server.request(this.path('/message?' + query));
      for (const raw of array(page.data)) {
        const message = record(raw);
        const id = text(message.id);
        this.seenMessageIds.add(id);
        if (
          !initial &&
          this.usageTurnId &&
          !this.turnBaseline.has(id) &&
          (message.type === 'assistant' || message.type === 'compaction')
        ) {
          const model = record(message.model);
          const modelName =
            text(model.providerID) && text(model.id)
              ? `${text(model.providerID)}/${text(model.id)}`
              : (this.info.chatSettings?.model ?? null);
          const counters = normalizeUsage('opencode', message.tokens);
          if (
            counters.total === null &&
            (record(message.time).completed ||
              message.status === 'completed' ||
              message.status === 'failed')
          )
            markUsagePartial(this.info.id, this.usageTurnId);
          saveUsage(
            this.info,
            id,
            this.usageTurnId,
            counters,
            message.tokens ?? {},
            modelName,
          );
        }
        if (message.type === 'idle') {
          if (!initial && !this.seenIdle.has(id))
            outcome = text(message.outcome);
          this.seenIdle.add(id);
        } else {
          for (const item of openCodeHistoryItems(message)) {
            const streamed =
              item.type === 'agentMessage' || item.type === 'reasoning';
            if (
              streamed &&
              item.status === 'inProgress' &&
              this.fragments.has(item.id)
            )
              continue;
            this.update(item);
            if (streamed && item.status !== 'inProgress')
              this.fragments.delete(item.id);
          }
          if (
            message.type === 'assistant' &&
            message.error &&
            !initial &&
            !this.turnBaseline.has(id) &&
            (this.state === 'working' || this.state === 'stopping')
          )
            this.error =
              text(record(message.error).message) ||
              'OpenCode failed to respond.';
        }
      }
      cursor = text(record(page.cursor).next) || undefined;
      if (cursor && cursors.has(cursor))
        throw Error('OpenCode returned a repeated message cursor.');
      if (cursor) cursors.add(cursor);
    } while (cursor);
    const [approvals, forms] = await Promise.all([
      this.server.request(this.path('/permission')),
      this.server.request(this.path('/form')),
    ]);
    if (this.closing) return;
    this.requests.clear();
    this.forms.clear();
    for (const value of array(approvals.data)) {
      const request = record(value);
      this.requests.set(text(request.id), {
        id: text(request.id),
        kind: 'approval',
        title: text(request.action) || 'Tool permission',
        detail:
          text(request.message) ||
          array(request.resources).map(text).join('\n'),
        questions: [],
      });
    }
    for (const value of array(forms.data)) {
      const form = record(value);
      const fields = array(form.fields)
        .map(record)
        .filter((field) => !field.hidden);
      this.forms.set(text(form.id), fields);
      this.requests.set(text(form.id), {
        id: text(form.id),
        kind: 'question',
        title: text(form.title) || 'OpenCode question',
        detail: '',
        questions: fields.map((field) => ({
          id: text(field.key),
          question: [
            text(field.title) || text(field.key),
            text(field.description),
            field.type === 'external' ? text(field.url) : '',
          ]
            .filter(Boolean)
            .join('\n'),
          secret: field.format === 'password',
          inputType: text(field.type),
          required: field.required === true,
          options: array(field.options)
            .map(record)
            .map((option) => ({
              label: text(option.value),
              description: text(option.label) || text(option.description),
            })),
        })),
      });
    }
    if (outcome && (this.state === 'working' || this.state === 'stopping')) {
      if (this.usageTurnId)
        finishUsage(
          this.info.id,
          this.usageTurnId,
          outcome === 'succeeded' || outcome === 'completed',
        );
      if (outcome === 'failed')
        this.error ??= 'OpenCode did not complete this response.';
      for (const item of this.items.values())
        if (item.status === 'inProgress')
          this.update({
            ...item,
            status:
              outcome === 'interrupted'
                ? 'interrupted'
                : outcome === 'failed'
                  ? 'failed'
                  : 'completed',
          });
      this.state = 'idle';
      this.events.emit('turn', outcome);
    }
    this.changed();
  }
  async send(
    prompt: string,
    settings?: ChatSettings,
    attachments: FileAttachment[] = [],
  ) {
    await this.ready;
    if (this.state !== 'idle' || this.sending)
      throw new RequestError(409, 'Wait for the current response to finish.');
    this.sending = true;
    try {
      const selected =
        settings ?? this.info.chatSettings ?? defaultChatSettings;
      const files = await validateAttachments(attachments);
      const nativeFiles = await openCodeAttachments(files);
      const revision = skillCatalogRevision();
      if (revision !== this.skillRevision) {
        // OpenCode caches discovered skill bodies. Rebuild this idle server's
        // location when originals change, preserving the native session ID.
        await this.server.request('/api/location/reload', 'POST');
        const skills = listSkills().filter(
          (skill) =>
            !skill.error &&
            skill.publications.some(
              (publication) =>
                publication.provider === 'Codex / OpenCode' &&
                !publication.error,
            ),
        );
        await waitForNativeSkills(
          this.server,
          this.cwd,
          skills,
          this.previousSkills,
        );
        this.previousSkills = skills;
        this.skillRevision = revision;
      }
      await this.refresh();
      await this.configure(selected);
      this.error = null;
      this.turnBaseline = new Set(this.seenMessageIds);
      this.usageTurnId = randomUUID();
      beginUsage(this.info, this.usageTurnId, selected.model);
      this.info.chatSettings = selected;
      this.state = 'working';
      this.changed();
      await this.server.request(this.path('/prompt'), 'POST', {
        text: openCodeSkillPrompt(
          attachmentPrompt(prompt, files),
          mentionedSkills(prompt),
        ),
        ...(nativeFiles.length ? { files: nativeFiles } : {}),
      });
      this.info.chatSettings = selected;
      saveSession(this.info);
      await this.refresh();
      this.schedule();
    } catch (error) {
      this.state = 'idle';
      this.error =
        error instanceof Error
          ? error.message
          : 'OpenCode could not accept the message.';
      this.changed();
      throw error;
    } finally {
      this.sending = false;
    }
  }
  async interrupt() {
    if (this.state !== 'working') return;
    this.state = 'stopping';
    this.changed();
    try {
      await this.server.request(this.path('/interrupt'), 'POST');
      await this.refresh();
    } catch (error) {
      this.state = 'working';
      this.changed();
      throw error;
    }
  }
  async respond(id: string, body: Record<string, unknown>) {
    const request = this.requests.get(id);
    if (!request)
      throw new RequestError(409, 'This request has already been resolved.');
    if (request.kind === 'approval') {
      if (body.decision !== 'accept' && body.decision !== 'decline')
        throw new RequestError(400, 'Choose approve or decline.');
      await this.server.request(
        this.path(`/permission/${encodeURIComponent(id)}/reply`),
        'POST',
        { decision: body.decision === 'accept' ? 'once' : 'reject' },
      );
    } else if (body.decision === 'decline') {
      await this.server.request(
        this.path(`/form/${encodeURIComponent(id)}`),
        'DELETE',
      );
    } else {
      const answers = record(body.answers);
      const answer: Record<string, unknown> = {};
      for (const field of this.forms.get(id) ?? []) {
        const key = text(field.key),
          value = answers[key];
        if (field.type === 'external')
          throw new RequestError(
            400,
            'Complete this step in OpenCode, or cancel the request.',
          );
        if (
          typeof value !== 'string' ||
          value.length > 10000 ||
          (field.required && !value.trim())
        )
          throw new RequestError(400, 'Answer each required question.');
        if (!value && !field.required) continue;
        if (field.type === 'boolean') {
          if (value !== 'true' && value !== 'false')
            throw new RequestError(400, 'Enter true or false.');
          answer[key] = value === 'true';
        } else if (field.type === 'number' || field.type === 'integer') {
          const number = Number(value);
          if (
            !Number.isFinite(number) ||
            (field.type === 'integer' && !Number.isInteger(number))
          )
            throw new RequestError(400, 'Enter a valid number.');
          answer[key] = number;
        } else if (field.type === 'multiselect') {
          let values: unknown;
          try {
            values = JSON.parse(value);
          } catch {
            throw new RequestError(
              400,
              'Enter selected values as a JSON array.',
            );
          }
          if (
            !Array.isArray(values) ||
            !values.every((value) => typeof value === 'string')
          )
            throw new RequestError(
              400,
              'Enter selected values as a JSON array.',
            );
          answer[key] = values;
        } else answer[key] = value;
      }
      await this.server.request(
        this.path(`/form/${encodeURIComponent(id)}/reply`),
        'POST',
        { answer },
      );
    }
    this.requests.delete(id);
    this.changed();
  }
  close() {
    if (this.closing) return;
    const working = this.state === 'working' || this.state === 'stopping';
    this.closing = true;
    clearTimeout(this.timer);
    this.state = 'stopping';
    this.changed();
    if (working && this.info.providerConversationId) {
      void this.server
        .request(this.path('/interrupt'), 'POST')
        .catch(() => {})
        .finally(() => this.server.close());
    } else this.server.close();
  }
  private finish(code: number | null) {
    if (this.state === 'closed') return;
    this.closing = true;
    clearTimeout(this.timer);
    for (const item of this.items.values())
      if (item.status === 'inProgress')
        this.update({ ...item, status: 'interrupted' });
    this.flush();
    this.requests.clear();
    this.state = 'closed';
    this.changed();
    this.onClose(code);
  }
}
