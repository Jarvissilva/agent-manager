import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import WebSocket from 'ws';

const conversationId = '12345678-1234-5678-9012-123456789012';

test(
  'session history persists lifecycle changes and recovers interrupted sessions',
  { timeout: 15000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-manager-history-'));
    const databasePath = join(directory, 'test.sqlite');
    const originalPath = process.env.PATH;
    const originalDatabasePath = process.env.AGENT_MANAGER_DB_PATH;
    await mkdir(join(directory, 'bin'));
    await writeFile(
      join(directory, 'bin', 'codex'),
      `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
const logDir = JSON.parse(args.find(arg => arg.startsWith('log_dir=')).slice(8));
const threadId = args[0] === 'resume' ? args[1] : '${conversationId}';
fs.writeFileSync(logDir + '/codex-tui.log', 'unrelated thread_id=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa\\n' + 'INFO session_loop{thread_id=' + threadId + '}: codex_core::session: new\\n' + 'INFO session_loop{thread_id=bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb}: codex_core::session: new\\n');
console.log('ARGS:' + JSON.stringify(args));
console.log('READY:' + process.cwd());
process.stdin.on('data', data => { if (data.toString().includes('finish')) process.exit(7); else console.log('REPLY:' + data.toString()); });
`,
      { mode: 0o755 },
    );

    // Start with the existing projects schema to exercise the additive migration.
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(
      'CREATE TABLE projects (id INTEGER PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE)',
    );
    legacy
      .prepare('INSERT INTO projects (name, path) VALUES (?, ?)')
      .run('Test', directory);
    await mkdir(join(directory, 'other'));
    legacy
      .prepare('INSERT INTO projects (name,path) VALUES (?,?)')
      .run('Other', join(directory, 'other'));
    legacy.exec(`CREATE TABLE sessions (
      id TEXT PRIMARY KEY, projectId INTEGER NOT NULL REFERENCES projects(id),
      provider TEXT NOT NULL, status TEXT NOT NULL, startedAt TEXT NOT NULL,
      endedAt TEXT, exitCode INTEGER
    )`);
    const legacyId = '87654321-4321-8765-2109-210987654321';
    legacy
      .prepare(
        "INSERT INTO sessions (id,projectId,provider,status,startedAt,endedAt,exitCode) VALUES (?,2,'codex','exited',?,?,0)",
      )
      .run(legacyId, '2026-01-01T00:00:00Z', '2026-01-01T00:01:00Z');
    legacy.close();
    const originalSkillHome = process.env.AGENT_MANAGER_SKILL_HOME;
    process.env.AGENT_MANAGER_DB_PATH = databasePath;
    process.env.AGENT_MANAGER_SKILL_HOME = databasePath.replace(
      /[^/]+$/,
      'provider-home',
    );
    process.env.PATH = `${directory}/bin:${originalPath}`;

    const { database } = await import('../src/lib/database.ts');
    const { getSession, shutdownSessions } =
      await import('../src/services/sessions.ts');
    const { listSessions, findSavedSession } =
      await import('../src/repositories/sessions.ts');
    const { default: app } = await import('../src/app.ts');
    const { attachTerminal } = await import('../src/lib/terminal/websocket.ts');
    const server = app.listen(0, '127.0.0.1');
    const sockets = attachTerminal(server);
    const peers = [];
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const sessionBody = (method, path, body) =>
      method === 'POST' &&
      /\/projects\/\d+\/session$/.test(path) &&
      !body?.resumeSessionId
        ? { workingDirectory: directory, ...body }
        : body;
    const request = (method, path = '/api/projects/1/session', body) =>
      fetch(base + path, {
        method,
        headers: {
          Origin: base,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(sessionBody(method, path, body)),
      });
    const waitFor = async (predicate) => {
      const deadline = Date.now() + 5000;
      while (!predicate()) {
        if (Date.now() > deadline)
          throw new Error('Timed out waiting for session');
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    };

    try {
      assert.equal(
        database.prepare('SELECT name FROM projects WHERE id = 1').get().name,
        'Test',
      );
      assert.deepEqual(await (await request('GET')).json(), {
        session: null,
        sessions: [],
        queuedSessionCount: 0,
      });
      const started = await request('POST');
      assert.equal(started.status, 201);
      const { session } = await started.json();
      assert.equal(session.provider, 'codex');
      assert.equal(session.status, 'running');
      assert.equal(session.endedAt, null);
      assert.ok(Number.isFinite(Date.parse(session.startedAt)));
      assert.equal((await request('POST')).status, 409);
      assert.equal(listSessions(1).length, 1);
      assert.equal(listSessions(2).length, 1);
      assert.equal(listSessions(2)[0].id, legacyId);
      assert.equal(listSessions(2)[0].codexConversationId, null);
      assert.equal(listSessions(2)[0].resumedFrom, null);
      const globalHistory = await (
        await request('GET', '/api/sessions')
      ).json();
      assert.deepEqual(
        globalHistory.map((entry) => entry.id),
        [session.id, legacyId],
      );
      assert.deepEqual(
        await (await request('GET', '/api/sessions?projectId=2')).json(),
        JSON.parse(JSON.stringify(listSessions(2))).map((session) => ({
          ...session,
          activity: null,
        })),
      );
      assert.deepEqual(
        await (await request('GET', '/api/sessions?projectId=999')).json(),
        [],
      );
      for (const invalid of ['bad', '0', '-1', '1.2'])
        assert.equal(
          (await request('GET', `/api/sessions?projectId=${invalid}`)).status,
          400,
        );

      const socket = new WebSocket(
        `${base.replace('http', 'ws')}/api/sessions/${session.id}/terminal`,
        { origin: base },
      );
      peers.push(socket);
      const messages = [];
      socket.on('message', (raw) => messages.push(JSON.parse(raw.toString())));
      await once(socket, 'open');
      await waitFor(() =>
        messages.some((message) =>
          message.data?.includes(`READY:${directory}`),
        ),
      );
      await waitFor(
        () => getSession(1).info.codexConversationId === conversationId,
      );
      assert.equal(listSessions(1)[0].codexConversationId, conversationId);
      socket.send(JSON.stringify({ type: 'input', data: 'finish\r' }));
      await waitFor(() => messages.some((message) => message.type === 'exit'));
      const ended = listSessions(1)[0];
      assert.equal(ended.id, session.id);
      assert.equal(ended.status, 'exited');
      assert.equal(ended.exitCode, 7);
      assert.equal(ended.codexConversationId, conversationId);
      assert.notEqual(ended.codexConversationId, ended.id);
      assert.equal(ended.resumedFrom, null);
      assert.ok(ended.endedAt >= ended.startedAt);
      assert.equal((await request('GET')).status, 200);

      assert.equal((await request('POST')).status, 201);
      await waitFor(() => getSession(1).output.includes('READY:'));
      assert.equal((await request('DELETE')).status, 200);
      await waitFor(() => getSession(1).info.status === 'exited');
      assert.equal(listSessions(1).length, 2);
      assert.notEqual(listSessions(1)[0].id, ended.id);
      assert.equal(listSessions(1)[0].status, 'exited');
      assert.ok(listSessions(1)[0].endedAt);

      await request('POST');
      await shutdownSessions();
      assert.equal(listSessions(1)[0].status, 'exited');
      assert.equal(
        (await request('GET', '/api/projects/999/session')).status,
        404,
      );

      database
        .prepare(
          `INSERT INTO sessions (id, projectId, provider, status, startedAt) VALUES (?, 1, 'codex', ?, ?)`,
        )
        .run('unfinished-running', 'running', ended.startedAt);
      database
        .prepare(
          `INSERT INTO sessions (id, projectId, provider, status, startedAt) VALUES (?, 1, 'codex', ?, ?)`,
        )
        .run('unfinished-stopping', 'stopping', ended.startedAt);
      const { createCodexLogDirectory, codexLogDirectory } =
        await import('../src/lib/providers/codex/conversation.ts');
      await writeFile(
        join(createCodexLogDirectory('unfinished-stopping'), 'codex-tui.log'),
        `INFO session_loop{thread_id=${conversationId}}: codex_core::session: new\n`,
      );
      // Earlier versions created a new row on each resume. Keep these rows
      // intact while presenting and resuming their original session.
      const copyId = '11111111-1111-1111-1111-111111111111';
      const secondCopyId = '22222222-2222-2222-2222-222222222222';
      database
        .prepare('UPDATE sessions SET codexConversationId = ? WHERE id = ?')
        .run(conversationId, legacyId);
      const insertCopy = database.prepare(
        "INSERT INTO sessions (id,projectId,provider,status,startedAt,endedAt,exitCode,codexConversationId,resumedFrom) VALUES (?,2,'codex','exited',?,?,?, ?, ?)",
      );
      insertCopy.run(
        copyId,
        '2026-02-01T00:00:00Z',
        '2026-02-01T00:01:00Z',
        1,
        conversationId,
        legacyId,
      );
      insertCopy.run(
        secondCopyId,
        '2026-03-01T00:00:00Z',
        '2026-03-01T00:01:00Z',
        2,
        conversationId,
        copyId,
      );
      const persisted = JSON.parse(
        execFileSync(
          process.execPath,
          [
            '--import',
            'tsx',
            '--input-type=module',
            '-e',
            "const {getSession}=await import('./src/services/sessions.ts'); const {listSessions}=await import('./src/repositories/sessions.ts'); console.log(JSON.stringify({sessions:listSessions(1),current:getSession(1)??null}));",
          ],
          { cwd: new URL('..', import.meta.url), encoding: 'utf8' },
        ),
      );
      assert.equal(persisted.current, null);
      assert.equal(persisted.sessions.length, 5);
      assert.deepEqual(
        persisted.sessions.find((saved) => saved.id === ended.id),
        { ...ended },
      );
      for (const id of ['unfinished-running', 'unfinished-stopping']) {
        const interrupted = persisted.sessions.find((saved) => saved.id === id);
        assert.equal(interrupted.status, 'interrupted');
        assert.ok(interrupted.endedAt);
        assert.equal(interrupted.exitCode, null);
      }
      const history = await (await request('GET')).json();
      assert.equal(history.sessions.length, 5);
      const consolidated = listSessions(2);
      assert.equal(consolidated.length, 1);
      assert.equal(consolidated[0].id, legacyId);
      assert.equal(consolidated[0].startedAt, '2026-01-01T00:00:00Z');
      assert.equal(consolidated[0].lastResumedAt, '2026-03-01T00:00:00Z');
      assert.equal(consolidated[0].exitCode, 2);
      assert.equal(findSavedSession(2, secondCopyId).id, legacyId);
      assert.equal(
        database
          .prepare('SELECT COUNT(*) AS count FROM sessions WHERE projectId = 2')
          .get().count,
        3,
      );
      assert.equal(
        history.sessions.find((saved) => saved.id === 'unfinished-stopping')
          .codexConversationId,
        conversationId,
      );
      await assert.rejects(access(codexLogDirectory('unfinished-stopping')), {
        code: 'ENOENT',
      });

      assert.equal(
        (
          await request('POST', '/api/projects/2/session', {
            resumeSessionId: ended.id,
          })
        ).status,
        404,
      );
      assert.equal(
        (await request('POST', undefined, { resumeSessionId: '--last' }))
          .status,
        400,
      );
      const unknownId = '99999999-9999-9999-9999-999999999999';
      assert.equal(
        (await request('POST', undefined, { resumeSessionId: unknownId }))
          .status,
        404,
      );
      database
        .prepare(
          "INSERT INTO sessions (id,projectId,provider,status,startedAt) VALUES (?,1,'codex','exited',?)",
        )
        .run(unknownId, ended.startedAt);
      assert.equal(
        (await request('POST', undefined, { resumeSessionId: unknownId }))
          .status,
        400,
      );
      const resumedResponse = await request('POST', undefined, {
        resumeSessionId: ended.id,
      });
      assert.equal(resumedResponse.status, 201);
      const resumed = (await resumedResponse.json()).session;
      assert.equal(resumed.codexConversationId, ended.codexConversationId);
      assert.equal(resumed.resumedFrom, null);
      assert.equal(resumed.id, ended.id);
      assert.equal(resumed.startedAt, ended.startedAt);
      assert.ok(resumed.lastResumedAt);
      assert.equal(resumed.endedAt, null);
      assert.equal(resumed.exitCode, null);
      assert.equal(listSessions(1).length, 6);
      const globalAfterResume = await (
        await request('GET', '/api/sessions')
      ).json();
      assert.equal(
        globalAfterResume.filter((entry) => entry.id === ended.id).length,
        1,
      );
      assert.ok(globalAfterResume.every((entry) => entry.resumedFrom === null));

      await waitFor(() => getSession(1).output.includes('READY:'));
      const args = JSON.parse(
        /ARGS:([^\r\n]+)\r?\n/.exec(getSession(1).output)[1],
      );
      assert.deepEqual(args.slice(0, 2), ['resume', conversationId]);
      assert.equal(args[args.indexOf('--cd') + 1], directory);
      assert.ok(args.includes('--no-daemon'));
      const resumedSocket = new WebSocket(
        `${base.replace('http', 'ws')}/api/sessions/${resumed.id}/terminal`,
        { origin: base },
      );
      peers.push(resumedSocket);
      const resumedMessages = [];
      resumedSocket.on('message', (raw) =>
        resumedMessages.push(JSON.parse(raw.toString())),
      );
      await once(resumedSocket, 'open');
      await waitFor(() => resumedMessages.length > 0);
      assert.equal(
        resumedMessages[0].session.lastResumedAt,
        resumed.lastResumedAt,
      );
      resumedSocket.send(
        JSON.stringify({ type: 'input', data: 'resumed input\r' }),
      );
      await waitFor(() =>
        resumedMessages.some((message) =>
          message.data?.includes('REPLY:resumed input'),
        ),
      );
      assert.equal(
        (await request('POST', undefined, { resumeSessionId: ended.id }))
          .status,
        409,
      );
      await request('DELETE');
      await waitFor(() => getSession(1).info.status === 'exited');
      const stopped = listSessions(1).find((saved) => saved.id === ended.id);
      assert.equal(stopped.startedAt, ended.startedAt);
      assert.equal(stopped.status, 'exited');
      assert.ok(stopped.endedAt);
      assert.equal(listSessions(1).length, 6);
      await assert.rejects(access(codexLogDirectory(resumed.id)), {
        code: 'ENOENT',
      });
      // Resume also works with interrupted records after process restart.
      database
        .prepare("UPDATE sessions SET status = 'interrupted' WHERE id = ?")
        .run(resumed.id);
      assert.equal(
        (await request('POST', undefined, { resumeSessionId: resumed.id }))
          .status,
        201,
      );
      assert.equal(getSession(1).info.codexConversationId, conversationId);
      assert.equal(getSession(1).info.id, ended.id);
      assert.ok(getSession(1).info.lastResumedAt > resumed.lastResumedAt);
      assert.equal(listSessions(1).length, 6);
      await shutdownSessions();
      // Old copied IDs still resume the canonical session; a later restart
      // must not restore the stale timestamps or status of those copies.
      const legacyResume = await request('POST', '/api/projects/2/session', {
        resumeSessionId: secondCopyId,
      });
      assert.equal(legacyResume.status, 201);
      assert.equal((await legacyResume.json()).session.id, legacyId);
      await shutdownSessions();
      const latest = { ...listSessions(2)[0] };
      const afterRestart = JSON.parse(
        execFileSync(
          process.execPath,
          [
            '--import',
            'tsx',
            '--input-type=module',
            '-e',
            "await import('./src/services/sessions.ts'); const {listSessions}=await import('./src/repositories/sessions.ts'); console.log(JSON.stringify(listSessions(2)));",
          ],
          { cwd: new URL('..', import.meta.url), encoding: 'utf8' },
        ),
      );
      assert.deepEqual(afterRestart, [latest]);
      assert.equal(
        database
          .prepare('SELECT COUNT(*) AS count FROM sessions WHERE projectId = 2')
          .get().count,
        3,
      );
    } finally {
      await shutdownSessions();
      for (const peer of peers) peer.terminate();
      sockets.close();
      await new Promise((resolve) => server.close(resolve));
      database.close();
      process.env.PATH = originalPath;
      if (originalDatabasePath === undefined)
        delete process.env.AGENT_MANAGER_DB_PATH;
      else process.env.AGENT_MANAGER_DB_PATH = originalDatabasePath;
      if (originalSkillHome === undefined)
        delete process.env.AGENT_MANAGER_SKILL_HOME;
      else process.env.AGENT_MANAGER_SKILL_HOME = originalSkillHome;
      await rm(directory, { recursive: true, force: true });
    }
  },
);
