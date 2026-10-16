import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';

test('durable chat queues deliver once and preserve user control across failures and restarts', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-manager-queue-'));
  const oldPath = process.env.AGENT_MANAGER_DB_PATH;
  process.env.AGENT_MANAGER_DB_PATH = join(directory, 'queue.sqlite');
  const { database } = await import('../src/lib/database.ts');
  const { insertSession, deleteSessionRecords } =
    await import('../src/repositories/sessions.ts');
  const {
    chatQueue,
    enqueuePrompt,
    claimQueuedPrompt,
    pauseChatQueue,
    removeQueuedPrompt,
    updateQueuedPrompt,
    recoverChatQueues,
    supportsChatQueue,
  } = await import('../src/repositories/chatQueue.ts');
  const { attachChatQueue, dispatchChatQueue, queueEvents } =
    await import('../src/services/chatQueue.ts');
  const settings = {
    model: 'model-a',
    effort: 'high',
    permissions: 'workspace-write',
    mode: 'plan',
  };
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  const wait = async (predicate) => {
    for (let i = 0; i < 40; i++) {
      if (predicate()) return;
      await tick();
    }
    assert.ok(predicate(), 'Expected queue state was not reached.');
  };
  function fake(id, behavior) {
    const info = {
      id,
      name: null,
      projectId: null,
      workingDirectory: directory,
      provider: 'codex',
      status: 'running',
      startedAt: new Date().toISOString(),
      endedAt: null,
      exitCode: null,
      codexConversationId: 'thread',
      resumedFrom: null,
      lastResumedAt: null,
      agentId: null,
      agentName: null,
      agentInstructions: null,
      mode: 'interactive',
      transport: 'chat',
      chatSettings: settings,
    };
    insertSession(info);
    const chat = {
      info,
      state: 'idle',
      events: new EventEmitter(),
      ready: Promise.resolve(),
      calls: [],
      async send(prompt, selected, attachments) {
        this.calls.push({ prompt, settings: selected, attachments });
        this.state = 'working';
        if (behavior) await behavior.call(this, prompt);
      },
    };
    attachChatQueue(chat);
    return chat;
  }
  try {
    await t.test(
      'automations use their existing workflow until manually resumed',
      async () => {
        const chat = fake('automation');
        chat.info.source = 'schedule';
        chat.info.lastResumedAt = null;
        assert.equal(supportsChatQueue(chat.info), false);
        chat.info.lastResumedAt = new Date().toISOString();
        assert.equal(supportsChatQueue(chat.info), true);
        chat.info.transport = 'terminal';
        assert.equal(supportsChatQueue(chat.info), false);
        chat.state = 'closed';
      },
    );
    await t.test(
      'FIFO order, frozen settings, approvals, and concurrent dispatch',
      async () => {
        const chat = fake('fifo');
        chat.state = 'working';
        const first = enqueuePrompt(chat.info.id, 'first', settings);
        enqueuePrompt(chat.info.id, 'second', {
          ...settings,
          model: 'model-b',
        });
        settings.effort = 'low';
        await Promise.all([dispatchChatQueue(chat), dispatchChatQueue(chat)]);
        assert.equal(chat.calls.length, 0);
        assert.equal(chatQueue(chat.info.id).entries.length, 2);
        // Pending approvals/questions keep the provider working; no turn completion.
        chat.events.emit('change', { type: 'state', state: 'working' });
        await tick();
        assert.equal(chat.calls.length, 0);
        chat.state = 'idle';
        chat.events.emit('turn', 'completed');
        await wait(
          () =>
            chat.calls.length === 1 &&
            chatQueue(chat.info.id).entries.length === 1,
        );
        assert.equal(chat.calls[0].prompt, 'first');
        assert.equal(chat.calls[0].settings.effort, 'high');
        assert.equal(chat.calls[0].settings.mode, 'plan');
        assert.ok(
          !chatQueue(chat.info.id).entries.some((entry) => entry.id === first),
        );
        chat.state = 'idle';
        chat.events.emit('turn', 'succeeded');
        await wait(() => chat.calls.length === 2);
        assert.equal(chat.calls[1].prompt, 'second');
        assert.equal(chat.calls[1].settings.model, 'model-b');
        chat.state = 'closed';
      },
    );
    await t.test(
      'fast completion before send returns never duplicates or loses work',
      async () => {
        const chat = fake('fast', async function () {
          this.state = 'idle';
          this.events.emit('turn', 'completed');
        });
        chat.state = 'working';
        enqueuePrompt(chat.info.id, 'one', settings);
        enqueuePrompt(chat.info.id, 'two', settings);
        enqueuePrompt(chat.info.id, 'three', settings);
        chat.state = 'idle';
        await Promise.all([dispatchChatQueue(chat), dispatchChatQueue(chat)]);
        await wait(
          () =>
            chat.calls.length === 3 &&
            chatQueue(chat.info.id).entries.length === 0,
        );
        assert.deepEqual(
          chat.calls.map((call) => call.prompt),
          ['one', 'two', 'three'],
        );
        chat.state = 'closed';
      },
    );
    await t.test(
      'interruption pauses subsequent prompts until explicit resume',
      async () => {
        const chat = fake('stop');
        chat.state = 'working';
        enqueuePrompt(chat.info.id, 'pending', settings);
        chat.state = 'idle';
        chat.events.emit('turn', 'interrupted');
        await tick();
        assert.equal(chat.calls.length, 0);
        assert.equal(chatQueue(chat.info.id).paused, true);
        pauseChatQueue(chat.info.id, null);
        await dispatchChatQueue(chat);
        assert.equal(chat.calls.length, 1);
        chat.state = 'closed';
      },
    );
    await t.test(
      'delivery failure stays reviewable and retry requires explicit action',
      async () => {
        let reject = true;
        const chat = fake('failure', async function () {
          if (reject) {
            this.state = 'idle';
            throw Error('Provider unavailable');
          }
        });
        chat.state = 'working';
        const id = enqueuePrompt(chat.info.id, 'retry me', settings);
        enqueuePrompt(chat.info.id, 'after retry', settings);
        chat.state = 'idle';
        await dispatchChatQueue(chat);
        assert.equal(chatQueue(chat.info.id).entries[0].status, 'failed');
        assert.match(chatQueue(chat.info.id).entries[0].error, /unavailable/);
        assert.equal(chatQueue(chat.info.id).paused, true);
        await dispatchChatQueue(chat);
        assert.equal(chat.calls.length, 1);
        updateQueuedPrompt(chat.info.id, id, 'edited retry');
        reject = false;
        pauseChatQueue(chat.info.id, null);
        await dispatchChatQueue(chat);
        assert.equal(chat.calls[1].prompt, 'edited retry');
        assert.equal(chatQueue(chat.info.id).entries.length, 1);
        chat.state = 'closed';
      },
    );
    await t.test(
      'restart preserves order, pauses queued work and protects uncertain delivery',
      async () => {
        const chat = fake('restart');
        chat.state = 'working';
        const first = enqueuePrompt(chat.info.id, 'possibly sent', settings);
        const second = enqueuePrompt(chat.info.id, 'pending', settings);
        const claimed = claimQueuedPrompt(chat.info.id);
        assert.equal(claimed.id, first);
        assert.throws(
          () => removeQueuedPrompt(chat.info.id, first),
          (error) => error.status === 409,
        );
        assert.throws(
          () => updateQueuedPrompt(chat.info.id, first, 'edited'),
          (error) => error.status === 409,
        );
        recoverChatQueues();
        const queue = chatQueue(chat.info.id);
        assert.equal(queue.paused, true);
        assert.deepEqual(
          queue.entries.map((entry) => entry.id),
          [first, second],
        );
        assert.equal(queue.entries[0].status, 'failed');
        assert.match(queue.entries[0].error, /Check the conversation/);
        chat.state = 'idle';
        await dispatchChatQueue(chat);
        assert.equal(chat.calls.length, 0);
        removeQueuedPrompt(chat.info.id, first);
        pauseChatQueue(chat.info.id, null);
        await dispatchChatQueue(chat);
        assert.equal(chat.calls[0].prompt, 'pending');
        chat.state = 'closed';
      },
    );
    await t.test(
      'pausing during send prevents further dispatch and queue events contain no lost entries',
      async () => {
        let release;
        const gate = new Promise((resolve) => {
          release = resolve;
        });
        const chat = fake('pending-send', async () => gate);
        chat.state = 'working';
        enqueuePrompt(chat.info.id, 'one', settings);
        enqueuePrompt(chat.info.id, 'two', settings);
        const updates = [];
        const listener = (event) => updates.push(event);
        queueEvents.on(chat.info.id, listener);
        chat.state = 'idle';
        const sending = dispatchChatQueue(chat);
        assert.equal(chatQueue(chat.info.id).entries[0].status, 'sending');
        pauseChatQueue(chat.info.id, 'Paused');
        await dispatchChatQueue(chat);
        assert.equal(chat.calls.length, 1);
        release();
        await sending;
        assert.equal(chatQueue(chat.info.id).entries.length, 1);
        assert.equal(chatQueue(chat.info.id).paused, true);
        assert.ok(
          updates.some((event) => event.queue.entries[0]?.status === 'sending'),
        );
        queueEvents.off(chat.info.id, listener);
        chat.state = 'closed';
      },
    );
    await t.test(
      'attachments survive edits and restart recovery and reach provider dispatch',
      async () => {
        const chat = fake('attachments');
        chat.state = 'working';
        const files = [
          {
            path: '/tmp/reference.md',
            name: 'reference.md',
            size: 10,
            mime: 'text/markdown',
            source: 'reference',
          },
        ];
        const id = enqueuePrompt(chat.info.id, 'Read', settings, files);
        updateQueuedPrompt(chat.info.id, id, 'Read carefully');
        recoverChatQueues();
        assert.deepEqual(chatQueue(chat.info.id).entries[0].attachments, files);
        pauseChatQueue(chat.info.id, null);
        chat.state = 'idle';
        await dispatchChatQueue(chat);
        assert.deepEqual(chat.calls[0].attachments, files);
        assert.equal(chat.calls[0].prompt, 'Read carefully');
        chat.state = 'closed';
      },
    );
    await t.test('queue limits, session isolation and deletion cascade', () => {
      const one = fake('limit'),
        two = fake('other');
      one.state = 'working';
      two.state = 'working';
      for (let i = 0; i < 50; i++)
        enqueuePrompt(one.info.id, `prompt ${i}`, settings);
      assert.throws(
        () => enqueuePrompt(one.info.id, 'extra', settings),
        (error) => error.status === 400,
      );
      assert.equal(chatQueue(two.info.id).entries.length, 0);
      assert.throws(
        () =>
          removeQueuedPrompt(two.info.id, chatQueue(one.info.id).entries[0].id),
        (error) => error.status === 409,
      );
      pauseChatQueue(one.info.id, 'Paused');
      deleteSessionRecords(one.info.id);
      assert.equal(chatQueue(one.info.id).entries.length, 0);
      assert.equal(chatQueue(one.info.id).paused, false);
      one.state = 'closed';
      two.state = 'closed';
    });
  } finally {
    await tick();
    database.close();
    if (oldPath === undefined) delete process.env.AGENT_MANAGER_DB_PATH;
    else process.env.AGENT_MANAGER_DB_PATH = oldPath;
    await rm(directory, { recursive: true, force: true });
  }
});
