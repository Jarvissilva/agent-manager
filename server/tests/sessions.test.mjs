import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  access,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

const conversationId = '12345678-1234-5678-9012-123456789012';

test(
  'chat-only sessions persist messages and resume legacy terminal conversations without losing identity',
  { timeout: 20000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-manager-chat-only-'));
    const original = {
      PATH: process.env.PATH,
      AGENT_MANAGER_DB_PATH: process.env.AGENT_MANAGER_DB_PATH,
      AGENT_MANAGER_SKILL_HOME: process.env.AGENT_MANAGER_SKILL_HOME,
    };
    process.env.AGENT_MANAGER_DB_PATH = join(directory, 'test.sqlite');
    process.env.AGENT_MANAGER_SKILL_HOME = join(directory, 'provider-home');
    process.env.PATH = `${directory}/bin:${original.PATH}`;
    await mkdir(join(directory, 'bin'));
    const fixture = await readFile(
      new URL('./fixtures/codex.cjs', import.meta.url),
      'utf8',
    );
    await writeFile(
      join(directory, 'bin', 'codex'),
      `#!${process.execPath}\n${fixture.replace(/^#!.*\n/, '')}`,
      { mode: 0o755 },
    );
    const { database } = await import('../src/lib/database.ts');
    const { getSessionById, shutdownSessions } =
      await import('../src/services/sessions.ts');
    const { insertSession, findSessionById } =
      await import('../src/repositories/sessions.ts');
    const { listSessionItems, saveSessionItem } =
      await import('../src/repositories/sessionItems.ts');
    const { default: app } = await import('../src/app.ts');
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = (method, path, body) =>
      fetch(base + '/api' + path, {
        method,
        headers: { Origin: base, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const waitFor = async (predicate) => {
      const deadline = Date.now() + 5000;
      while (!predicate()) {
        if (Date.now() > deadline) throw Error('Timed out');
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    };
    try {
      for (const provider of ['codex', 'opencode', 'antigravity']) {
        const rejected = await request('POST', '/sessions', {
          provider,
          transport: 'terminal',
          workingDirectory: directory,
        });
        assert.equal(rejected.status, 400);
        assert.match((await rejected.json()).error, /Only chat/);
      }
      const created = await request('POST', '/sessions', {
        provider: 'codex',
        workingDirectory: directory,
      });
      assert.equal(created.status, 201, await created.clone().text());
      const { session } = await created.json();
      assert.equal(session.transport, 'chat');
      assert.equal(session.codexConversationId, conversationId);
      assert.ok(getSessionById(session.id).chat);
      assert.equal(getSessionById(session.id).terminal, undefined);
      assert.equal(
        (await request('GET', `/sessions/${session.id}/terminal`)).status,
        404,
      );
      assert.equal(
        (
          await request('POST', `/sessions/${session.id}/interface`, {
            transport: 'terminal',
          })
        ).status,
        404,
      );
      assert.equal(
        (
          await request('POST', `/sessions/${session.id}/messages`, {
            prompt: 'hello',
          })
        ).status,
        202,
      );
      await waitFor(() => getSessionById(session.id).chat.state === 'idle');
      assert.ok(
        listSessionItems(session.id).some((item) => item.role === 'assistant'),
      );
      await shutdownSessions();
      assert.equal(findSessionById(session.id).status, 'exited');
      const resumed = await request(
        'POST',
        `/sessions/${session.id}/resume`,
        {},
      );
      assert.equal(resumed.status, 201, await resumed.clone().text());
      assert.equal((await resumed.json()).session.id, session.id);
      assert.ok(
        getSessionById(session.id)
          .chat.snapshot()
          .items.some((item) => item.role === 'assistant'),
      );
      await shutdownSessions();

      const legacy = {
        ...findSessionById(session.id),
        id: randomUUID(),
        transport: 'terminal',
        status: 'interrupted',
        name: 'Legacy conversation',
      };
      insertSession(legacy);
      saveSessionItem(legacy.id, {
        id: 'legacy-message',
        turnId: 'old-turn',
        type: 'agentMessage',
        role: 'assistant',
        title: 'Codex',
        text: 'Saved terminal conversation',
        status: 'completed',
      });
      const history = await request('GET', `/sessions/${legacy.id}/chat`);
      assert.equal(history.status, 200);
      assert.match(await history.text(), /Saved terminal conversation/);
      const legacyResume = await request(
        'POST',
        `/sessions/${legacy.id}/resume`,
        {},
      );
      assert.equal(legacyResume.status, 201, await legacyResume.clone().text());
      const converted = (await legacyResume.json()).session;
      assert.equal(converted.id, legacy.id);
      assert.equal(converted.transport, 'chat');
      assert.equal(converted.codexConversationId, conversationId);
      assert.equal(converted.name, legacy.name);
      assert.ok(
        getSessionById(legacy.id)
          .chat.snapshot()
          .items.some((item) => item.id === 'legacy-message'),
      );
      await shutdownSessions();

      // Recover IDs left by an older server before terminal support was removed.
      const interrupted = {
        ...legacy,
        id: randomUUID(),
        status: 'running',
        codexConversationId: null,
      };
      insertSession(interrupted);
      const logs = join(directory, 'codex-logs', interrupted.id);
      await mkdir(logs, { recursive: true });
      await writeFile(
        join(logs, 'codex-tui.log'),
        `INFO session_loop{thread_id=${conversationId}}: codex_core::session: new\n`,
      );
      const recovered = JSON.parse(
        execFileSync(
          process.execPath,
          [
            '--import',
            'tsx',
            '--input-type=module',
            '-e',
            `await import('./src/services/sessions.ts'); const {findSessionById}=await import('./src/repositories/sessions.ts'); console.log(JSON.stringify(findSessionById('${interrupted.id}')));`,
          ],
          {
            cwd: new URL('..', import.meta.url),
            env: process.env,
            encoding: 'utf8',
          },
        ),
      );
      assert.equal(recovered.codexConversationId, conversationId);
      assert.equal(recovered.status, 'interrupted');
      await assert.rejects(access(logs), (error) => error.code === 'ENOENT');
    } finally {
      await shutdownSessions();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      database.close();
      for (const [key, value] of Object.entries(original)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await rm(directory, { recursive: true, force: true });
    }
  },
);
