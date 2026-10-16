import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

// Use node:http so the reverse proxy's Host header is preserved in these fixtures.
const fetch = (url, options = {}) =>
  new Promise((resolve, reject) => {
    const request = httpRequest(
      url,
      { method: options.method ?? 'GET', headers: options.headers },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () =>
          resolve(
            new Response(Buffer.concat(chunks), {
              status: response.statusCode,
              headers: response.headers,
            }),
          ),
        );
      },
    );
    request.on('error', reject);
    request.end(options.body);
  });

test(
  'private remote origin, frontend routes and chat sessions',
  { timeout: 15000 },
  async (context) => {
    const directory = await mkdtemp(join(tmpdir(), 'manager-remote-'));
    const oldDb = process.env.AGENT_MANAGER_DB_PATH;
    const oldOrigin = process.env.AGENT_MANAGER_PUBLIC_ORIGIN;
    const oldPath = process.env.PATH;
    const originalSkillHome = process.env.AGENT_MANAGER_SKILL_HOME;
    process.env.AGENT_MANAGER_DB_PATH = join(directory, 'manager.sqlite');
    process.env.AGENT_MANAGER_SKILL_HOME = join(
      directory,
      'manager.sqlite',
    ).replace(/[^/]+$/, 'provider-home');
    const publicOrigin = 'https://fixture.example.ts.net';
    process.env.AGENT_MANAGER_PUBLIC_ORIGIN = publicOrigin;
    process.env.PATH = `${directory}/bin:${oldPath}`;
    await mkdir(join(directory, 'bin'));
    await writeFile(
      join(directory, 'bin/codex'),
      `#!${process.execPath}\n${(await readFile(new URL('./fixtures/codex.cjs', import.meta.url), 'utf8')).replace(/^#!.*\n/, '')}`,
      { mode: 0o755 },
    );
    const { default: app } = await import('../src/app.ts');
    const { database } = await import('../src/lib/database.ts');
    const { isAllowedOrigin } =
      await import('../src/lib/security/requestOrigin.ts');
    const { shutdownSessions } = await import('../src/services/sessions.ts');
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const remoteHeaders = {
      Host: 'fixture.example.ts.net',
      Origin: publicOrigin,
      'Content-Type': 'application/json',
    };
    try {
      assert.equal(
        isAllowedOrigin({
          headers: { host: 'fixture.example.ts.net', origin: publicOrigin },
        }),
        true,
      );
      for (const origin of [
        'http://fixture.example.ts.net',
        'https://other.example.ts.net',
        'https://fixture.example.ts.net.evil.invalid',
        publicOrigin + '/path',
        'null',
      ])
        assert.equal(
          isAllowedOrigin({
            headers: { host: 'fixture.example.ts.net', origin },
          }),
          false,
        );
      assert.equal(
        isAllowedOrigin({
          headers: { host: 'wrong.example.ts.net', origin: publicOrigin },
        }),
        false,
      );
      assert.equal(
        isAllowedOrigin({
          headers: { host: new URL(base).host, origin: base },
        }),
        true,
      );
      assert.equal(
        isAllowedOrigin({ headers: { host: new URL(base).host } }),
        false,
      );
      for (const value of [
        'http://fixture.example.ts.net',
        'https://fixture.example.ts.net/path',
        'https://user:pass@fixture.example.ts.net',
        'https://fixture.example.ts.net?query=1',
      ]) {
        assert.throws(() =>
          execFileSync(
            process.execPath,
            [
              '--import',
              'tsx',
              '-e',
              "import('./src/lib/security/requestOrigin.ts')",
            ],
            {
              cwd: resolve(import.meta.dirname, '..'),
              env: { ...process.env, AGENT_MANAGER_PUBLIC_ORIGIN: value },
              stdio: 'pipe',
            },
          ),
        );
      }
      assert.equal(
        (await fetch(base + '/api/projects', { headers: { Origin: base } }))
          .status,
        200,
      );
      assert.equal(
        (await fetch(base + '/api/projects', { headers: remoteHeaders }))
          .status,
        200,
      );
      assert.equal(
        (
          await fetch(base + '/api/projects', {
            headers: { ...remoteHeaders, Origin: 'https://evil.invalid' },
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await fetch(base + '/api/projects', {
            method: 'POST',
            headers: { ...remoteHeaders, Origin: 'https://evil.invalid' },
            body: JSON.stringify({ name: 'Blocked' }),
          })
        ).status,
        403,
      );
      const created = await fetch(base + '/api/projects', {
        method: 'POST',
        headers: remoteHeaders,
        body: JSON.stringify({ name: 'Remote fixture' }),
      });
      assert.equal(created.status, 201);
      const project = await created.json();
      assert.equal(
        (
          await fetch(base + '/api/not-a-route', {
            headers: { Accept: 'text/html' },
          })
        ).status,
        404,
      );
      if (
        existsSync(resolve(import.meta.dirname, '../../client/dist/index.html'))
      ) {
        for (const path of [
          '/',
          '/projects/1',
          '/agents/new',
          '/runs/fixture',
        ]) {
          const response = await fetch(base + path, {
            headers: { Accept: 'text/html' },
          });
          assert.equal(response.status, 200);
          assert.match(await response.text(), /<div id="root"><\/div>/);
        }
        const index = await (await fetch(base + '/')).text();
        const asset = index.match(/src="([^"]+\.js)"/)[1];
        const javascript = await fetch(base + asset);
        assert.equal(javascript.status, 200);
        assert.match(javascript.headers.get('content-type'), /javascript/);
        assert.equal((await fetch(base + '/assets/missing.js')).status, 404);
      } else
        context.diagnostic(
          'Build the frontend to exercise static and SPA route serving.',
        );
      const started = await fetch(
        base + `/api/projects/${project.id}/session`,
        {
          method: 'POST',
          headers: { ...remoteHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ workingDirectory: directory }),
        },
      );
      assert.equal(started.status, 201);
      const { session } = await started.json();
      assert.equal(session.transport, 'chat');
      const path = `/api/sessions/${session.id}/messages`;
      assert.equal(
        (
          await fetch(base + path, {
            method: 'POST',
            headers: { ...remoteHeaders, Origin: 'https://evil.invalid' },
            body: JSON.stringify({ prompt: 'blocked' }),
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await fetch(base + path, {
            method: 'POST',
            headers: remoteHeaders,
            body: JSON.stringify({ prompt: 'remote chat input' }),
          })
        ).status,
        202,
      );
      assert.equal(
        (
          await fetch(base + `/api/sessions/${session.id}/terminal`, {
            headers: remoteHeaders,
          })
        ).status,
        404,
      );
    } finally {
      await shutdownSessions();
      server.closeAllConnections();
      await new Promise((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
      database.close();
      if (oldDb === undefined) delete process.env.AGENT_MANAGER_DB_PATH;
      else process.env.AGENT_MANAGER_DB_PATH = oldDb;
      if (oldOrigin === undefined)
        delete process.env.AGENT_MANAGER_PUBLIC_ORIGIN;
      else process.env.AGENT_MANAGER_PUBLIC_ORIGIN = oldOrigin;
      process.env.PATH = oldPath;
      if (originalSkillHome === undefined)
        delete process.env.AGENT_MANAGER_SKILL_HOME;
      else process.env.AGENT_MANAGER_SKILL_HOME = originalSkillHome;
      await rm(directory, { recursive: true, force: true });
    }
  },
);
