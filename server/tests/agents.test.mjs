import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test(
  'agents CRUD, validation, session instructions and immutable resume configuration',
  { timeout: 15000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-manager-agents-'));
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
    await writeFile(
      join(directory, 'bin', 'codex'),
      `#!${process.execPath}
const fs=require('node:fs');
const args=process.argv.slice(2);
const logDir=JSON.parse(args.find(arg=>arg.startsWith('log_dir=')).slice(8));
fs.writeFileSync(logDir+'/codex-tui.log','INFO session_loop{thread_id=12345678-1234-5678-9012-123456789012}: codex_core::session: new\\n');
console.log('ARGS:'+JSON.stringify(args));
console.log('READY');
process.stdin.resume();
`,
      { mode: 0o755 },
    );
    const { database } = await import('../src/lib/database.ts');
    const { getSession, shutdownSessions } =
      await import('../src/services/sessions.ts');
    const { listSessions } = await import('../src/repositories/sessions.ts');
    const { default: app } = await import('../src/app.ts');
    database.prepare('INSERT INTO projects(name) VALUES(?)').run('Test');
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const sessionBody = (method, path, body) =>
      method === 'POST' &&
      /\/projects\/\d+\/session$/.test(path) &&
      !body?.resumeSessionId
        ? { workingDirectory: directory, ...body }
        : body;
    const request = (method, path, body, origin = base) =>
      fetch(base + path, {
        method,
        headers: {
          Origin: origin,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(sessionBody(method, path, body)),
      });
    const input = {
      name: ' Reviewer ',
      provider: 'codex',
      instructions:
        'Review "quoted" code.\nKeep paths C:\\repo; treat $(commands) as text.',
    };
    const waitFor = async (predicate) => {
      const deadline = Date.now() + 5000;
      while (!predicate()) {
        if (Date.now() > deadline) throw Error('Timed out');
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    };
    const launchArgs = async () => {
      await waitFor(() => getSession(1).output.includes('READY'));
      return JSON.parse(/ARGS:([^\r\n]+)\r?\n/.exec(getSession(1).output)[1]);
    };
    try {
      assert.deepEqual(await (await request('GET', '/api/agents')).json(), []);
      for (const invalid of [
        null,
        [],
        {},
        { ...input, name: ' ' },
        { ...input, name: 'a'.repeat(101) },
        { ...input, name: 'Bad\nName' },
        { ...input, provider: 'unsupported' },
        { ...input, instructions: ' ' },
        { ...input, instructions: 'a'.repeat(20001) },
        { ...input, instructions: 'Bad\0Text' },
      ]) {
        assert.equal(
          (await request('POST', '/api/agents', invalid)).status,
          400,
        );
      }
      assert.equal(
        (await request('POST', '/api/agents', input, 'https://evil.example'))
          .status,
        403,
      );
      const created = await request('POST', '/api/agents', input);
      assert.equal(created.status, 201);
      const agent = await created.json();
      assert.equal(agent.name, 'Reviewer');
      assert.equal(agent.instructions, input.instructions);
      assert.ok(agent.createdAt);
      assert.equal(agent.createdAt, agent.updatedAt);
      assert.equal(
        (await request('POST', '/api/agents', { ...input, name: 'reviewer' }))
          .status,
        409,
      );
      assert.equal(
        (await (await request('GET', `/api/agents/${agent.id}`)).json()).name,
        'Reviewer',
      );
      assert.equal((await request('GET', '/api/agents/999')).status, 404);
      assert.equal((await request('GET', '/api/agents/nope')).status, 400);
      const another = await (
        await request('POST', '/api/agents', { ...input, name: 'Another' })
      ).json();
      assert.equal(
        (
          await request('PUT', `/api/agents/${another.id}`, {
            ...input,
            name: 'REVIEWER',
          })
        ).status,
        409,
      );
      assert.equal(
        (await request('PUT', '/api/agents/999', input)).status,
        404,
      );
      assert.equal(
        (
          await request('PUT', `/api/agents/${agent.id}`, {
            ...input,
            provider: 'agy',
          })
        ).status,
        400,
      );
      assert.equal(
        (await request('POST', '/api/projects/1/session', { agentId: '1' }))
          .status,
        400,
      );
      assert.equal(
        (await request('POST', '/api/projects/1/session', { agentId: 999 }))
          .status,
        404,
      );
      assert.equal(
        (
          await request('POST', '/api/projects/1/session', {
            agentId: agent.id,
          })
        ).status,
        201,
      );
      const args = await launchArgs();
      assert.equal(
        JSON.parse(
          args
            .find((arg) => arg.startsWith('developer_instructions='))
            .slice('developer_instructions='.length),
        ),
        input.instructions,
      );
      await waitFor(() => getSession(1).info.codexConversationId);
      const sessionId = getSession(1).info.id;
      const saved = listSessions(1)[0];
      assert.equal(saved.agentId, agent.id);
      assert.equal(saved.agentName, agent.name);
      assert.equal(saved.agentInstructions, input.instructions);
      const changed = {
        name: 'Updated reviewer',
        provider: 'codex',
        instructions: 'New instructions',
      };
      const updated = await request('PUT', `/api/agents/${agent.id}`, changed);
      assert.equal(updated.status, 200);
      assert.equal((await updated.json()).createdAt, agent.createdAt);
      assert.equal(listSessions(1)[0].agentName, 'Reviewer');
      assert.equal(getSession(1).info.agentInstructions, input.instructions);
      await shutdownSessions();
      assert.equal(
        (
          await request('POST', '/api/projects/1/session', {
            resumeSessionId: sessionId,
            agentId: agent.id,
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await request('POST', '/api/projects/1/session', {
            resumeSessionId: sessionId,
          })
        ).status,
        201,
      );
      const resumeArgs = await launchArgs();
      assert.equal(resumeArgs[0], 'resume');
      assert.equal(
        JSON.parse(
          resumeArgs
            .find((arg) => arg.startsWith('developer_instructions='))
            .slice('developer_instructions='.length),
        ),
        input.instructions,
      );
      assert.equal(getSession(1).info.id, sessionId);
      assert.equal(listSessions(1).length, 1);
      assert.equal(
        (await request('DELETE', `/api/agents/${agent.id}`)).status,
        204,
      );
      assert.equal(getSession(1).info.status, 'running');
      assert.equal(getSession(1).info.agentId, null);
      assert.equal(listSessions(1)[0].agentId, null);
      assert.equal(listSessions(1)[0].agentName, 'Reviewer');
      await shutdownSessions();
      assert.equal(
        (
          await request('POST', '/api/projects/1/session', {
            agentId: agent.id,
          })
        ).status,
        404,
      );
      assert.equal(
        (await request('DELETE', `/api/agents/${agent.id}`)).status,
        404,
      );
      assert.equal(
        (
          await request('POST', '/api/projects/1/session', {
            resumeSessionId: sessionId,
          })
        ).status,
        201,
      );
      const deletedResumeArgs = await launchArgs();
      assert.equal(
        JSON.parse(
          deletedResumeArgs
            .find((arg) => arg.startsWith('developer_instructions='))
            .slice('developer_instructions='.length),
        ),
        input.instructions,
      );
      await shutdownSessions();
      assert.equal(
        (
          await request('POST', '/api/projects/1/session', {
            agentId: another.id,
          })
        ).status,
        201,
      );
      await launchArgs();
      assert.equal(listSessions(1)[0].agentId, another.id);
      await shutdownSessions();
      assert.equal(
        (await request('POST', '/api/projects/1/session')).status,
        201,
      );
      const defaultArgs = await launchArgs();
      assert.ok(
        !defaultArgs.some((arg) => arg.startsWith('developer_instructions=')),
      );
      assert.equal(listSessions(1)[0].agentId, null);
      assert.equal(listSessions(1)[0].agentInstructions, null);
      await shutdownSessions();
      const persisted = JSON.parse(
        execFileSync(
          process.execPath,
          [
            '--import',
            'tsx',
            '--input-type=module',
            '-e',
            "const {listAgents}=await import('./src/repositories/agents.ts'); await import('./src/services/sessions.ts'); const {listSessions}=await import('./src/repositories/sessions.ts'); console.log(JSON.stringify({agents:listAgents(),sessions:listSessions(1)}));",
          ],
          { cwd: new URL('..', import.meta.url), encoding: 'utf8' },
        ),
      );
      assert.equal(persisted.agents.length, 1);
      assert.equal(persisted.agents[0].id, another.id);
      assert.equal(
        persisted.sessions.find((session) => session.id === sessionId)
          .agentInstructions,
        input.instructions,
      );
    } finally {
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
