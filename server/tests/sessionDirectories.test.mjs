import assert from 'node:assert/strict';
import { once } from 'node:events';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
  rename,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

test(
  'sessions own canonical folders, resume them, and schedule steps freeze independent directories',
  { timeout: 30000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'manager-session-directories-'));
    const old = {
      path: process.env.PATH,
      db: process.env.AGENT_MANAGER_DB_PATH,
      skills: process.env.AGENT_MANAGER_SKILL_HOME,
    };
    const code = join(dir, 'code'),
      infra = join(dir, 'infra');
    await mkdir(code);
    await mkdir(infra);
    await mkdir(join(dir, 'bin'));
    await symlink(code, join(dir, 'alias'));
    await writeFile(
      join(dir, 'bin/codex'),
      await readFile(new URL('./fixtures/codex.cjs', import.meta.url)),
      { mode: 0o755 },
    );
    process.env.PATH = `${dir}/bin:${old.path}`;
    process.env.AGENT_MANAGER_DB_PATH = join(dir, 'test.sqlite');
    process.env.AGENT_MANAGER_SKILL_HOME = join(dir, 'skills-home');
    const { database } = await import('../src/lib/database.ts');
    const { default: app } = await import('../src/app.ts');
    const { getSession, shutdownSessions } =
      await import('../src/services/sessions.ts');
    const { findSchedule } = await import('../src/repositories/schedules.ts');
    const { occurrenceSessions } =
      await import('../src/repositories/sessions.ts');
    const {
      enqueueSchedule,
      initializeScheduledSessions,
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
        await new Promise((r) => setTimeout(r, 20));
      }
    };
    try {
      const project = await json('POST', '/projects', { name: 'Acme' });
      assert.deepEqual(project.paths, []);
      const other = await json('POST', '/projects', { name: 'Other' });
      assert.equal(other.id, 2);
      const body = { transport: 'chat', provider: 'codex' };
      for (const workingDirectory of [
        undefined,
        'relative',
        join(dir, 'missing'),
        join(dir, 'bin/codex'),
      ])
        assert.equal(
          (
            await req('POST', '/projects/1/session', {
              ...body,
              workingDirectory,
            })
          ).status,
          400,
        );
      assert.equal(
        (await req('GET', '/providers/codex/models?workingDirectory=relative'))
          .status,
        400,
      );
      const models = await json(
        'GET',
        `/providers/codex/models?workingDirectory=${encodeURIComponent(infra)}`,
      );
      assert.ok(models.length);
      const started = await json('POST', '/projects/1/session', {
        ...body,
        workingDirectory: join(dir, 'alias'),
      });
      assert.equal(started.session.workingDirectory, code);
      const launch = JSON.parse(
        await readFile(join(code, 'launch.json'), 'utf8'),
      );
      assert.equal(launch.params.cwd, code);
      await json('DELETE', '/projects/1/session');
      await wait(() => getSession(1).info.status === 'exited');
      assert.equal(
        (
          await req('POST', '/projects/1/session', {
            ...body,
            resumeSessionId: started.session.id,
            workingDirectory: infra,
          })
        ).status,
        400,
      );
      const resumed = await json('POST', '/projects/1/session', {
        ...body,
        resumeSessionId: started.session.id,
      });
      assert.equal(resumed.session.id, started.session.id);
      assert.equal(resumed.session.workingDirectory, code);
      await json('DELETE', '/projects/1/session');
      await wait(() => getSession(1).info.status === 'exited');
      await rename(code, code + '-gone');
      assert.equal(
        (
          await req('POST', '/projects/1/session', {
            ...body,
            resumeSessionId: started.session.id,
          })
        ).status,
        400,
      );
      await rename(code + '-gone', code);
      const step = (name, workingDirectory) => ({
        name,
        workingDirectory,
        provider: 'codex',
        agentId: null,
        prompt: 'fast',
        settings: { model: null, effort: null, permissions: 'read-only' },
        timeoutMinutes: 1,
      });
      const input = {
        name: 'Maintenance',
        projectId: 1,
        kind: 'once',
        runAt: new Date(Date.now() + 60000).toISOString(),
        timezone: 'UTC',
        enabled: true,
        steps: [step('Code', code), step('Infra', infra)],
      };
      const schedule = await json('POST', '/schedules', input);
      initializeScheduledSessions();
      const queued = enqueueSchedule(findSchedule(schedule.id));
      await json('PUT', `/schedules/${schedule.id}`, {
        ...input,
        steps: [step('Future', code)],
      });
      assert.deepEqual(
        occurrenceSessions(queued.occurrenceId).map((s) => [
          s.workingDirectory,
          s.snapshot.workingDirectory,
        ]),
        [
          [code, code],
          [infra, infra],
        ],
      );
      await wait(async () => {
        await dispatchScheduledSessions();
        return occurrenceSessions(queued.occurrenceId).every(
          (s) => s.outcome === 'succeeded',
        );
      });
      assert.equal(
        JSON.parse(await readFile(join(infra, 'launch.json'), 'utf8')).params
          .cwd,
        infra,
      );
      const paths = (await json('GET', '/projects'))[0].paths;
      assert.deepEqual(paths, [code, infra]);
      assert.ok(
        (await json('GET', '/projects/1/session')).sessions.every(
          (s) => s.workingDirectory,
        ),
      );
      const sameFolder = await json('POST', '/projects/2/session', {
        ...body,
        workingDirectory: code,
      });
      assert.equal(sameFolder.session.workingDirectory, code);
      assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
    } finally {
      stopScheduledSessions();
      await shutdownSessions();
      await new Promise((r) => server.close(r));
      database.close();
      if (old.path === undefined) delete process.env.PATH;
      else process.env.PATH = old.path;
      if (old.db === undefined) delete process.env.AGENT_MANAGER_DB_PATH;
      else process.env.AGENT_MANAGER_DB_PATH = old.db;
      if (old.skills === undefined) delete process.env.AGENT_MANAGER_SKILL_HOME;
      else process.env.AGENT_MANAGER_SKILL_HOME = old.skills;
      await rm(dir, { recursive: true, force: true });
    }
  },
);
