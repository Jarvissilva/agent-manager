import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test(
  'schedules create normal chats, freeze config, queue, approve, continue, cancel, timeout and recover',
  { timeout: 30000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'manager-schedules-'));
    const oldPath = process.env.PATH,
      oldDb = process.env.AGENT_MANAGER_DB_PATH;
    await mkdir(join(dir, 'bin'));
    await mkdir(join(dir, 'other'));
    await mkdir(join(dir, 'fail'));
    const fixture = await readFile(
      new URL('./fixtures/codex.cjs', import.meta.url),
      'utf8',
    );
    await writeFile(join(dir, 'bin/codex'), fixture, { mode: 0o755 });
    process.env.PATH = dir + '/bin:' + oldPath;
    const originalSkillHome = process.env.AGENT_MANAGER_SKILL_HOME;
    process.env.AGENT_MANAGER_DB_PATH = dir + '/test.sqlite';
    process.env.AGENT_MANAGER_SKILL_HOME = (dir + '/test.sqlite').replace(
      /[^/]+$/,
      'provider-home',
    );
    const { database } = await import('../src/lib/database.ts');
    const { default: app } = await import('../src/app.ts');
    const { getSession, shutdownSessions } =
      await import('../src/services/sessions.ts');
    const { findSessionById, listSessions, recoverSessionHistory } =
      await import('../src/repositories/sessions.ts');
    const { findSchedule } = await import('../src/repositories/schedules.ts');
    const {
      initializeScheduledSessions,
      dispatchScheduledSessions,
      stopScheduledSessions,
      enqueueSchedule,
    } = await import('../src/services/scheduledSessions.ts');
    const { tickSchedules } = await import('../src/services/schedules.ts');
    const { listSessionItems } =
      await import('../src/repositories/sessionItems.ts');
    for (const [name] of [
      ['Test', dir],
      ['Other', dir + '/other'],
      ['Failure', dir + '/fail'],
    ])
      database.prepare('INSERT INTO projects(name) VALUES(?)').run(name);
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const sessionBody = (method, path, body) =>
      method === 'POST' &&
      /\/projects\/\d+\/session$/.test(path) &&
      !body?.resumeSessionId
        ? { workingDirectory: dir, ...body }
        : body;
    const req = (method, path, body) =>
      fetch(base + path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sessionBody(method, path, body)),
      });
    const json = async (method, path, body) => {
      const r = await req(method, path, body);
      assert.ok(r.ok, await r.clone().text());
      return r.status === 204 ? null : r.json();
    };
    const wait = async (fn) => {
      const end = Date.now() + 5000;
      while (!(await fn())) {
        if (Date.now() > end) throw Error('Timed out');
        await new Promise((r) => setTimeout(r, 10));
      }
    };
    const input = {
      name: 'Review',
      projectId: 1,
      workingDirectory: dir,
      provider: 'codex',
      prompt: 'hello',
      settings: { model: null, effort: null, permissions: 'read-only' },
      timeoutMinutes: 1,
      kind: 'once',
      runAt: new Date(Date.now() + 60000).toISOString(),
      timezone: 'UTC',
      enabled: true,
    };
    const create = (body = {}) =>
      json('POST', '/schedules', { ...input, ...body });
    initializeScheduledSessions();
    try {
      assert.equal((await req('POST', '/jobs', {})).status, 404);
      assert.equal(
        (await req('POST', '/schedules', { ...input, timeoutMinutes: 0 }))
          .status,
        400,
      );
      assert.equal(
        (
          await req('POST', '/schedules', {
            ...input,
            cron: 'bad',
            kind: 'cron',
          })
        ).status,
        400,
      );
      const preview = await json('POST', '/schedules/preview', {
        ...input,
        kind: 'cron',
        cron: '0 9 * * 1-5',
      });
      assert.equal(preview.dates.length, 5);
      const s = await create();
      tickSchedules(new Date(Date.now() + 61000));
      tickSchedules(new Date(Date.now() + 61000));
      let all = listSessions(1);
      assert.equal(all.length, 1);
      const id = all[0].id;
      assert.equal(all[0].status, 'queued');
      assert.equal(findSchedule(s.id).completed, true);
      await json('PUT', `/schedules/${s.id}`, {
        ...s,
        steps: s.steps.map((step) => ({ ...step, prompt: 'changed' })),
      });
      assert.equal(findSessionById(id).snapshot.prompt, 'hello');
      await dispatchScheduledSessions();
      await wait(() => findSessionById(id).outcome === 'succeeded');
      assert.equal(findSessionById(id).result, 'Hello **world**');
      assert.equal(getSession(1).info.status, 'exited');
      assert.ok(listSessionItems(id).some((i) => i.type === 'fileChange'));
      const resumed = await json('POST', '/projects/1/session', {
        transport: 'chat',
        resumeSessionId: id,
      });
      assert.equal(resumed.session.id, id);
      await json('POST', `/sessions/${id}/messages`, { prompt: 'fast' });
      await wait(() => getSession(1).chat.state === 'idle');
      await json('DELETE', '/projects/1/session');
      await wait(() => getSession(1).info.status === 'exited');
      assert.equal(listSessions(1).length, 1);
      const approval = enqueueSchedule(await create({ prompt: 'approve' }));
      const queued = enqueueSchedule(await create({ prompt: 'fast' }));
      await dispatchScheduledSessions();
      await wait(() => getSession(1).chat.requests.size === 1);
      assert.equal(findSessionById(queued.id).status, 'queued');
      assert.equal(findSessionById(approval.id).outcome, null);
      const other = enqueueSchedule(
        await create({ projectId: 2, prompt: 'fast' }),
      );
      await dispatchScheduledSessions();
      await wait(() => findSessionById(other.id).outcome === 'succeeded');
      assert.equal(findSessionById(approval.id).status, 'running');

      assert.equal(
        (await req('POST', '/projects/1/session', { transport: 'chat' }))
          .status,
        409,
      );
      await json('POST', `/sessions/${approval.id}/requests/approval-1`, {
        decision: 'accept',
      });
      await wait(() => findSessionById(approval.id).outcome === 'succeeded');
      await dispatchScheduledSessions();
      await wait(() => findSessionById(queued.id).outcome === 'succeeded');
      const question = enqueueSchedule(await create({ prompt: 'question' }));
      await dispatchScheduledSessions();
      await wait(() => getSession(1).chat.requests.size === 1);
      await json('POST', `/sessions/${question.id}/requests/question-1`, {
        answers: { choice: 'First' },
      });
      await wait(() => findSessionById(question.id).outcome === 'succeeded');
      const rejected = enqueueSchedule(await create({ prompt: 'reject' }));
      await dispatchScheduledSessions();
      await wait(() => findSessionById(rejected.id).outcome === 'failed');
      assert.match(findSessionById(rejected.id).error, /rejected/);
      const broken = enqueueSchedule(
        await create({ projectId: 3, workingDirectory: dir + '/fail' }),
      );
      await dispatchScheduledSessions();
      await wait(() => findSessionById(broken.id).outcome === 'failed');
      const crash = enqueueSchedule(await create({ prompt: 'crash' }));
      await dispatchScheduledSessions();
      await wait(() => findSessionById(crash.id).outcome === 'failed');
      const waiting = enqueueSchedule(await create({ prompt: 'wait' }));
      await dispatchScheduledSessions();
      await wait(() => getSession(1).chat.state === 'working');
      const removed = await create();
      const cancelled = enqueueSchedule(removed);
      await json('DELETE', `/schedules/${removed.id}`);
      assert.equal(findSessionById(cancelled.id).outcome, 'cancelled');
      assert.equal(findSessionById(cancelled.id).scheduleId, null);
      await json('POST', `/sessions/${waiting.id}/cancel`, {});
      await wait(() => findSessionById(waiting.id).outcome === 'cancelled');
      // Shorten the frozen timeout directly to keep this integration test fast.
      const timed = enqueueSchedule(await create({ prompt: 'wait' }));
      database
        .prepare('UPDATE sessions SET snapshot=? WHERE id=?')
        .run(
          JSON.stringify({ ...timed.snapshot, timeoutMinutes: 0.002 }),
          timed.id,
        );
      await dispatchScheduledSessions();
      await wait(() => findSessionById(timed.id).outcome === 'timed_out');
      const activeSchedule = await create({ prompt: 'wait' });
      const active = enqueueSchedule(activeSchedule);
      await dispatchScheduledSessions();
      await wait(() => getSession(1).chat.state === 'working');
      await json('DELETE', `/schedules/${activeSchedule.id}`);
      assert.equal(findSessionById(active.id).status, 'running');
      const restartQueued = enqueueSchedule(await create({ prompt: 'fast' }));
      stopScheduledSessions();
      await shutdownSessions();
      assert.equal(findSessionById(active.id).outcome, 'interrupted');
      recoverSessionHistory();
      assert.equal(findSessionById(restartQueued.id).status, 'queued');
      initializeScheduledSessions();
      await dispatchScheduledSessions();
      await wait(
        () => findSessionById(restartQueued.id).outcome === 'succeeded',
      );
      assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
    } finally {
      stopScheduledSessions();
      await shutdownSessions();
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
      database.close();
      process.env.PATH = oldPath;
      if (oldDb === undefined) delete process.env.AGENT_MANAGER_DB_PATH;
      else process.env.AGENT_MANAGER_DB_PATH = oldDb;
      if (originalSkillHome === undefined)
        delete process.env.AGENT_MANAGER_SKILL_HOME;
      else process.env.AGENT_MANAGER_SKILL_HOME = originalSkillHome;
      await rm(dir, { recursive: true, force: true });
    }
  },
);
