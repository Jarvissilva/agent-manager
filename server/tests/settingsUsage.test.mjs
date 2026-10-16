import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';

test('settings, provider accounting, reporting and retention without network listeners', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-manager-usage-'));
  const original = {
    path: process.env.PATH,
    db: process.env.AGENT_MANAGER_DB_PATH,
    skills: process.env.AGENT_MANAGER_SKILL_HOME,
  };
  process.env.AGENT_MANAGER_DB_PATH = join(directory, 'test.sqlite');
  process.env.AGENT_MANAGER_SKILL_HOME = join(directory, 'provider-home');
  process.env.PATH = `${directory}/bin:${original.path}`;
  const { database } = await import('../src/lib/database.ts');
  const { getSettings, saveSettings } =
    await import('../src/repositories/settings.ts');
  const { updateSettings, resolveDefaults, newChatDefaults } =
    await import('../src/services/settings.ts');
  const { getAppSettings, patchAppSettings } =
    await import('../src/controllers/settings.ts');
  const { createAgent, deleteAgent } =
    await import('../src/repositories/agents.ts');
  const { insertSession } = await import('../src/repositories/sessions.ts');
  const {
    normalizeUsage,
    beginUsage,
    finishUsage,
    saveUsage,
    saveCumulativeUsage,
    usageSummary,
    usageRecords,
  } = await import('../src/repositories/usage.ts');
  const { usageReport, localDay } = await import('../src/services/usage.ts');
  const { ChatSession } = await import('../src/services/chat.ts');
  const { OpenCodeChatSession } =
    await import('../src/services/opencodeChat.ts');
  const { recordAntigravityUsage } =
    await import('../src/lib/providers/antigravity/usage.ts');
  const settings = {
    model: null,
    effort: null,
    permissions: 'workspace-write',
  };
  const session = (id, provider = 'codex') => ({
    id,
    name: null,
    projectId: null,
    workingDirectory: directory,
    provider,
    status: 'running',
    startedAt: new Date().toISOString(),
    endedAt: null,
    exitCode: null,
    codexConversationId: null,
    providerConversationId: null,
    resumedFrom: null,
    lastResumedAt: null,
    agentId: null,
    agentName: null,
    agentInstructions: null,
    mode: 'interactive',
    transport: 'chat',
    chatSettings: { ...settings },
  });
  try {
    await t.test(
      'settings preserve provider choices and reject invalid preferences atomically',
      async () => {
        assert.equal(getSettings().timezone, 'Asia/Kolkata');
        await updateSettings({ shortcutsEnabled: false, timezone: 'UTC' });
        const before = getSettings();
        for (const invalid of [
          { timezone: 'Bad/Zone' },
          { timezone: '' },
          { shortcutsEnabled: 'yes' },
          { providers: { unknown: { model: null } } },
          { providers: { codex: { model: 123, effort: null } } },
          { providers: { codex: { model: null, effort: 123 } } },
          { providers: { codex: { permissions: 'danger-full-access' } } },
          { providers: [] },
          { providers: { codex: null } },
        ]) {
          await assert.rejects(
            updateSettings(invalid),
            (error) => error.status === 400,
          );
          assert.deepEqual(getSettings(), before);
        }
        const initial = getSettings();
        initial.providers.codex = { model: null, effort: 'high' };
        saveSettings(initial);
        assert.deepEqual(getSettings().providers.codex, {
          model: null,
          effort: 'high',
        });
        const catalog = [
          {
            model: 'fixture-a',
            isDefault: true,
            supportedReasoningEfforts: [{ reasoningEffort: 'high' }],
          },
        ];
        assert.equal(resolveDefaults('codex', catalog).notice, null);
        const prefs = getSettings();
        prefs.providers.codex = { model: 'removed', effort: 'high' };
        saveSettings(prefs);
        assert.deepEqual(resolveDefaults('codex', catalog).settings, settings);
        assert.match(resolveDefaults('codex', catalog).notice, /unavailable/);
        assert.equal(getSettings().providers.codex.model, 'removed');
        let body;
        getAppSettings(
          {},
          {
            json: (value) => {
              body = value;
            },
          },
        );
        assert.deepEqual(body, getSettings());
        await patchAppSettings(
          { body: { timezone: 'Asia/Kolkata' } },
          {
            json: (value) => {
              body = value;
            },
          },
          (error) => {
            throw error;
          },
        );
        assert.equal(body.timezone, 'Asia/Kolkata');
        await updateSettings({
          providers: {
            codex: { model: null, effort: null },
            antigravity: { model: null, effort: null },
            opencode: { model: null, effort: null },
          },
        });
        assert.equal(
          (await newChatDefaults('antigravity', directory)).settings.model,
          null,
        );
      },
    );
    await t.test(
      'Codex totals deduplicate notifications and survive resume, missing data and late completion updates',
      () => {
        const info = session('codex');
        info.codexConversationId = 'thread';
        info.chatSettings.model = 'fixture-a';
        const chat = Object.assign(Object.create(ChatSession.prototype), {
          info,
          usageModel: 'fixture-a',
          resumedUsage: false,
          items: new Map(),
          requests: new Map(),
          events: new EventEmitter(),
          changed() {},
          flush() {},
        });
        const emit = (method, params) =>
          chat.receive({ method, params: { threadId: 'thread', ...params } });
        const tokens = (input, output) => ({
          inputTokens: input,
          outputTokens: output,
          totalTokens: input + output,
          cachedInputTokens: 0,
          cacheWriteInputTokens: 0,
          reasoningOutputTokens: 2,
        });
        emit('turn/started', { turn: { id: 'one' } });
        const notification = {
          turnId: 'one',
          tokenUsage: { total: tokens(100, 20), last: tokens(100, 20) },
        };
        emit('thread/tokenUsage/updated', notification);
        emit('thread/tokenUsage/updated', notification);
        emit('thread/tokenUsage/updated', {
          turnId: 'one',
          tokenUsage: { total: tokens(160, 30), last: tokens(60, 10) },
        });
        emit('thread/tokenUsage/updated', notification);
        emit('turn/completed', {
          turn: { id: 'one', status: 'completed', items: [] },
        });
        assert.equal(usageSummary(info.id).total, 190);
        assert.equal(usageSummary(info.id).coverage, 'reported');
        chat.resumedUsage = true;
        emit('thread/tokenUsage/updated', {
          turnId: 'one',
          tokenUsage: { total: tokens(160, 30), last: tokens(60, 10) },
        });
        emit('turn/started', { turn: { id: 'two' } });
        emit('turn/completed', {
          turn: { id: 'two', status: 'completed', items: [] },
        });
        assert.equal(usageSummary(info.id).coverage, 'partial');
        emit('thread/tokenUsage/updated', {
          turnId: 'two',
          tokenUsage: { total: tokens(210, 40), last: tokens(50, 10) },
        });
        assert.equal(usageSummary(info.id).total, 250);
        assert.equal(usageSummary(info.id).coverage, 'reported');
        emit('turn/started', { turn: { id: 'interrupted' } });
        emit('thread/tokenUsage/updated', {
          turnId: 'interrupted',
          tokenUsage: { total: tokens(220, 42), last: tokens(10, 2) },
        });
        emit('turn/completed', {
          turn: { id: 'interrupted', status: 'interrupted', items: [] },
        });
        assert.equal(usageSummary(info.id).total, 262);
        assert.equal(usageSummary(info.id).coverage, 'partial');
        const legacy = session('legacy');
        saveCumulativeUsage(
          legacy,
          'codex',
          'old-turn',
          tokens(1000, 100),
          tokens(100, 10),
          'fixture-a',
          true,
        );
        assert.equal(usageSummary('legacy').total, null);
        beginUsage(legacy, 'new-turn');
        saveCumulativeUsage(
          legacy,
          'codex',
          'new-turn',
          tokens(1100, 110),
          tokens(100, 10),
          'fixture-a',
          true,
        );
        finishUsage('legacy', 'new-turn', true);
        assert.equal(usageSummary('legacy').total, 110);
        const noBaseline = session('no-baseline');
        beginUsage(noBaseline, 'new');
        saveCumulativeUsage(
          noBaseline,
          'codex',
          'new',
          tokens(5000, 500),
          tokens(50, 5),
          'fixture-a',
          true,
        );
        finishUsage(noBaseline.id, 'new', true);
        assert.equal(usageSummary(noBaseline.id).total, 55);
        assert.equal(usageSummary(noBaseline.id).coverage, 'partial');
      },
    );
    await t.test(
      'one Codex turn spanning midnight is split by recorded usage time',
      async (clock) => {
        clock.mock.timers.enable({
          apis: ['Date'],
          now: Date.parse('2026-10-15T18:29:59Z'),
        });
        const info = session('midnight');
        beginUsage(info, 'turn');
        const counters = (total) => ({
          inputTokens: total,
          outputTokens: 0,
          totalTokens: total,
        });
        saveCumulativeUsage(
          info,
          'codex',
          'turn',
          counters(100),
          counters(100),
          'model',
          false,
        );
        clock.mock.timers.setTime(Date.parse('2026-10-15T18:30:01Z'));
        saveCumulativeUsage(
          info,
          'codex',
          'turn',
          counters(150),
          counters(50),
          'model',
          false,
        );
        finishUsage(info.id, 'turn', true);
        const report = usageReport({
          from: '2026-10-15',
          to: '2026-10-16',
          sessionId: info.id,
        });
        assert.equal(report.total, 150);
        assert.equal(report.daily[0].total, 100);
        assert.equal(report.daily[1].total, 50);
      },
    );
    await t.test(
      'OpenCode paginates without combining cursor and order and deduplicates usage',
      async () => {
        const info = session('opencode', 'opencode');
        info.providerConversationId = 'ses_fixture';
        info.chatSettings.model = 'fixture/model';
        const message = {
          id: 'assistant',
          type: 'assistant',
          model: { providerID: 'fixture', id: 'model' },
          content: [],
          time: { completed: 1 },
          tokens: {
            input: 100,
            output: 20,
            reasoning: 5,
            cache: { read: 50, write: 10 },
          },
        };
        let data = [message];
        const messageQueries = [];
        const chat = Object.assign(
          Object.create(OpenCodeChatSession.prototype),
          {
            info,
            usageTurnId: 'turn',
            turnBaseline: new Set(),
            seenIdle: new Set(),
            seenMessageIds: new Set(),
            items: new Map(),
            fragments: new Map(),
            requests: new Map(),
            forms: new Map(),
            events: new EventEmitter(),
            state: 'working',
            closing: false,
            changed() {},
            update(item) {
              this.items.set(item.id, item);
            },
            server: {
              async request(path) {
                if (!path.includes('/message?')) return { data: [] };
                const query = new URL(path, 'http://localhost').searchParams;
                messageQueries.push(query);
                assert.equal(query.get('limit'), '100');
                if (query.has('cursor')) {
                  assert.equal(query.has('order'), false);
                } else {
                  assert.equal(query.get('order'), 'asc');
                }
                const offset = Number(query.get('cursor') ?? 0);
                return {
                  data: data.slice(offset, offset + 1),
                  cursor:
                    offset + 1 < data.length
                      ? { next: String(offset + 1) }
                      : {},
                };
              },
            },
          },
        );
        await chat.read(true);
        assert.equal(usageSummary(info.id).total, null);
        beginUsage(info, 'turn');
        data = [
          message,
          { id: 'user', type: 'user', text: 'Continue' },
          { id: 'idle', type: 'idle', outcome: 'succeeded' },
        ];
        await chat.read(false);
        await chat.read(false);
        assert.equal(messageQueries.length, 7);
        assert.deepEqual(
          messageQueries.map((query) => query.get('cursor')),
          [null, null, '1', '2', null, '1', '2'],
        );
        assert.equal(chat.items.get('user').text, 'Continue');
        assert.equal(chat.seenIdle.has('idle'), true);
        assert.equal(usageSummary(info.id).input, 160);
        assert.equal(usageSummary(info.id).output, 25);
        assert.equal(usageSummary(info.id).total, 185);
        assert.equal(usageSummary(info.id).coverage, 'reported');
        assert.equal(usageRecords(info.id).length, 1);
      },
    );
    await t.test(
      'Antigravity final results replace steps, including interrupted and missing reports',
      () => {
        const info = session('agy', 'antigravity');
        beginUsage(info, 'turn');
        const steps = new Map();
        const usage = {
          input_tokens: 100,
          output_tokens: 20,
          total_tokens: 120,
          thinking_tokens: 5,
          cache_read_tokens: 50,
        };
        const emit = (event, payload) =>
          recordAntigravityUsage(info, 'turn', steps, event, payload, 'gemini');
        emit('step_update', { step_index: 1, usage });
        emit('step_update', { step_index: 1, usage });
        assert.equal(usageSummary(info.id).total, 120);
        emit('step_update', {
          step_index: 2,
          usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
        });
        assert.equal(usageSummary(info.id).total, 132);
        assert.equal(usageSummary(info.id).coverage, 'partial');
        emit('result', {
          status: 'SUCCESS',
          usage: {
            input_tokens: 110,
            output_tokens: 22,
            total_tokens: 132,
            thinking_tokens: 5,
            cache_read_tokens: 50,
          },
        });
        assert.equal(usageSummary(info.id).total, 132);
        assert.equal(usageSummary(info.id).cached, 50);
        assert.equal(usageSummary(info.id).coverage, 'reported');
        assert.equal(usageRecords(info.id).length, 1);
        beginUsage(info, 'interrupted');
        recordAntigravityUsage(
          info,
          'interrupted',
          new Map(),
          'step_update',
          { step_index: 1, usage },
          'gemini',
        );
        assert.equal(usageSummary(info.id).total, 252);
        assert.equal(usageSummary(info.id).coverage, 'partial');
      },
    );
    await t.test(
      'deleted agents retain historical attribution and cannot reuse reporting IDs',
      () => {
        const first = createAgent({
          name: 'Original',
          provider: 'codex',
          instructions: 'Original instructions',
        });
        const info = session('agent-history');
        info.agentId = first.id;
        info.agentName = first.name;
        beginUsage(info, 'first');
        saveUsage(
          info,
          'first',
          'first',
          normalizeUsage('codex', {
            inputTokens: 10,
            outputTokens: 1,
            totalTokens: 11,
          }),
          {},
        );
        finishUsage(info.id, 'first', true);
        deleteAgent(first.id);
        const next = createAgent({
          name: 'Replacement',
          provider: 'codex',
          instructions: 'New instructions',
        });
        assert.notEqual(next.id, first.id);
        info.agentId = null;
        beginUsage(info, 'after-delete');
        saveUsage(
          info,
          'after-delete',
          'after-delete',
          normalizeUsage('codex', {
            inputTokens: 20,
            outputTokens: 2,
            totalTokens: 22,
          }),
          {},
        );
        finishUsage(info.id, 'after-delete', true);
        assert.equal(usageRecords(info.id)[1].agentId, first.id);
        assert.equal(usageRecords(info.id)[1].agentName, 'Original');
        assert.equal(usageReport({ agentId: String(next.id) }).total, null);
        assert.equal(usageReport({ agentId: String(first.id) }).total, 33);
      },
    );
    await t.test(
      'daily timezone boundaries, filters, invalid ranges, zero vs missing and retained totals',
      async () => {
        const info = session('report', 'codex');
        insertSession(info);
        beginUsage(info, 'report-turn', 'model-a');
        saveUsage(
          info,
          'record',
          'report-turn',
          normalizeUsage('codex', {
            inputTokens: 100,
            outputTokens: 10,
            totalTokens: 110,
          }),
          { inputTokens: 100, outputTokens: 10, totalTokens: 110 },
          'model-a',
          '2026-10-15T18:45:00.000Z',
        );
        finishUsage(info.id, 'report-turn', true);
        database
          .prepare(
            "UPDATE usage_turns SET observedAt='2026-10-15T18:45:00.000Z' WHERE sessionId='report'",
          )
          .run();
        assert.equal(
          localDay('2026-10-15T18:29:59Z', 'Asia/Kolkata'),
          '2026-10-15',
        );
        assert.equal(
          localDay('2026-10-15T18:30:00Z', 'Asia/Kolkata'),
          '2026-10-16',
        );
        assert.equal(
          localDay('2026-11-01T05:30:00Z', 'America/New_York'),
          '2026-11-01',
        );
        const query = {
          from: '2026-10-16',
          to: '2026-10-16',
          sessionId: 'report',
        };
        assert.equal(usageReport(query).total, 110);
        assert.equal(usageReport({ ...query, model: 'other' }).total, null);
        await updateSettings({ timezone: 'UTC' });
        assert.equal(usageReport(query).total, null);
        assert.equal(
          usageReport({ ...query, from: '2026-10-15', to: '2026-10-15' }).total,
          110,
        );
        database.prepare("DELETE FROM sessions WHERE id='report'").run();
        assert.equal(
          usageReport({ ...query, from: '2026-10-15', to: '2026-10-15' }).total,
          110,
        );
        assert.equal(
          usageReport({ ...query, from: '2026-10-15', to: '2026-10-15' })
            .breakdown[0].model,
          'model-a',
        );
        for (const invalid of [
          { from: '2026-02-30' },
          { from: 'bad' },
          { from: '2026-10-17', to: '2026-10-16' },
          { from: '2020-01-01' },
          { provider: 'bad' },
          { agentId: '-1' },
          { model: [] },
        ])
          assert.throws(
            () => usageReport(invalid),
            (error) => error.status === 400,
          );
        assert.equal(
          normalizeUsage('codex', {
            inputTokens: -1,
            outputTokens: '20',
            totalTokens: NaN,
          }).total,
          null,
        );
        const zero = session('zero');
        beginUsage(zero, 'zero');
        saveUsage(
          zero,
          'zero',
          'zero',
          normalizeUsage('codex', {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
          }),
          {},
        );
        finishUsage('zero', 'zero', true);
        assert.equal(usageSummary('zero').total, 0);
        assert.equal(usageSummary('zero').coverage, 'reported');
        beginUsage(zero, 'missing');
        finishUsage('zero', 'missing', true);
        assert.equal(usageSummary('zero').coverage, 'partial');
      },
    );
  } finally {
    database.close();
    for (const [key, value] of Object.entries({
      PATH: original.path,
      AGENT_MANAGER_DB_PATH: original.db,
      AGENT_MANAGER_SKILL_HOME: original.skills,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(directory, { recursive: true, force: true });
  }
});
