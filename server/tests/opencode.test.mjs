import assert from 'node:assert/strict';
import { once } from 'node:events';
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  copyFile,
  chmod,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

test(
  'OpenCode v2: migration, project models, instructions, streaming, approvals, questions, resume, interrupt and scheduled sessions',
  { timeout: 40000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-manager-opencode-'));
    const originalPath = process.env.PATH,
      originalDatabase = process.env.AGENT_MANAGER_DB_PATH;
    const originalSkillHome = process.env.AGENT_MANAGER_SKILL_HOME;
    process.env.AGENT_MANAGER_DB_PATH = join(directory, 'test.sqlite');
    process.env.AGENT_MANAGER_SKILL_HOME = join(
      directory,
      'test.sqlite',
    ).replace(/[^/]+$/, 'provider-home');
    process.env.PATH = directory + '/bin:' + originalPath;
    await mkdir(join(directory, 'bin'));
    await copyFile(
      new URL('./fixtures/opencode.cjs', import.meta.url),
      join(directory, 'bin', 'opencode'),
    );
    let fixture = await readFile(join(directory, 'bin', 'opencode'), 'utf8');
    await writeFile(
      join(directory, 'bin', 'opencode'),
      '#!' + process.execPath + '\n' + fixture,
    );
    await chmod(join(directory, 'bin', 'opencode'), 0o755);
    const legacy = new DatabaseSync(process.env.AGENT_MANAGER_DB_PATH);
    legacy.exec(`CREATE TABLE agents(id INTEGER PRIMARY KEY,name TEXT NOT NULL COLLATE NOCASE UNIQUE,instructions TEXT NOT NULL,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL);
 INSERT INTO agents VALUES(7,'Existing','Keep me','2026-01-01','2026-01-01');`);
    legacy.close();
    const { database } = await import('../src/lib/database.ts');
    const { findSessionById } = await import('../src/repositories/sessions.ts');
    const { default: app } = await import('../src/app.ts');
    const { getSession, shutdownSessions } =
      await import('../src/services/sessions.ts');
    const {
      initializeScheduledSessions,
      dispatchScheduledSessions,
      stopScheduledSessions,
      enqueueSchedule,
    } = await import('../src/services/scheduledSessions.ts');
    database.prepare('INSERT INTO projects(name) VALUES(?)').run('OpenCode');
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = 'http://127.0.0.1:' + server.address().port;
    const sessionBody = (method, path, body) =>
      method === 'POST' &&
      /\/projects\/\d+\/session$/.test(path) &&
      !body?.resumeSessionId
        ? { workingDirectory: directory, ...body }
        : body;
    const request = (method, path, body) =>
      fetch(base + '/api' + path, {
        method,
        headers: { Origin: base, 'Content-Type': 'application/json' },
        body: JSON.stringify(sessionBody(method, path, body)),
      });
    const waitFor = async (predicate) => {
      const deadline = Date.now() + 7000;
      while (!(await predicate())) {
        if (Date.now() > deadline) throw Error('Timed out');
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    };
    const settings = {
      model: 'test/fixture',
      effort: 'high',
      permissions: 'workspace-write',
    };
    try {
      assert.equal(
        database.prepare('SELECT * FROM agents WHERE id=7').get().instructions,
        'Keep me',
      );
      assert.equal(
        database
          .prepare('PRAGMA table_info(agents)')
          .all()
          .some((column) => column.name === 'provider'),
        false,
      );
      const models = await (
        await request(
          'GET',
          `/providers/opencode/models?workingDirectory=${encodeURIComponent(directory)}`,
        )
      ).json();
      assert.equal(models[0].model, 'test/fixture');
      assert.equal(models[0].providerId, 'test');
      assert.equal(models[0].providerName, 'Test Provider');
      assert.equal(
        models[0].supportedReasoningEfforts[0].reasoningEffort,
        'high',
      );
      const logs = () =>
        readFile(join(directory, 'requests.jsonl'), 'utf8').then((s) =>
          s.trim().split('\n').map(JSON.parse),
        );
      assert.ok(
        (await logs()).some(
          (x) =>
            x.path === '/api/model' &&
            x.query.some(
              ([key, value]) =>
                key === 'location[directory]' && value === directory,
            ),
        ),
      );
      assert.equal(
        (
          await request('POST', '/projects/1/session', {
            provider: 'opencode',
            transport: 'terminal',
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await request('POST', '/projects/1/session', {
            provider: 'opencode',
            transport: 'chat',
            settings: { ...settings, effort: 'wrong' },
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await request('POST', '/projects/1/session', {
            provider: 'opencode',
            transport: 'chat',
            settings: { ...settings, mode: 'invalid' },
          })
        ).status,
        400,
      );
      const skill = await (
        await request('POST', '/skills', {
          name: 'Review',
          instructions: 'Check correctness',
        })
      ).json();
      const agentResponse = await request('POST', '/agents', {
        name: 'OpenCode agent',
        instructions: 'Review code',
        skillIds: [skill.id],
      });
      assert.equal(agentResponse.status, 201);
      const agent = await agentResponse.json();
      const started = await request('POST', '/projects/1/session', {
        agentId: agent.id,
        provider: 'opencode',
        transport: 'chat',
        settings: { ...settings, mode: 'plan' },
      });
      assert.equal(started.status, 201, await started.clone().text());
      const { session } = await started.json();
      assert.equal(session.chatSettings.mode, 'plan');
      const chat = () => getSession(1).chat;
      const send = (prompt) =>
        request('POST', `/sessions/${session.id}/messages`, { prompt });
      assert.match(getSession(1).info.providerConversationId, /^ses_/);
      assert.equal(getSession(1).info.codexConversationId, null);
      assert.ok(
        (await logs()).some(
          (entry) =>
            entry.path === '/api/session' && entry.body.agent === 'plan',
        ),
      );
      const planPatch = (await logs())
        .filter((entry) => entry.method === 'PATCH')
        .at(-1);
      assert.deepEqual(planPatch.body.permissions.slice(-2), [
        { action: 'edit', resource: '*', effect: 'deny' },
        { action: 'edit', resource: '/native/plan/*', effect: 'allow' },
      ]);
      assert.ok(
        (await logs()).some(
          (x) =>
            x.path.includes('/instructions/entries/') &&
            x.body.value.includes('review:') &&
            !x.body.value.includes('Check correctness'),
        ),
      );
      assert.equal((await send('hello')).status, 202);
      await waitFor(() =>
        [...chat().items.values()].some(
          (x) => x.text === 'Hello ' && x.status === 'inProgress',
        ),
      );
      assert.equal((await send('busy')).status, 409);
      await waitFor(() => chat().state === 'idle');
      assert.equal(chat().error, null);
      assert.ok(
        [...chat().items.values()].some(
          (x) => x.text === 'Hello OpenCode' && x.status === 'completed',
        ),
      );
      assert.equal((await send('approval')).status, 202);
      await waitFor(() => chat().requests.has('per_fixture'));
      assert.equal(
        (
          await request(
            'POST',
            `/sessions/${session.id}/requests/per_fixture`,
            { decision: 'accept' },
          )
        ).status,
        200,
      );
      await waitFor(() => chat().state === 'idle');
      assert.ok((await logs()).some((x) => x.body.decision === 'once'));
      assert.equal((await send('question')).status, 202);
      await waitFor(() => chat().requests.has('frm_fixture'));
      assert.equal(
        (
          await request(
            'POST',
            `/sessions/${session.id}/requests/frm_fixture`,
            { answers: { choice: 'a' } },
          )
        ).status,
        200,
      );
      await waitFor(() => chat().state === 'idle');
      assert.ok((await logs()).some((x) => x.body.answer?.choice === 'a'));
      await request('PUT', `/skills/${skill.id}`, {
        name: 'Review',
        description: 'Updated review workflow.',
        instructions: 'Updated native body.',
      });
      assert.equal((await send('$review inspect this')).status, 202);
      await waitFor(() => chat().state === 'idle');
      assert.ok(
        (await logs()).some(
          (entry) =>
            entry.path.endsWith('/prompt') &&
            entry.body.text === '@review inspect this',
        ),
      );
      assert.ok(
        (await logs()).some((entry) => entry.path === '/api/location/reload'),
      );
      const native = getSession(1).info.providerConversationId;
      for (const [permissions, approvalPolicy, expected] of [
        ['danger-full-access', 'never', 'allow'],
        ['danger-full-access', 'on-request', 'ask'],
        ['workspace-write', 'never', 'deny'],
        ['workspace-write', 'on-request', 'ask'],
      ]) {
        assert.equal(
          (
            await request('POST', `/sessions/${session.id}/messages`, {
              prompt: 'hello',
              settings: { ...settings, permissions, approvalPolicy },
            })
          ).status,
          202,
        );
        await waitFor(() => chat().state === 'idle');
        const patch = (await logs()).filter((x) => x.method === 'PATCH').at(-1);
        assert.equal(patch.body.permissions[0].effect, expected);
        assert.ok(
          patch.body.permissions.some(
            (rule) =>
              rule.action === 'edit' &&
              rule.resource ===
                (permissions === 'danger-full-access'
                  ? '*'
                  : directory + '/**') &&
              rule.effect === 'allow',
          ),
        );
      }
      assert.equal(
        (await logs())
          .filter(
            (entry) => entry.path.endsWith('/agent') && entry.method === 'POST',
          )
          .at(-1).body.agent,
        'build',
      );
      assert.equal(
        (
          await request('POST', `/sessions/${session.id}/messages`, {
            prompt: 'Plan this change',
            settings: { ...settings, mode: 'plan' },
          })
        ).status,
        202,
      );
      await waitFor(() => chat().state === 'idle');
      assert.equal(chat().snapshot().settings.mode, 'plan');
      const count = chat().items.size;
      await request('DELETE', '/projects/1/session');
      await waitFor(() => getSession(1).info.status === 'exited');
      const resumed = await request('POST', '/projects/1/session', {
        transport: 'chat',
        resumeSessionId: session.id,
      });
      assert.equal(resumed.status, 201, await resumed.clone().text());
      assert.equal((await resumed.json()).session.id, session.id);
      assert.equal(getSession(1).info.providerConversationId, native);
      assert.equal(chat().snapshot().settings.mode, 'plan');
      assert.equal(
        (await logs())
          .filter(
            (entry) => entry.path.endsWith('/agent') && entry.method === 'POST',
          )
          .at(-1).body.agent,
        'plan',
      );
      assert.equal(chat().items.size, count);
      assert.equal(
        database.prepare('SELECT count(*) AS n FROM sessions').get().n,
        1,
      );
      assert.equal((await send('error')).status, 202);
      await waitFor(() => chat().state === 'idle');
      assert.equal(chat().error, 'Fixture failure');
      assert.equal((await send('wait')).status, 202);
      await waitFor(() => chat().state === 'working');
      assert.equal(
        (await request('POST', `/sessions/${session.id}/interrupt`, {})).status,
        200,
      );
      await waitFor(() => chat().state === 'idle');
      assert.equal(chat().error, null);
      assert.equal(
        (
          await request('POST', `/sessions/${session.id}/messages`, {
            prompt: 'hello',
            settings: { ...settings, permissions: 'read-only' },
          })
        ).status,
        202,
      );
      await waitFor(() => chat().state === 'idle');
      const patches = (await logs()).filter((x) => x.method === 'PATCH');
      assert.equal(patches.at(-1).body.permissions[0].effect, 'deny');
      assert.ok(
        !patches
          .at(-1)
          .body.permissions.some(
            (x) => x.action === 'shell' && x.effect === 'allow',
          ),
      );
      const missingPlan = join(directory, 'no-plan');
      await writeFile(missingPlan, '');
      const beforePrompts = (await logs()).filter((entry) =>
        entry.path.endsWith('/prompt'),
      ).length;
      const unavailable = await request(
        'POST',
        `/sessions/${session.id}/messages`,
        {
          prompt: 'Do not execute this',
          settings: { ...settings, mode: 'plan' },
        },
      );
      assert.equal(unavailable.status, 503);
      assert.match(
        (await unavailable.json()).error,
        /Plan agent is unavailable/,
      );
      assert.equal(
        (await logs()).filter((entry) => entry.path.endsWith('/prompt')).length,
        beforePrompts,
      );
      await rm(missingPlan);
      assert.equal(
        (
          await request('POST', `/sessions/${session.id}/messages`, {
            prompt: 'Plan read only',
            settings: { ...settings, mode: 'plan', permissions: 'read-only' },
          })
        ).status,
        202,
      );
      await waitFor(() => chat().state === 'idle');
      const readonlyPlan = (await logs())
        .filter((entry) => entry.method === 'PATCH')
        .at(-1);
      assert.equal(readonlyPlan.body.permissions[0].effect, 'deny');
      assert.ok(
        !readonlyPlan.body.permissions.some(
          (rule) => rule.action === 'edit' && rule.effect === 'allow',
        ),
      );
      const attachment = join(directory, 'reference.pdf');
      await writeFile(attachment, 'PDF fixture bytes');
      assert.equal(
        (
          await request('POST', `/sessions/${session.id}/messages`, {
            prompt: 'Read the reference',
            attachments: [{ path: attachment }],
          })
        ).status,
        202,
      );
      await waitFor(() => chat().state === 'idle');
      const attachmentRequest = (await logs())
        .filter((entry) => entry.path.endsWith('/prompt'))
        .at(-1);
      assert.ok(attachmentRequest.body.text.includes(attachment));
      assert.equal(attachmentRequest.body.files[0].mime, 'application/pdf');
      assert.equal(
        attachmentRequest.body.files[0].data,
        Buffer.from('PDF fixture bytes').toString('base64'),
      );
      await request('DELETE', '/projects/1/session');
      await waitFor(() => getSession(1).info.status === 'exited');
      initializeScheduledSessions();
      const input = {
        name: 'Scheduled task',
        projectId: 1,
        workingDirectory: directory,
        agentId: agent.id,
        provider: 'opencode',
        prompt: 'job',
        settings: { model: null, effort: null, permissions: 'workspace-write' },
        timeoutMinutes: 1,
        enabled: true,
        kind: 'once',
        runAt: new Date(Date.now() + 60000).toISOString(),
        timezone: 'UTC',
      };
      const create = async (body) => {
        const response = await request('POST', '/schedules', {
          ...input,
          ...body,
        });
        assert.equal(response.status, 201, await response.clone().text());
        return response.json();
      };
      const schedule = await create({});
      const scheduled = enqueueSchedule(schedule);
      await dispatchScheduledSessions();
      await waitFor(
        () => findSessionById(scheduled.id).outcome === 'succeeded',
      );
      assert.equal(findSessionById(scheduled.id).result, 'Hello OpenCode');
      assert.equal(findSessionById(scheduled.id).transport, 'chat');
      const scheduledResume = await request('POST', '/projects/1/session', {
        transport: 'chat',
        resumeSessionId: scheduled.id,
      });
      assert.equal(
        scheduledResume.status,
        201,
        await scheduledResume.clone().text(),
      );
      assert.equal((await scheduledResume.json()).session.id, scheduled.id);
      await request('DELETE', '/projects/1/session');
      await waitFor(() => getSession(1).info.status === 'exited');
      const needsApproval = enqueueSchedule(
        await create({ prompt: 'approval' }),
      );
      await dispatchScheduledSessions();
      await waitFor(() => getSession(1).chat.requests.size === 1);
      assert.equal(findSessionById(needsApproval.id).outcome, null);
      const approval = [...getSession(1).chat.requests.values()][0];
      assert.equal(
        (
          await request(
            'POST',
            `/sessions/${needsApproval.id}/requests/${approval.id}`,
            { decision: 'accept' },
          )
        ).status,
        200,
      );
      await waitFor(
        () => findSessionById(needsApproval.id).outcome === 'succeeded',
      );
      const waiting = enqueueSchedule(await create({ prompt: 'wait' }));
      await dispatchScheduledSessions();
      await waitFor(() => getSession(1).chat.state === 'working');
      assert.equal(
        (await request('POST', `/sessions/${waiting.id}/cancel`, {})).status,
        200,
      );
      await waitFor(() => findSessionById(waiting.id).outcome === 'cancelled');
      await writeFile(join(directory, 'no-models'), '');
      const empty = await request('POST', '/projects/1/session', {
        provider: 'opencode',
        transport: 'chat',
      });
      assert.equal(empty.status, 503);
      assert.match((await empty.json()).error, /No OpenCode model/);
      assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
    } finally {
      stopScheduledSessions();
      await shutdownSessions();
      await new Promise((resolve) => server.close(resolve));
      database.close();
      process.env.PATH = originalPath;
      if (originalDatabase === undefined)
        delete process.env.AGENT_MANAGER_DB_PATH;
      else process.env.AGENT_MANAGER_DB_PATH = originalDatabase;
      if (originalSkillHome === undefined)
        delete process.env.AGENT_MANAGER_SKILL_HOME;
      else process.env.AGENT_MANAGER_SKILL_HOME = originalSkillHome;
      await rm(directory, { recursive: true, force: true });
    }
  },
);
