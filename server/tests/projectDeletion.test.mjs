import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test(
  'project deletion requires a session choice, preserves live and scheduled work, and deletes history atomically',
  { timeout: 30000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'manager-project-delete-'));
    const old = {
      PATH: process.env.PATH,
      AGENT_MANAGER_DB_PATH: process.env.AGENT_MANAGER_DB_PATH,
      AGENT_MANAGER_SKILL_HOME: process.env.AGENT_MANAGER_SKILL_HOME,
    };
    await mkdir(join(dir, 'bin'));
    await writeFile(
      join(dir, 'bin/codex'),
      await readFile(new URL('./fixtures/codex.cjs', import.meta.url)),
      { mode: 0o755 },
    );
    process.env.PATH = `${dir}/bin:${old.PATH}`;
    process.env.AGENT_MANAGER_DB_PATH = join(dir, 'test.sqlite');
    process.env.AGENT_MANAGER_SKILL_HOME = join(dir, 'skills');
    const { database } = await import('../src/lib/database.ts');
    const { default: app } = await import('../src/app.ts');
    const { getSessionById, shutdownSessions } =
      await import('../src/services/sessions.ts');
    const { deleteProject } = await import('../src/services/projects.ts');
    const { findSchedule } = await import('../src/repositories/schedules.ts');
    const {
      initializeScheduledSessions,
      enqueueSchedule,
      dispatchScheduledSessions,
      stopScheduledSessions,
    } = await import('../src/services/scheduledSessions.ts');
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const request = (method, path, body, origin) =>
      fetch(base + path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(origin ? { Origin: origin } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const json = async (method, path, body) => {
      const response = await request(method, path, body);
      assert.ok(response.ok, await response.clone().text());
      return response.status === 204 ? undefined : response.json();
    };
    const wait = async (check) => {
      const deadline = Date.now() + 5000;
      while (!check()) {
        if (Date.now() > deadline) throw Error('Timed out');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    };
    const scheduleInput = (projectId) => ({
      name: 'Maintenance',
      projectId,
      kind: 'once',
      runAt: new Date(Date.now() + 60000).toISOString(),
      timezone: 'UTC',
      enabled: true,
      steps: [
        {
          name: 'Review',
          workingDirectory: dir,
          prompt: 'fast',
          provider: 'codex',
          agentId: null,
          settings: { model: null, effort: null, permissions: 'read-only' },
          timeoutMinutes: 1,
        },
      ],
    });
    try {
      initializeScheduledSessions();
      const empty = await json('POST', '/projects', { name: 'Empty' });
      assert.equal((await json('GET', '/projects'))[0].sessionCount, 0);
      await json('DELETE', `/projects/${empty.id}`);
      assert.deepEqual(await json('GET', '/projects'), []);
      assert.equal((await request('DELETE', '/projects/999')).status, 404);
      assert.equal((await request('DELETE', '/projects/bad')).status, 400);

      const project = await json('POST', '/projects', { name: 'Keep running' });
      const session = (
        await json('POST', '/sessions', {
          projectId: project.id,
          workingDirectory: dir,
          transport: 'chat',
        })
      ).session;
      await json('POST', `/sessions/${session.id}/messages`, {
        prompt: 'fast',
      });
      const schedule = await json(
        'POST',
        '/schedules',
        scheduleInput(project.id),
      );
      const queued = enqueueSchedule(findSchedule(schedule.id));
      const counts = (await json('GET', '/projects'))[0];
      assert.equal(counts.sessionCount, 2);
      assert.equal(counts.activeSessionCount, 1);
      assert.equal(counts.scheduleCount, 1);
      for (const disposition of [undefined, 'empty', 'delete'])
        assert.equal(
          (
            await request(
              'DELETE',
              `/projects/${project.id}`,
              disposition ? { sessionDisposition: disposition } : {},
            )
          ).status,
          409,
        );
      for (const sessionDisposition of ['invalid', null, ['keep'], 42])
        assert.equal(
          (
            await request('DELETE', `/projects/${project.id}`, {
              sessionDisposition,
            })
          ).status,
          400,
        );
      assert.equal(
        (
          await request(
            'DELETE',
            `/projects/${project.id}`,
            { sessionDisposition: 'keep' },
            'https://untrusted.example',
          )
        ).status,
        403,
      );
      assert.equal(getSessionById(session.id).info.projectId, project.id);
      await json('DELETE', `/projects/${project.id}`, {
        sessionDisposition: 'keep',
      });
      assert.equal(getSessionById(session.id).info.projectId, null);
      assert.equal(getSessionById(session.id).info.status, 'running');
      const preserved = await json('GET', `/sessions/${session.id}`);
      assert.equal(preserved.projectId, null);
      assert.equal(preserved.name, 'fast');
      assert.equal(preserved.workingDirectory, dir);
      assert.ok(
        database
          .prepare('SELECT COUNT(*) AS n FROM session_items WHERE sessionId=?')
          .get(session.id).n > 0,
      );
      assert.equal(
        (await json('GET', `/sessions/${queued.id}`)).projectId,
        null,
      );
      assert.equal(findSchedule(schedule.id).projectId, null);
      assert.equal(findSchedule(schedule.id).steps[0].workingDirectory, dir);
      await dispatchScheduledSessions();
      await wait(() => getSessionById(queued.id)?.info.status === 'exited');
      await json('POST', `/sessions/${session.id}/cancel`, {});
      await wait(() => getSessionById(session.id).info.status === 'exited');
      await json('POST', `/sessions/${session.id}/resume`, {
        transport: 'chat',
      });
      assert.equal(getSessionById(session.id).info.projectId, null);
      await json('POST', `/sessions/${session.id}/cancel`, {});
      await wait(() => getSessionById(session.id).info.status === 'exited');

      const doomed = await json('POST', '/projects', {
        name: 'Delete history',
      });
      const doomedSession = (
        await json('POST', '/sessions', {
          projectId: doomed.id,
          workingDirectory: dir,
          transport: 'chat',
        })
      ).session;
      await json('POST', `/sessions/${doomedSession.id}/messages`, {
        prompt: 'fast',
      });
      await json('POST', `/sessions/${doomedSession.id}/cancel`, {});
      await wait(
        () => getSessionById(doomedSession.id).info.status === 'exited',
      );
      const alias = randomUUID();
      database
        .prepare(
          "INSERT INTO sessions(id,projectId,workingDirectory,provider,status,startedAt,resumedFrom) VALUES(?,?,?,'codex','exited',?,?)",
        )
        .run(alias, doomed.id, dir, new Date().toISOString(), doomedSession.id);
      const future = await json('POST', '/schedules', scheduleInput(doomed.id));
      const removedQueue = enqueueSchedule(findSchedule(future.id));
      // The dispatcher is suspended in its folder check when deletion happens.
      const dispatch = dispatchScheduledSessions();
      deleteProject(doomed.id, 'delete');
      await dispatch;
      for (const id of [doomedSession.id, alias, removedQueue.id]) {
        assert.equal((await request('GET', `/sessions/${id}`)).status, 404);
        assert.equal(getSessionById(id), undefined);
        assert.equal(
          database
            .prepare(
              'SELECT COUNT(*) AS n FROM session_items WHERE sessionId=?',
            )
            .get(id).n,
          0,
        );
      }
      assert.equal(findSchedule(future.id).projectId, null);
      assert.equal((await json('GET', `/sessions/${session.id}`)).name, 'fast');

      const moving = await json('POST', '/projects', { name: 'Move queued' });
      const movingSchedule = await json(
        'POST',
        '/schedules',
        scheduleInput(moving.id),
      );
      const movingQueue = enqueueSchedule(findSchedule(movingSchedule.id));
      const pendingDispatch = dispatchScheduledSessions();
      deleteProject(moving.id, 'keep');
      await pendingDispatch;
      await wait(
        () => getSessionById(movingQueue.id)?.info.status === 'exited',
      );
      assert.equal(getSessionById(movingQueue.id).info.projectId, null);
      assert.equal(
        (await json('GET', `/sessions/${movingQueue.id}`)).projectId,
        null,
      );
      assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
      assert.equal(
        database.prepare('PRAGMA integrity_check').get().integrity_check,
        'ok',
      );
    } finally {
      stopScheduledSessions();
      await shutdownSessions();
      await new Promise((resolve) => server.close(resolve));
      database.close();
      for (const [key, value] of Object.entries(old)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await rm(dir, { recursive: true, force: true });
    }
  },
);
