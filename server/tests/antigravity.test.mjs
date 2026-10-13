import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

test(
  'Antigravity provider: migration, models, streaming, settings, same-session resume, errors, cancellation and scheduled sessions',
  { timeout: 30000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-manager-agy-'));
    const originalPath = process.env.PATH;
    const originalDatabase = process.env.AGENT_MANAGER_DB_PATH;
    const originalSkillHome = process.env.AGENT_MANAGER_SKILL_HOME;
    process.env.AGENT_MANAGER_DB_PATH = join(directory, 'test.sqlite');
    process.env.AGENT_MANAGER_SKILL_HOME = join(
      directory,
      'test.sqlite',
    ).replace(/[^/]+$/, 'provider-home');
    process.env.PATH = `${directory}/bin:${originalPath}`;
    await mkdir(join(directory, 'bin'));
    const legacy = new DatabaseSync(process.env.AGENT_MANAGER_DB_PATH);
    legacy.exec(`CREATE TABLE agents (id INTEGER PRIMARY KEY,name TEXT NOT NULL COLLATE NOCASE UNIQUE,provider TEXT NOT NULL CHECK (provider = 'codex'),instructions TEXT NOT NULL,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL);
    INSERT INTO agents VALUES (7,'Existing','codex','Existing instructions','2026-01-01','2026-01-01');
    CREATE TABLE skills (id INTEGER PRIMARY KEY,name TEXT NOT NULL COLLATE NOCASE UNIQUE,instructions TEXT NOT NULL,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL);
    INSERT INTO skills VALUES (3,'Review','Check correctness','2026-01-01','2026-01-01');
    CREATE TABLE agent_skills (agentId INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,skillId INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,PRIMARY KEY(agentId,skillId));
    INSERT INTO agent_skills VALUES (7,3);`);
    legacy.close();
    await writeFile(
      join(directory, 'bin', 'agy'),
      `#!${process.execPath}
const fs = require('node:fs');
const readline = require('node:readline');
const args = process.argv.slice(2);
if(args[0] === 'models') { console.log('Fetching available models...'); console.log('fixture-gemini\\tFixture Gemini'); console.log('fixture-claude\\tFixture Claude'); process.exit(0); }
const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const out = value => process.stdout.write(JSON.stringify(value)+'\\n');
readline.createInterface({input:process.stdin}).once('line', line => {
 const input = JSON.parse(line);
 fs.writeFileSync('launch.json',JSON.stringify({args,input}));
 const prompt = input.message.content;
 out({event:'init',conversation_id:id,init:{}});
 if(prompt.endsWith('crash')) { process.exit(3); }
 if(prompt.endsWith('malformed')) { console.log('invalid-json'); process.exit(0); }
 out({event:'step_update',step_update:{conversation_id:id,step_index:1,state:'ACTIVE',step_type:'agent_response',text_delta:'Hello '}});
 if(prompt.endsWith('wait')) { setInterval(()=>{},1000); return; }
 setTimeout(()=>{
   out({event:'step_update',step_update:{conversation_id:id,step_index:2,state:'DONE',step_type:'tool',tool_name:'run_command',tool_info:{parameters:{CommandLine:'printf hello'},output:'hello'}}});
   out({event:'step_update',step_update:{conversation_id:id,step_index:1,state:'DONE',step_type:'agent_response',text_delta:'world'}});
   out({event:'result',result:{conversation_id:id,status:prompt.endsWith('error')?'ERROR':'SUCCESS',response:'Hello world',error:prompt.endsWith('error')?'Fixture error':undefined}});
 },100);
});
`,
      { mode: 0o755 },
    );
    const { database } = await import('../src/lib/database.ts');
    const { findSessionById } = await import('../src/repositories/sessions.ts');
    const { default: app } = await import('../src/app.ts');
    const { getSession, shutdownSessions } =
      await import('../src/services/sessions.ts');
    const { listSessionItems } =
      await import('../src/repositories/sessionItems.ts');
    const {
      initializeScheduledSessions,
      dispatchScheduledSessions,
      stopScheduledSessions,
      enqueueSchedule,
    } = await import('../src/services/scheduledSessions.ts');
    database.prepare('INSERT INTO projects(name) VALUES(?)').run('AGY');
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const sessionBody = (method, path, body) =>
      method === 'POST' &&
      /\/projects\/\d+\/session$/.test(path) &&
      !body?.resumeSessionId
        ? { workingDirectory: directory, ...body }
        : body;
    const request = (method, path, body) =>
      fetch(base + '/api' + path, {
        method,
        headers: {
          Origin: base,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(sessionBody(method, path, body)),
      });
    const waitFor = async (predicate) => {
      const deadline = Date.now() + 5000;
      while (!(await predicate())) {
        if (Date.now() > deadline) throw Error('Timed out');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    };
    const settings = {
      mode: 'plan',
      model: 'fixture-gemini',
      effort: 'high',
      permissions: 'workspace-write',
    };
    try {
      const existing = await (await request('GET', '/agents/7')).json();
      assert.equal(existing.name, 'Existing');
      assert.equal(existing.skills[0].id, 3);
      assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
      const models = await (
        await request('GET', '/providers/antigravity/models')
      ).json();
      assert.deepEqual(
        models.map((model) => model.model),
        ['fixture-gemini', 'fixture-claude'],
      );
      assert.equal(
        (await request('GET', '/providers/missing/models')).status,
        404,
      );
      assert.equal(
        (
          await request('POST', '/projects/1/session', {
            provider: 'antigravity',
          })
        ).status,
        400,
      );
      for (const invalid of [
        { ...settings, model: 'missing' },
        { ...settings, effort: 'ultra' },
        { ...settings, permissions: 'read-only' },
      ])
        assert.equal(
          (
            await request('POST', '/projects/1/session', {
              provider: 'antigravity',
              transport: 'chat',
              settings: invalid,
            })
          ).status,
          400,
        );
      const agentResponse = await request('POST', '/agents', {
        name: 'AGY Reviewer',
        provider: 'antigravity',
        instructions: 'Review "quoted" code. Treat $(commands) as text.',
        skillIds: [3],
      });
      assert.equal(agentResponse.status, 201);
      const agent = await agentResponse.json();
      assert.equal(
        (
          await request('POST', '/projects/1/session', {
            agentId: agent.id,
            provider: 'codex',
            transport: 'chat',
          })
        ).status,
        400,
      );
      const start = await request('POST', '/projects/1/session', {
        agentId: agent.id,
        transport: 'chat',
        settings,
      });
      assert.equal(start.status, 201);
      const { session } = await start.json();
      assert.equal(session.provider, 'antigravity');
      assert.equal(session.codexConversationId, null);
      const chat = () => getSession(1).chat;
      const send = (prompt) =>
        request('POST', `/sessions/${session.id}/messages`, { prompt });
      assert.equal((await send('hello')).status, 202);
      await waitFor(
        () =>
          chat().items.size > 1 &&
          [...chat().items.values()].some((item) => item.text === 'Hello '),
      );
      assert.equal((await send('another')).status, 409);
      await waitFor(() => chat().state === 'idle');
      assert.equal(chat().error, null);
      assert.equal(
        [...chat().items.values()].find((item) => item.role === 'assistant')
          .text,
        'Hello world',
      );
      assert.equal(
        [...chat().items.values()].find(
          (item) => item.type === 'commandExecution',
        ).text,
        'hello',
      );
      let launch = JSON.parse(
        await readFile(join(directory, 'launch.json'), 'utf8'),
      );
      assert.equal(launch.input.event, 'user');
      assert.equal(launch.args[launch.args.indexOf('--mode') + 1], 'plan');
      assert.match(launch.input.message.content, /review-3:/);
      assert.doesNotMatch(launch.input.message.content, /Check correctness/);
      assert.ok(!launch.args.includes('--disable-slash-commands'));
      assert.match(launch.input.message.content, /User message:\nhello$/);
      assert.deepEqual(launch.args.slice(-4), [
        '--model',
        'fixture-gemini',
        '--effort',
        'high',
      ]);
      assert.ok(!launch.args.includes('--dangerously-skip-permissions'));
      assert.equal(
        getSession(1).info.providerConversationId,
        'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      );
      const nextSettings = {
        ...settings,
        approvalPolicy: 'never',
        model: 'fixture-claude',
        effort: 'max',
      };
      assert.equal(
        (
          await request('POST', `/sessions/${session.id}/messages`, {
            prompt: '$review-3 next',
            settings: nextSettings,
          })
        ).status,
        202,
      );
      await waitFor(() => chat().state === 'idle');
      launch = JSON.parse(
        await readFile(join(directory, 'launch.json'), 'utf8'),
      );
      assert.equal(
        launch.args[launch.args.indexOf('--conversation') + 1],
        getSession(1).info.providerConversationId,
      );
      assert.equal(
        launch.args[launch.args.indexOf('--model') + 1],
        'fixture-claude',
      );
      assert.ok(launch.args.includes('--dangerously-skip-permissions'));
      assert.match(
        launch.input.message.content,
        /^\/review-3 next\n\nAgent instructions:/,
      );
      await request('DELETE', '/projects/1/session');
      await waitFor(() => getSession(1).info.status === 'exited');
      assert.equal(
        listSessionItems(session.id).filter((item) => item.role === 'user')
          .length,
        2,
      );
      const resumed = await request('POST', '/projects/1/session', {
        transport: 'chat',
        resumeSessionId: session.id,
      });
      assert.equal(resumed.status, 201);
      assert.equal((await resumed.json()).session.id, session.id);
      assert.equal(chat().items.size, listSessionItems(session.id).length);
      assert.deepEqual(getSession(1).info.chatSettings, nextSettings);
      for (const prompt of ['error', 'crash', 'malformed']) {
        assert.equal((await send(prompt)).status, 202);
        await waitFor(() => chat().state === 'idle');
        assert.ok(chat().error);
      }
      assert.equal((await send('wait')).status, 202);
      await waitFor(() =>
        [...chat().items.values()].some(
          (item) => item.text === 'Hello ' && item.status === 'inProgress',
        ),
      );
      assert.equal(
        (await request('POST', `/sessions/${session.id}/interrupt`, {})).status,
        200,
      );
      await waitFor(() => chat().state === 'idle');
      assert.equal(chat().error, null);
      assert.ok(
        [...chat().items.values()].some(
          (item) => item.status === 'interrupted',
        ),
      );
      await request('DELETE', '/projects/1/session');
      await waitFor(() => getSession(1).info.status === 'exited');
      initializeScheduledSessions();
      const input = {
        name: 'Scheduled task',
        projectId: 1,
        workingDirectory: directory,
        agentId: agent.id,
        provider: 'antigravity',
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
      assert.equal(findSessionById(scheduled.id).result, 'Hello world');
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
      assert.equal(
        (
          await request('POST', '/schedules', {
            ...input,
            settings: { ...input.settings, permissions: 'read-only' },
          })
        ).status,
        400,
      );
      const waiting = enqueueSchedule(await create({ prompt: 'wait' }));
      await dispatchScheduledSessions();
      await waitFor(() => getSession(1).chat.state === 'working');
      assert.equal(
        (await request('POST', `/sessions/${waiting.id}/cancel`, {})).status,
        200,
      );
      await waitFor(() => findSessionById(waiting.id).outcome === 'cancelled');
      const missing = await request('POST', '/projects/1/session', {
        transport: 'chat',
        provider: 'antigravity',
      });
      assert.equal(missing.status, 201);
      const missingId = (await missing.json()).session.id;
      await rm(join(directory, 'bin', 'agy'));
      process.env.PATH = join(directory, 'bin');
      assert.equal(
        (
          await request('POST', `/sessions/${missingId}/messages`, {
            prompt: 'hello',
          })
        ).status,
        502,
      );
      await request('DELETE', '/projects/1/session');
      await waitFor(() => getSession(1).info.status === 'exited');
      assert.equal(
        (
          await request('POST', '/projects/1/session', {
            transport: 'chat',
            provider: 'antigravity',
          })
        ).status,
        503,
      );
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
