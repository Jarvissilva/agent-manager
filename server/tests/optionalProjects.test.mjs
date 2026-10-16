import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test(
  'standalone sessions and schedules run independently and can be organized later',
  { timeout: 30000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'manager-optional-projects-'));
    const old = {
      path: process.env.PATH,
      db: process.env.AGENT_MANAGER_DB_PATH,
      skills: process.env.AGENT_MANAGER_SKILL_HOME,
    };
    const code = join(dir, 'code'),
      infra = join(dir, 'infra'),
      other = join(dir, 'other');
    for (const path of [code, infra, other, join(dir, 'bin')])
      await mkdir(path);
    await writeFile(
      join(dir, 'bin/codex'),
      await readFile(new URL('./fixtures/codex.cjs', import.meta.url)),
      { mode: 0o755 },
    );
    process.env.PATH = `${dir}/bin:${old.path}`;
    process.env.AGENT_MANAGER_DB_PATH = join(dir, 'test.sqlite');
    process.env.AGENT_MANAGER_SKILL_HOME = join(dir, 'skill-home');
    const { database } = await import('../src/lib/database.ts');
    const { default: app } = await import('../src/app.ts');
    const { getSessionById, shutdownSessions } =
      await import('../src/services/sessions.ts');
    const { findSchedule } = await import('../src/repositories/schedules.ts');
    const { occurrenceSessions } =
      await import('../src/repositories/sessions.ts');
    const {
      initializeScheduledSessions,
      enqueueSchedule,
      dispatchScheduledSessions,
      stopScheduledSessions,
    } = await import('../src/services/scheduledSessions.ts');
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const req = (method, path, body) =>
      fetch(base + path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const json = async (method, path, body) => {
      const r = await req(method, path, body);
      assert.ok(r.ok, await r.clone().text());
      return r.status === 204 ? null : r.json();
    };
    const wait = async (predicate) => {
      const deadline = Date.now() + 5000;
      while (!(await predicate())) {
        if (Date.now() > deadline) throw Error('Timed out');
        await new Promise((r) => setTimeout(r, 15));
      }
    };
    const start = (workingDirectory) =>
      json('POST', '/sessions', { transport: 'chat', workingDirectory });
    const end = async (id) => {
      await json('POST', `/sessions/${id}/cancel`, {});
      await wait(() => getSessionById(id).info.status === 'exited');
    };
    try {
      assert.deepEqual(await json('GET', '/projects'), []);
      const a = (await start(code)).session,
        b = (await start(infra)).session;
      assert.equal(a.name, null);
      assert.equal(
        (await req('POST', `/sessions/${a.id}/messages`, { prompt: 'reject' }))
          .status,
        502,
      );
      assert.equal((await json('GET', `/sessions/${a.id}`)).name, null);
      await json('POST', `/sessions/${a.id}/messages`, { prompt: 'fast' });
      assert.equal((await json('GET', `/sessions/${a.id}`)).name, 'fast');
      const renamed = await json('PATCH', `/sessions/${a.id}`, {
        name: '  Review API  ',
      });
      assert.equal(renamed.name, 'Review API');
      assert.equal(getSessionById(a.id).info.name, 'Review API');
      await json('POST', `/sessions/${a.id}/messages`, { prompt: 'fast' });
      assert.equal((await json('GET', `/sessions/${a.id}`)).name, 'Review API');
      for (const name of ['', '  ', null, 42, 'x'.repeat(101), 'bad\0name'])
        assert.equal(
          (await req('PATCH', `/sessions/${a.id}`, { name })).status,
          400,
        );
      assert.equal(
        (await req('PATCH', '/sessions/missing', { name: 'Missing' })).status,
        404,
      );
      assert.equal(a.projectId, null);
      assert.equal(b.projectId, null);
      assert.notEqual(a.id, b.id);
      assert.equal(getSessionById(a.id).info.status, 'running');
      assert.equal(
        (await json('GET', `/sessions/${b.id}`)).workingDirectory,
        infra,
      );
      assert.equal((await json('GET', '/sessions')).length, 2);
      const project = await json('POST', '/projects', { name: 'Acme' });
      const renamedProject = await json('PATCH', `/projects/${project.id}`, {
        name: '  Acme app  ',
      });
      assert.equal(renamedProject.id, project.id);
      assert.equal(renamedProject.name, 'Acme app');
      assert.equal((await json('GET', '/projects'))[0].name, 'Acme app');
      for (const name of ['', ' ', null, 42, 'x'.repeat(101), 'bad\0name'])
        assert.equal(
          (await req('PATCH', `/projects/${project.id}`, { name })).status,
          400,
        );
      assert.equal(
        (await req('PATCH', '/projects/999', { name: 'Missing' })).status,
        404,
      );
      assert.equal(
        (await req('PATCH', '/projects/bad', { name: 'Invalid' })).status,
        400,
      );
      const foreignOrigin = await fetch(`${base}/projects/${project.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://untrusted.example',
        },
        body: JSON.stringify({ name: 'Blocked' }),
      });
      assert.equal(foreignOrigin.status, 403);
      assert.equal(
        (await req('PATCH', `/sessions/${a.id}`, { projectId: project.id }))
          .status,
        409,
      );
      await end(a.id);
      const alias = randomUUID(),
        nestedAlias = randomUUID();
      const copy = database.prepare(
        'INSERT INTO sessions(id,projectId,workingDirectory,provider,status,startedAt,codexConversationId,resumedFrom) VALUES(?,NULL,?, ?, ?, ?, ?, ?)',
      );
      copy.run(
        alias,
        code,
        a.provider,
        'exited',
        a.startedAt,
        a.codexConversationId,
        a.id,
      );
      copy.run(
        nestedAlias,
        code,
        a.provider,
        'exited',
        a.startedAt,
        a.codexConversationId,
        alias,
      );
      const assigned = await json('PATCH', `/sessions/${a.id}`, {
        projectId: project.id,
      });
      const aliasRename = await json('PATCH', `/sessions/${nestedAlias}`, {
        name: 'Renamed through alias',
      });
      assert.equal(aliasRename.id, a.id);
      assert.equal(aliasRename.name, 'Renamed through alias');
      assert.equal(
        database
          .prepare('SELECT name FROM sessions WHERE id=?')
          .get(nestedAlias).name,
        aliasRename.name,
      );
      assert.equal(assigned.projectId, project.id);
      await json('PATCH', `/projects/${project.id}`, { name: 'Acme' });
      assert.equal(
        (await json('GET', `/sessions/${a.id}`)).projectId,
        project.id,
      );
      assert.equal(
        database
          .prepare('SELECT projectId FROM sessions WHERE id=?')
          .get(nestedAlias).projectId,
        project.id,
      );
      assert.equal((await json('GET', `/sessions/${nestedAlias}`)).id, a.id);
      assert.equal(assigned.workingDirectory, code);
      assert.equal(
        (await json('GET', `/projects/${project.id}/session`)).sessions.length,
        1,
      );
      const resumed = await json('POST', `/sessions/${a.id}/resume`, {
        transport: 'chat',
      });
      assert.equal(resumed.session.name, 'Renamed through alias');
      assert.equal(resumed.session.id, a.id);
      assert.equal(resumed.session.projectId, project.id);
      const parallel = await json('POST', '/sessions', {
        transport: 'chat',
        projectId: project.id,
        workingDirectory: other,
      });
      assert.notEqual(parallel.session.id, a.id);
      await end(parallel.session.id);
      await json('DELETE', `/sessions/${parallel.session.id}`);
      await end(a.id);
      await json('PATCH', `/sessions/${a.id}`, { projectId: null });
      assert.equal(
        (await json('GET', `/projects/${project.id}/session`)).sessions.length,
        0,
      );
      const unassigned = await json('POST', `/sessions/${a.id}/resume`, {
        transport: 'chat',
      });
      assert.equal(unassigned.session.projectId, null);
      await end(a.id);
      await end(b.id);
      for (const projectId of [999, 0, 'bad'])
        assert.equal(
          (
            await req('POST', '/sessions', {
              transport: 'chat',
              workingDirectory: code,
              projectId,
            })
          ).status,
          projectId === 999 ? 404 : 400,
        );
      assert.equal(
        (await req('PATCH', `/sessions/${a.id}`, { projectId: 999 })).status,
        404,
      );
      assert.equal((await req('GET', '/sessions/missing')).status, 404);
      const step = (name, workingDirectory, prompt = 'fast') => ({
        name,
        workingDirectory,
        prompt,
        provider: 'codex',
        agentId: null,
        settings: { model: null, effort: null, permissions: 'read-only' },
        timeoutMinutes: 1,
      });
      const input = {
        name: 'Standalone maintenance',
        kind: 'once',
        runAt: new Date(Date.now() + 60000).toISOString(),
        timezone: 'UTC',
        enabled: true,
        steps: [step('Review', code), step('Deploy', infra)],
      };
      const schedule = await json('POST', '/schedules', input);
      assert.equal(schedule.projectId, null);
      assert.equal(schedule.projectName, null);
      assert.ok(
        (await json('GET', '/schedules')).some((s) => s.id === schedule.id),
      );
      initializeScheduledSessions();
      const first = enqueueSchedule(findSchedule(schedule.id));
      assert.equal(first.name, 'Review');
      await json('PATCH', `/sessions/${first.id}`, { name: 'One-off review' });
      const independent = await json('POST', '/schedules', {
        ...input,
        name: 'Independent',
        steps: [step('Check', other)],
      });
      const second = enqueueSchedule(findSchedule(independent.id));
      await json('PUT', `/schedules/${schedule.id}`, {
        ...input,
        projectId: project.id,
      });
      assert.ok(
        occurrenceSessions(first.occurrenceId).every(
          (s) => s.projectId === null && s.snapshot.projectName === null,
        ),
      );
      await wait(async () => {
        await dispatchScheduledSessions();
        return [
          ...occurrenceSessions(first.occurrenceId),
          ...occurrenceSessions(second.occurrenceId),
        ].every((s) => s.outcome === 'succeeded');
      });
      const firstRows = occurrenceSessions(first.occurrenceId);
      assert.deepEqual(
        firstRows.map((s) => s.workingDirectory),
        [code, infra],
      );
      assert.equal(firstRows[0].name, 'One-off review');
      assert.equal(firstRows[1].name, 'Deploy');
      assert.equal(findSchedule(schedule.id).steps[0].name, 'Review');
      assert.equal(firstRows[1].result, 'Fast response');
      assert.equal(
        (await json('GET', `/schedules/${schedule.id}/sessions`)).length,
        2,
      );
      await json('DELETE', `/schedules/${independent.id}`);
      assert.equal(
        (await json('GET', `/sessions/${second.id}`)).scheduleId,
        null,
      );
      assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
    } finally {
      stopScheduledSessions();
      await shutdownSessions();
      await new Promise((r) => server.close(r));
      database.close();
      for (const [key, value] of [
        ['PATH', old.path],
        ['AGENT_MANAGER_DB_PATH', old.db],
        ['AGENT_MANAGER_SKILL_HOME', old.skills],
      ]) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await rm(dir, { recursive: true, force: true });
    }
  },
);
