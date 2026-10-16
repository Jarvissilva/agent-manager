import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test(
  'ordered schedule sessions hand off results, freeze steps, stop on failure and recover safely',
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
    const opencodeFixture = await readFile(
      new URL('./fixtures/opencode.cjs', import.meta.url),
      'utf8',
    );
    await writeFile(
      join(dir, 'bin/opencode'),
      `#!${process.execPath}\n${opencodeFixture}`,
      { mode: 0o755 },
    );
    const { database } = await import('../src/lib/database.ts');
    const { default: app } = await import('../src/app.ts');
    const { getSession, getSessionById, shutdownSessions } =
      await import('../src/services/sessions.ts');
    const {
      findSessionById,
      listSessions,
      recoverSessionHistory,
      occurrenceSessions,
    } = await import('../src/repositories/sessions.ts');
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
    const step = (name, prompt = 'fast', provider = 'codex') => ({
      name,
      workingDirectory: dir,
      prompt,
      provider,
      agentId: null,
      settings: { model: null, effort: null, permissions: 'read-only' },
      timeoutMinutes: 1,
    });
    const workflow = (steps, overrides = {}) => create({ steps, ...overrides });
    const rows = (first) => occurrenceSessions(first.occurrenceId);
    const pump = async (predicate) =>
      wait(async () => {
        await dispatchScheduledSessions();
        return predicate();
      });
    try {
      for (const steps of [
        [],
        null,
        Array(21).fill(step('Too many')),
        [step('First'), step('', 'fast')],
        [step('First'), { ...step('Second'), timeoutMinutes: 0 }],
        [step('First'), { ...step('Second'), provider: 'missing' }],
      ]) {
        assert.equal(
          (await req('POST', '/schedules', { ...input, steps })).status,
          400,
        );
      }
      assert.equal((await json('GET', '/schedules')).length, 0);
      const agent = await json('POST', '/agents', {
        name: 'Reviewer',
        provider: 'codex',
        instructions: 'Frozen role',
      });
      const s = await workflow([
        {
          ...step('Implement'),
          agentId: agent.id,
          settings: {
            model: 'fixture-a',
            effort: 'high',
            permissions: 'read-only',
          },
        },
        step('Review', 'review', 'opencode'),
        step('Summarize', 'summarize'),
      ]);
      assert.deepEqual(
        s.steps.map((x) => x.name),
        ['Implement', 'Review', 'Summarize'],
      );
      assert.ok(!('prompt' in s));
      const first = enqueueSchedule(s);
      assert.equal(enqueueSchedule(s).id, first.id);
      assert.equal(rows(first).length, 3);
      assert.deepEqual(
        rows(first).map((x) => x.stepIndex),
        [0, 1, 2],
      );
      const frozen = rows(first);
      await json('PUT', `/agents/${agent.id}`, {
        ...agent,
        instructions: 'Changed role',
      });
      const updated = await json('PUT', `/schedules/${s.id}`, {
        ...s,
        steps: [step('Only future', 'changed')],
      });
      assert.equal(updated.steps.length, 1);
      assert.equal(rows(first)[0].agentInstructions, 'Frozen role');
      assert.equal(rows(first)[1].snapshot.prompt, 'review');
      assert.equal(rows(first)[0].chatSettings.effort, 'high');
      assert.equal((await req('DELETE', `/agents/${agent.id}`)).status, 204);
      await dispatchScheduledSessions();
      assert.equal(rows(first)[1].status, 'queued');
      await pump(() => rows(first).every((x) => x.outcome === 'succeeded'));
      assert.deepEqual(
        rows(first).map((x) => x.id),
        frozen.map((x) => x.id),
      );
      assert.equal(rows(first)[1].result, 'Hello OpenCode');
      const requests = (await readFile(join(dir, 'requests.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map(JSON.parse);
      const review = requests.find(
        (x) => x.method === 'POST' && /prompt$/.test(x.path),
      );
      assert.ok(review, 'second step sent a native OpenCode message');
      assert.match(JSON.stringify(review.body), /Fast response/);
      const turns = (await readFile(join(dir, 'turns.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map(JSON.parse);
      const summary = turns.at(-1).input[0].text;
      assert.match(summary, /summarize/);
      assert.match(summary, /Hello OpenCode/);
      assert.ok(
        !summary.includes('Fast response'),
        'only the immediate previous response is passed',
      );
      // Historical chat resumption does not create or rerun any workflow sessions.
      const last = rows(first).at(-1);
      const resumed = await json('POST', '/projects/1/session', {
        transport: 'chat',
        resumeSessionId: last.id,
      });
      assert.equal(resumed.session.id, last.id);
      await json('DELETE', '/projects/1/session');
      await wait(() => getSession(1).info.status === 'exited');
      assert.equal(rows(first).length, 3);

      const stable = await workflow([step('One'), step('Two')]);
      assert.equal(
        (
          await req('PUT', `/schedules/${stable.id}`, {
            ...stable,
            steps: [step('One'), step('')],
          })
        ).status,
        400,
      );
      assert.deepEqual(findSchedule(stable.id).steps, stable.steps);
      assert.equal(
        (await req('POST', '/schedules/preview', { ...stable, steps: [] }))
          .status,
        400,
      );
      const reordered = await json('PUT', `/schedules/${stable.id}`, {
        ...stable,
        steps: [...stable.steps].reverse(),
      });
      assert.deepEqual(
        reordered.steps.map((x) => x.name),
        ['Two', 'One'],
      );

      for (const prompt of ['reject', 'crash']) {
        const failed = enqueueSchedule(
          await workflow([
            step('Fail', prompt),
            step('Never'),
            step('Also never'),
          ]),
        );
        await pump(() => rows(failed)[0].outcome === 'failed');
        assert.deepEqual(
          rows(failed).map((x) => x.outcome),
          ['failed', 'skipped', 'skipped'],
        );
        assert.match(rows(failed)[1].error, /Fail/);
        assert.equal(listSessionItems(rows(failed)[1].id).length, 0);
      }
      const middleFailure = enqueueSchedule(
        await workflow([
          step('Success'),
          step('Fail second', 'reject'),
          step('Never'),
        ]),
      );
      await pump(() => rows(middleFailure)[1].outcome === 'failed');
      assert.deepEqual(
        rows(middleFailure).map((x) => x.outcome),
        ['succeeded', 'failed', 'skipped'],
      );

      const orderedOverlap = await workflow(
        [step('Approve', 'approve'), step('Finish')],
        { kind: 'cron', cron: '* * * * *' },
      );
      const orderedA = enqueueSchedule(orderedOverlap);
      const orderedB = enqueueSchedule({
        ...orderedOverlap,
        nextRunAt: new Date(
          Date.parse(orderedOverlap.nextRunAt) + 60000,
        ).toISOString(),
      });
      await dispatchScheduledSessions();
      await wait(
        () =>
          getSessionById(orderedA.id).chat.requests.size === 1 &&
          getSessionById(orderedB.id).chat.requests.size === 1,
      );
      assert.equal(rows(orderedA)[1].status, 'queued');
      assert.equal(rows(orderedB)[1].status, 'queued');
      await json('POST', `/sessions/${orderedA.id}/requests/approval-1`, {
        decision: 'accept',
      });
      await pump(() => rows(orderedA).every((x) => x.outcome === 'succeeded'));
      assert.ok(rows(orderedA).every((x) => x.outcome === 'succeeded'));
      assert.equal(rows(orderedB)[1].status, 'queued');
      await wait(() => getSessionById(orderedB.id).chat.requests.size === 1);
      await json('POST', `/sessions/${orderedB.id}/cancel`, {});
      await wait(() => rows(orderedB)[0].outcome === 'cancelled');
      const timeout = enqueueSchedule(
        await workflow([step('Timeout', 'wait'), step('Never')]),
      );
      database
        .prepare('UPDATE sessions SET snapshot=? WHERE id=?')
        .run(
          JSON.stringify({ ...timeout.snapshot, timeoutMinutes: 0.002 }),
          timeout.id,
        );
      await pump(() => rows(timeout)[0].outcome === 'timed_out');
      assert.equal(rows(timeout)[1].outcome, 'skipped');
      const cancel = enqueueSchedule(
        await workflow([step('Cancel', 'wait'), step('Never')]),
      );
      await dispatchScheduledSessions();
      await wait(() => getSession(1).chat.state === 'working');
      await json('POST', `/sessions/${cancel.id}/cancel`, {});
      await wait(() => rows(cancel)[0].outcome === 'cancelled');
      assert.equal(rows(cancel)[1].outcome, 'skipped');
      const queuedCancel = enqueueSchedule(
        await workflow([step('Cancel queued'), step('Never')]),
      );
      await json('POST', `/sessions/${queuedCancel.id}/cancel`, {});
      assert.deepEqual(
        rows(queuedCancel).map((x) => x.outcome),
        ['cancelled', 'skipped'],
      );

      // Independent occurrences can overlap; each occurrence still orders its own steps.
      const overlap = await workflow([step('First', 'wait'), step('Second')], {
        kind: 'cron',
        cron: '* * * * *',
      });
      const occurrenceA = enqueueSchedule(overlap);
      const occurrenceB = enqueueSchedule({
        ...overlap,
        nextRunAt: new Date(
          Date.parse(overlap.nextRunAt) + 60000,
        ).toISOString(),
      });
      await dispatchScheduledSessions();
      await wait(() => getSession(1).chat.state === 'working');
      const other = enqueueSchedule(
        await workflow([step('Other')], { projectId: 2 }),
      );
      await pump(() => rows(other)[0].outcome === 'succeeded');
      assert.equal(rows(occurrenceB)[0].status, 'running');
      assert.equal(rows(occurrenceB)[1].status, 'queued');
      await json('POST', `/sessions/${occurrenceA.id}/cancel`, {});
      await pump(() => rows(occurrenceA)[1].outcome === 'skipped');
      assert.equal(rows(occurrenceB)[0].status, 'running');
      assert.equal(rows(occurrenceA)[1].outcome, 'skipped');
      await wait(() => getSession(1).chat.state === 'working');
      stopScheduledSessions();
      await shutdownSessions();
      assert.deepEqual(
        rows(occurrenceB).map((x) => x.outcome),
        ['interrupted', 'skipped'],
      );
      recoverSessionHistory();
      initializeScheduledSessions();

      const empty = enqueueSchedule(
        await workflow([step('Empty', 'empty'), step('Next')]),
      );
      await pump(() => rows(empty).every((x) => x.outcome === 'succeeded'));
      const emptyTurns = (await readFile(join(dir, 'turns.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map(JSON.parse);
      assert.equal(emptyTurns.at(-1).input[0].text, 'fast');

      // Recovery also catches an abrupt crash before normal exit handlers execute.
      const restart = enqueueSchedule(
        await workflow([step('Interrupted'), step('Never')]),
      );
      database
        .prepare("UPDATE sessions SET status='running' WHERE id=?")
        .run(restart.id);
      const survives = enqueueSchedule(
        await workflow([step('Queued'), step('Then')]),
      );
      recoverSessionHistory();
      initializeScheduledSessions();
      assert.equal(rows(restart)[1].outcome, 'skipped');
      await pump(() => rows(survives).every((x) => x.outcome === 'succeeded'));
      const deletedSchedule = await workflow([
        step('Delete', 'wait'),
        step('Cancel rest'),
      ]);
      const deleted = enqueueSchedule(deletedSchedule);
      await dispatchScheduledSessions();
      await wait(() => getSession(1).chat.state === 'working');
      await json('DELETE', `/schedules/${deletedSchedule.id}`);
      assert.equal(rows(deleted)[0].status, 'running');
      assert.equal(rows(deleted)[1].outcome, 'cancelled');
      assert.equal(rows(deleted)[1].scheduleId, null);
      await json('POST', `/sessions/${deleted.id}/cancel`, {});
      await wait(() => rows(deleted)[0].outcome === 'cancelled');
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
