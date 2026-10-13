import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test(
  'session deletion protects active work, removes aliases and transcripts, and preserves native history',
  { timeout: 30000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'manager-session-delete-'));
    const old = {
      PATH: process.env.PATH,
      AGENT_MANAGER_DB_PATH: process.env.AGENT_MANAGER_DB_PATH,
      AGENT_MANAGER_SKILL_HOME: process.env.AGENT_MANAGER_SKILL_HOME,
    };
    await mkdir(join(directory, 'bin'));
    await writeFile(
      join(directory, 'bin/codex'),
      await readFile(new URL('./fixtures/codex.cjs', import.meta.url)),
      { mode: 0o755 },
    );
    process.env.PATH = `${directory}/bin:${old.PATH}`;
    process.env.AGENT_MANAGER_DB_PATH = join(directory, 'test.sqlite');
    process.env.AGENT_MANAGER_SKILL_HOME = join(directory, 'skills');
    const { database } = await import('../src/lib/database.ts');
    const { default: app } = await import('../src/app.ts');
    const { insertSession, findSessionById } =
      await import('../src/repositories/sessions.ts');
    const { saveSessionItem, listSessionItems } =
      await import('../src/repositories/sessionItems.ts');
    const { getSessionById, shutdownSessions } =
      await import('../src/services/sessions.ts');
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = (method, path, body, origin = base) =>
      fetch(base + '/api' + path, {
        method,
        headers: { 'Content-Type': 'application/json', Origin: origin },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const make = (extra = {}) => {
      const info = {
        id: randomUUID(),
        name: 'Saved chat',
        projectId: null,
        workingDirectory: directory,
        provider: 'codex',
        status: 'exited',
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        exitCode: 0,
        codexConversationId: '12345678-1234-5678-9012-123456789012',
        resumedFrom: null,
        lastResumedAt: null,
        agentId: null,
        agentName: null,
        agentInstructions: null,
        mode: 'interactive',
        transport: 'chat',
        ...extra,
      };
      insertSession(info);
      saveSessionItem(info.id, {
        id: 'message',
        turnId: 'turn',
        type: 'agentMessage',
        role: 'assistant',
        title: 'Codex',
        text: 'Saved message',
        status: 'completed',
      });
      return info;
    };
    try {
      const liveResponse = await request('POST', '/sessions', {
        transport: 'chat',
        workingDirectory: directory,
      });
      assert.equal(liveResponse.status, 201);
      const live = (await liveResponse.json()).session;
      assert.equal(
        (await request('DELETE', `/sessions/${live.id}`)).status,
        409,
      );
      const sent = await request('POST', `/sessions/${live.id}/messages`, {
        prompt: 'fast',
      });
      assert.equal(sent.status, 202);
      await request('POST', `/sessions/${live.id}/cancel`, {});
      const deadline = Date.now() + 5000;
      while (getSessionById(live.id).info.status !== 'exited') {
        if (Date.now() > deadline) throw Error('Session did not stop');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(
        (await request('DELETE', `/sessions/${live.id}`)).status,
        204,
      );
      assert.equal(getSessionById(live.id), undefined);
      assert.ok(await readFile(join(directory, 'history.json'), 'utf8'));
      assert.equal(
        (
          await request('POST', `/sessions/${live.id}/resume`, {
            transport: 'chat',
          })
        ).status,
        404,
      );
      assert.equal((await request('GET', `/sessions/${live.id}`)).status, 404);
      assert.equal(listSessionItems(live.id).length, 0);

      const original = make();
      const alias = make({ resumedFrom: original.id });
      const nested = make({ resumedFrom: alias.id });
      assert.equal(
        (
          await request(
            'DELETE',
            `/sessions/${original.id}`,
            undefined,
            'https://example.com',
          )
        ).status,
        403,
      );
      assert.ok(findSessionById(original.id));
      assert.equal(
        (await request('DELETE', `/sessions/${nested.id}`)).status,
        204,
      );
      for (const row of [original, alias, nested]) {
        assert.equal(findSessionById(row.id), undefined);
        assert.equal(listSessionItems(row.id).length, 0);
      }
      assert.equal(
        (await request('DELETE', `/sessions/${original.id}`)).status,
        404,
      );
      for (const status of ['running', 'stopping', 'queued']) {
        const row = make({ status });
        assert.equal(
          (await request('DELETE', `/sessions/${row.id}`)).status,
          409,
        );
        assert.ok(findSessionById(row.id));
        assert.equal(listSessionItems(row.id).length, 1);
      }
      const occurrenceId = randomUUID();
      const finished = make({
        source: 'schedule',
        occurrenceId,
        stepIndex: 0,
        outcome: 'succeeded',
      });
      const following = make({
        source: 'schedule',
        occurrenceId,
        stepIndex: 1,
        status: 'queued',
      });
      assert.equal(
        (await request('DELETE', `/sessions/${finished.id}`)).status,
        409,
      );
      database
        .prepare(
          "UPDATE sessions SET status='exited',outcome='cancelled' WHERE id=?",
        )
        .run(following.id);
      assert.equal(
        (await request('DELETE', `/sessions/${finished.id}`)).status,
        204,
      );
      assert.ok(findSessionById(following.id));
      const interrupted = make({ status: 'interrupted' });
      assert.equal(
        (await request('DELETE', `/sessions/${interrupted.id}`)).status,
        204,
      );
      assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
    } finally {
      await shutdownSessions();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      database.close();
      for (const [key, value] of Object.entries(old)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await rm(directory, { recursive: true, force: true });
    }
  },
);
