import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test(
  'skills CRUD, atomic assignment, session snapshots and resume',
  { timeout: 15000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-manager-skills-'));
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
      `#!${process.execPath}\n${(await readFile(new URL('./fixtures/codex.cjs', import.meta.url), 'utf8')).replace(/^#!.*\n/, '')}`,
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
      fetch(base + '/api' + path, {
        method,
        headers: {
          Origin: origin,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(sessionBody(method, path, body)),
      });
    const waitFor = async (predicate) => {
      const deadline = Date.now() + 5000;
      while (!predicate()) {
        if (Date.now() > deadline) throw Error('Timed out');
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    };
    const instructions = async () => {
      const calls = (
        await readFile(join(directory, 'codex-requests.jsonl'), 'utf8')
      )
        .trim()
        .split('\n')
        .map(JSON.parse);
      return calls.findLast(
        (call) =>
          call.method === 'thread/start' || call.method === 'thread/resume',
      ).params.developerInstructions;
    };
    try {
      assert.deepEqual(await (await request('GET', '/skills')).json(), []);
      const input = {
        name: ' Review ',
        instructions: '# Review\nCheck "security" and C:\\repo.',
      };
      for (const body of [
        null,
        {},
        { ...input, name: '' },
        { ...input, name: 'bad\nname' },
        { ...input, instructions: '' },
        { ...input, instructions: 'x'.repeat(20001) },
      ]) {
        assert.equal((await request('POST', '/skills', body)).status, 400);
      }
      assert.equal(
        (await request('POST', '/skills', input, 'https://evil.example'))
          .status,
        403,
      );
      const created = await request('POST', '/skills', input);
      assert.equal(created.status, 201);
      const skill = await created.json();
      assert.equal(skill.name, 'Review');
      assert.equal(
        (await request('POST', '/skills', { ...input, name: 'review' })).status,
        409,
      );
      assert.equal((await request('GET', '/skills/nope')).status, 400);
      assert.equal((await request('GET', '/skills/999')).status, 404);
      assert.equal(
        (await (await request('GET', `/skills/${skill.id}`)).json())
          .instructions,
        input.instructions,
      );
      const other = await (
        await request('POST', '/skills', {
          name: 'Tests',
          instructions: 'Run tests.',
        })
      ).json();
      assert.equal(
        (
          await request('PUT', `/skills/${other.id}`, {
            ...input,
            name: 'REVIEW',
          })
        ).status,
        409,
      );
      const agentInput = {
        name: 'Reviewer',
        provider: 'codex',
        instructions: 'Be precise.',
        skillIds: [skill.id, other.id],
      };
      for (const skillIds of [[999], [skill.id, skill.id], ['1'], null]) {
        assert.equal(
          (await request('POST', '/agents', { ...agentInput, skillIds }))
            .status,
          400,
        );
      }
      const agent = await (await request('POST', '/agents', agentInput)).json();
      assert.deepEqual(agent.skillIds, [skill.id, other.id]);
      assert.equal(
        (
          await request('PUT', `/agents/${agent.id}`, {
            ...agentInput,
            skillIds: [999],
          })
        ).status,
        400,
      );
      assert.equal(
        (await (await request('GET', `/agents/${agent.id}`)).json()).skills
          .length,
        2,
      );
      assert.equal(
        (await request('POST', '/projects/1/session', { agentId: agent.id }))
          .status,
        201,
      );
      const expected = `Be precise.\n\nRelevant native skills (load only when needed):\n- review: ${skill.description}\n- tests: ${other.description}`;
      assert.equal(await instructions(), expected);
      await waitFor(() => getSession(1).info.codexConversationId);
      const sessionId = getSession(1).info.id;
      const updated = await request('PUT', `/skills/${skill.id}`, {
        name: 'Review',
        instructions: 'Changed procedure.',
      });
      assert.equal(updated.status, 200);
      assert.equal((await updated.json()).createdAt, skill.createdAt);
      assert.equal(
        (await (await request('GET', `/agents/${agent.id}`)).json()).skills[0]
          .instructions,
        'Changed procedure.',
      );
      assert.equal(
        (await request('DELETE', `/skills/${other.id}`)).status,
        204,
      );
      assert.equal(
        (await request('DELETE', `/skills/${other.id}`)).status,
        404,
      );
      assert.equal(
        (await (await request('GET', `/agents/${agent.id}`)).json()).skills
          .length,
        1,
      );
      assert.equal(getSession(1).info.agentInstructions, expected);
      await shutdownSessions();
      const legacyContext =
        'Be precise.\n\n## Skill: Review\nOriginal legacy instructions.';
      database
        .prepare('UPDATE sessions SET agentInstructions=? WHERE id=?')
        .run(legacyContext, sessionId);
      assert.equal(
        (
          await request('POST', '/projects/1/session', {
            resumeSessionId: sessionId,
          })
        ).status,
        201,
      );
      assert.equal(await instructions(), legacyContext);
      assert.equal(listSessions(1).length, 1);
      await shutdownSessions();
      assert.equal(
        (await request('POST', '/projects/1/session', { agentId: agent.id }))
          .status,
        201,
      );
      assert.equal(
        await instructions(),
        `Be precise.\n\nRelevant native skills (load only when needed):\n- review: ${skill.description}`,
      );
      assert.equal(
        (
          await request('PUT', `/agents/${agent.id}`, {
            ...agentInput,
            skillIds: [],
          })
        ).status,
        200,
      );
      assert.equal(
        database.prepare('SELECT COUNT(*) AS total FROM agent_skills').get()
          .total,
        0,
      );
      assert.equal(
        (
          await request('PUT', `/agents/${agent.id}`, {
            ...agentInput,
            skillIds: [skill.id],
          })
        ).status,
        200,
      );
      assert.equal(
        (await request('DELETE', `/agents/${agent.id}`)).status,
        204,
      );
      assert.equal(
        database.prepare('SELECT COUNT(*) AS total FROM agent_skills').get()
          .total,
        0,
      );
      assert.equal((await request('GET', `/skills/${skill.id}`)).status, 200);
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
