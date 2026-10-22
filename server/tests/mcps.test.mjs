import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { validateMcpConfig, importMcpConfigs } from '../src/lib/mcps/config.ts';
import { codexMcpNames, mcpName } from '../src/lib/mcps/names.ts';

test('MCP names are exact and Codex conflicts inspect keys rather than comments and values', () => {
  for (const name of [
    'GitHub',
    'hostinger-mail-acme.com',
    'a_b',
    'a'.repeat(64),
  ])
    assert.equal(mcpName(name), name);
  for (const name of [
    '',
    ' two',
    'two words',
    '_bad',
    'a'.repeat(65),
    'a\nb',
    'a/b',
  ])
    assert.throws(() => mcpName(name), /MCP name/);
  const source = `# vercel is mentioned here
description = """+[mcp_servers.fake]
"""
url = "https://vercel.com"
[mcp_servers."hostinger-mail-acme.com"]
url = "https://example.com"
[mcp_servers.'GitHub'.env]
TOKEN = "not-a-name"
[profiles.test]
model = "vercel"
`;
  assert.deepEqual(
    [...codexMcpNames(source)],
    ['hostinger-mail-acme.com', 'GitHub'],
  );
  assert.deepEqual(
    [
      ...codexMcpNames(
        '[mcp_servers]\nvercel = { url = "https://example.com" }\n',
      ),
    ],
    ['vercel'],
  );
  assert.deepEqual(
    [...codexMcpNames('mcp_servers.github.url = "https://example.com"\n')],
    ['github'],
  );
  assert.throws(
    () => codexMcpNames('mcp_servers = { github = {} }'),
    /Inline root/,
  );
  assert.throws(() => codexMcpNames('[mcp_servers."unclosed]'), /invalid/);
});

test('MCP validation accepts native JSON formats and rejects invalid or unsupported inputs', () => {
  assert.deepEqual(
    validateMcpConfig({
      command: 'npx',
      args: ['-y', 'example'],
      env: { TOKEN: 'secret' },
    }),
    {
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'example'],
      env: { TOKEN: 'secret' },
    },
  );
  assert.equal(
    importMcpConfigs({
      mcpServers: {
        remote: {
          serverUrl: 'https://example.com/mcp',
          headers: { Authorization: 'Bearer secret' },
        },
      },
    })[0].config.type,
    'http',
  );
  assert.deepEqual(
    importMcpConfigs({
      mcp: {
        local: {
          type: 'local',
          command: ['node', 'server.mjs'],
          environment: { TOKEN: 'secret' },
          enabled: false,
        },
      },
    })[0],
    {
      name: 'local',
      enabled: false,
      config: {
        type: 'stdio',
        command: 'node',
        args: ['server.mjs'],
        env: { TOKEN: 'secret' },
      },
    },
  );
  assert.equal(
    importMcpConfigs({ name: 'single', url: 'http://localhost:3000/mcp' })
      .length,
    1,
  );
  for (const value of [
    { command: 'node', args: 'server.js' },
    { type: 'sse', url: 'https://example.com' },
    { url: 'file:///etc/passwd' },
    { url: 'https://user:password@example.com' },
    { command: 'node', url: 'https://example.com' },
    { command: 'node', cwd: '../outside' },
    { command: ['node', 'server.js'], args: ['extra'] },
    { url: 'https://example.com', env: { TOKEN: 'ignored' } },
    { url: 'https://example.com', serverUrl: 'https://other.example.com' },
    { command: 'node', env: { TOKEN: 123 } },
    {
      url: 'https://example.com',
      headers: { Authorization: 'secret\r\nInjected: true' },
    },
  ])
    assert.throws(() => validateMcpConfig(value));
  assert.throws(
    () =>
      importMcpConfigs({
        mcpServers: { unsupported: { command: 'node', oauth: {} } },
      }),
    /Unsupported/,
  );
  assert.throws(() => importMcpConfigs({ mcpServers: {} }));
});

test('MCP catalog publishes globally, preserves native entries, masks secrets, and detects ownership conflicts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'manager-mcps-'));
  const previous = {
    db: process.env.AGENT_MANAGER_DB_PATH,
    home: process.env.AGENT_MANAGER_MCP_HOME,
  };
  process.env.AGENT_MANAGER_DB_PATH = join(dir, 'data/test.sqlite');
  process.env.AGENT_MANAGER_MCP_HOME = dir;
  // Import database-dependent modules only after configuring the isolated test home.
  const { database } = await import('../src/lib/database.ts');
  const { addMcp, importMcps, updateMcp, syncMcp, deleteMcp, getMcp, getMcps } =
    await import('../src/services/mcps.ts');
  const { mcpDestinations, parseProviderJson } =
    await import('../src/lib/mcps/publication.ts');
  try {
    assert.deepEqual(
      parseProviderJson(
        '{ // comment\n "url": "https://example.com/a,}", /* comment */ "items": [1,], }',
      ),
      { url: 'https://example.com/a,}', items: [1] },
    );
    assert.throws(() => parseProviderJson('{ /* missing close }'));
    for (const destination of mcpDestinations()) {
      await mkdir(join(destination.path, '..'), { recursive: true });
      await writeFile(
        destination.path,
        destination.provider === 'codex'
          ? 'model = "original"\n[mcp_servers.existing]\ncommand = "existing-command"\n'
          : JSON.stringify({
              untouched: { setting: true },
              [destination.provider === 'opencode' ? 'mcp' : 'mcpServers']: {
                existing: { command: 'existing-command' },
              },
            }),
      );
    }
    assert.throws(
      () => addMcp({ name: 'existing', config: { command: 'node' } }),
      /codex.*already exists/,
    );
    assert.equal(getMcps().length, 0);
    for (const destination of mcpDestinations().filter(
      (d) => d.provider !== 'codex',
    )) {
      const original = await readFile(destination.path, 'utf8');
      const root = JSON.parse(original);
      const key = destination.provider === 'opencode' ? 'mcp' : 'mcpServers';
      root[key]['json-only'] = { url: 'https://example.com' };
      await writeFile(destination.path, JSON.stringify(root));
      assert.throws(
        () => addMcp({ name: 'JSON-only', config: { command: 'node' } }),
        new RegExp(destination.provider + '.*already exists'),
      );
      assert.equal(getMcps().length, 0);
      await writeFile(destination.path, original);
    }
    assert.throws(
      () =>
        importMcps({
          mcpServers: {
            fresh: { command: 'node' },
            existing: { command: 'node' },
          },
        }),
      /already exists/,
    );
    assert.equal(getMcps().length, 0);
    const added = addMcp({
      name: 'Search.tools',
      config: {
        command: 'node',
        args: ['server.js'],
        env: { API_TOKEN: 'secret-value' },
        cwd: '/tmp',
      },
    });
    assert.equal(added.nativeName, 'Search.tools');
    assert.equal(added.publications.length, 3);
    assert.ok(
      added.publications.every((item) => item.status === 'published'),
      JSON.stringify(added.publications),
    );
    assert.equal(added.config.env.API_TOKEN, null);
    const file = join(dir, 'data/mcps', `${added.id}.json`);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.equal(
      JSON.parse(await readFile(file, 'utf8')).env.API_TOKEN,
      'secret-value',
    );
    assert.equal(
      database
        .prepare('SELECT publications FROM mcp_servers WHERE id=?')
        .get(added.id)
        .publications.includes('secret-value'),
      false,
    );
    for (const destination of mcpDestinations()) {
      const contents = await readFile(destination.path, 'utf8');
      assert.ok(contents.includes('existing-command'));
      assert.equal(
        contents.includes('secret-value'),
        false,
        'stdio credentials live only in the shared source',
      );
      assert.equal((await stat(destination.path)).mode & 0o777, 0o600);
    }
    assert.throws(
      () => addMcp({ name: 'SEARCH.TOOLS', config: { command: 'node' } }),
      /already exists/,
    );
    updateMcp(added.id, {
      name: 'Renamed.tools',
      config: { ...added.config, env: { API_TOKEN: null, EXTRA: 'new' } },
    });
    assert.equal(getMcp(added.id).nativeName, 'Renamed.tools');
    assert.equal(getMcp(added.id).previousNativeName, added.nativeName);
    added.nativeName = 'Renamed.tools';
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).env, {
      API_TOKEN: 'secret-value',
      EXTRA: 'new',
    });
    updateMcp(added.id, { enabled: false });
    assert.ok(
      getMcp(added.id).publications.every((item) => item.status === 'disabled'),
    );
    const imported = importMcps({
      mcpServers: {
        remote: {
          url: 'https://example.com/mcp',
          headers: { Authorization: 'Bearer remote-secret' },
        },
        extra: { command: 'echo', args: ['hello'] },
      },
    });
    assert.equal(imported.length, 2);
    assert.equal(imported[0].config.headers.Authorization, null);
    for (const destination of mcpDestinations()) {
      const contents = await readFile(destination.path, 'utf8');
      assert.ok(contents.includes('remote-secret'));
    }
    // Upgrade an existing generated name, preserving identity, secret files and disabled state.
    const legacy = addMcp({
      name: 'agent-manager-legacy-12345678',
      enabled: false,
      config: {
        url: 'https://example.com/mcp',
        headers: { Authorization: 'Bearer migration-secret' },
      },
    });
    database
      .prepare('UPDATE mcp_servers SET name=? WHERE id=?')
      .run('legacy.test', legacy.id);
    const migrated = syncMcp(legacy.id);
    assert.equal(migrated.nativeName, 'legacy.test');
    assert.equal(migrated.id, legacy.id);
    assert.equal(migrated.enabled, false);
    assert.equal(migrated.previousNativeName, legacy.nativeName);
    assert.ok(migrated.publications.every((p) => p.status === 'disabled'));
    for (const destination of mcpDestinations()) {
      const contents = await readFile(destination.path, 'utf8');
      assert.ok(contents.includes('legacy.test'));
      assert.ok(!contents.includes(legacy.nativeName));
    }
    assert.equal(
      JSON.parse(
        await readFile(join(dir, 'data/mcps', `${legacy.id}.json`), 'utf8'),
      ).headers.Authorization,
      'Bearer migration-secret',
    );
    // A migration destination owned externally must leave all old entries untouched.
    database
      .prepare('UPDATE mcp_servers SET name=? WHERE id=?')
      .run('existing', legacy.id);
    const snapshots = await Promise.all(
      mcpDestinations().map((d) => readFile(d.path, 'utf8')),
    );
    assert.throws(() => syncMcp(legacy.id), /already exists/);
    assert.equal(getMcp(legacy.id).nativeName, 'legacy.test');
    assert.deepEqual(
      await Promise.all(mcpDestinations().map((d) => readFile(d.path, 'utf8'))),
      snapshots,
    );
    assert.ok(getMcp(legacy.id).publications.every((p) => p.error));
    database
      .prepare('UPDATE mcp_servers SET name=? WHERE id=?')
      .run('legacy.test', legacy.id);
    deleteMcp(legacy.id);
    const { recoverMcpRenames, renameMcp } =
      await import('../src/lib/mcps/rename.ts');
    const { findMcp } = await import('../src/repositories/mcps.ts');
    const { createHash } = await import('node:crypto');
    const recoveryMcp = addMcp({
      name: 'recovery',
      config: { command: 'node' },
    });
    const recoveryFolder = join(dir, 'data/mcps/renames/interrupted');
    await mkdir(recoveryFolder, { recursive: true });
    const destination = mcpDestinations()[0];
    const original = await readFile(destination.path, 'utf8');
    const changed = original + '# staged rename\n';
    const hash = (value) => createHash('sha256').update(value).digest('hex');
    await writeFile(join(recoveryFolder, '0.before'), original, {
      mode: 0o600,
    });
    await writeFile(
      join(recoveryFolder, 'journal.json'),
      JSON.stringify({
        id: recoveryMcp.id,
        oldName: 'recovery',
        newName: 'recovered',
        files: [
          {
            path: destination.path,
            backup: '0.before',
            existed: true,
            before: hash(original),
            after: hash(changed),
          },
        ],
      }),
      { mode: 0o600 },
    );
    await writeFile(destination.path, changed);
    assert.equal(recoverMcpRenames().size, 0);
    assert.equal(await readFile(destination.path, 'utf8'), original);
    // External changes during an interrupted rename block recovery without overwriting them.
    await mkdir(recoveryFolder, { recursive: true });
    await writeFile(join(recoveryFolder, '0.before'), original, {
      mode: 0o600,
    });
    await writeFile(
      join(recoveryFolder, 'journal.json'),
      JSON.stringify({
        id: recoveryMcp.id,
        oldName: 'recovery',
        newName: 'recovered',
        files: [
          {
            path: destination.path,
            backup: '0.before',
            existed: true,
            before: hash(original),
            after: hash(changed),
          },
        ],
      }),
      { mode: 0o600 },
    );
    const externallyChanged = original + '# external edit\n';
    await writeFile(destination.path, externallyChanged);
    assert.ok(recoverMcpRenames().has(recoveryMcp.id));
    assert.equal(await readFile(destination.path, 'utf8'), externallyChanged);
    assert.throws(() => syncMcp(recoveryMcp.id), /recovery is blocked/);
    await writeFile(destination.path, changed);
    assert.equal(recoverMcpRenames().size, 0);
    assert.equal(await readFile(destination.path, 'utf8'), original);
    // Fail the final database commit after all provider writes, and verify rollback.
    database.exec(
      "CREATE TRIGGER reject_test_rename BEFORE UPDATE OF nativeName ON mcp_servers WHEN NEW.nativeName='fail-commit' BEGIN SELECT RAISE(ABORT, 'simulated commit failure'); END",
    );
    const beforeFailure = await Promise.all(
      mcpDestinations().map((d) => readFile(d.path, 'utf8')),
    );
    assert.throws(
      () =>
        renameMcp(
          findMcp(recoveryMcp.id),
          'fail-commit',
          'fail-commit',
          1,
          { type: 'stdio', command: 'node', args: [], env: {} },
          join(dir, 'data/mcps/stdio.cjs'),
          join(dir, `data/mcps/${recoveryMcp.id}.json`),
        ),
      /restored/,
    );
    assert.deepEqual(
      await Promise.all(mcpDestinations().map((d) => readFile(d.path, 'utf8'))),
      beforeFailure,
    );
    assert.equal(getMcp(recoveryMcp.id).nativeName, 'recovery');
    database.exec('DROP TRIGGER reject_test_rename');
    // A crash after commit must clean up, without reverting the committed files.
    await mkdir(recoveryFolder, { recursive: true });
    await writeFile(
      join(recoveryFolder, 'journal.json'),
      JSON.stringify({
        id: recoveryMcp.id,
        oldName: 'old-recovery',
        newName: 'recovery',
        files: [],
      }),
      { mode: 0o600 },
    );
    assert.equal(recoverMcpRenames().size, 0);
    await assert.rejects(readFile(join(recoveryFolder, 'journal.json')), {
      code: 'ENOENT',
    });
    assert.equal(await readFile(destination.path, 'utf8'), original);
    deleteMcp(recoveryMcp.id);
    const before = getMcps().length;
    assert.throws(() =>
      importMcps({
        mcpServers: {
          duplicate: { command: 'node' },
          DUPLICATE: { command: 'node' },
        },
      }),
    );
    assert.equal(
      getMcps().length,
      before,
      'batch validation does not create partial imports',
    );
    const agy = mcpDestinations().find(
      (value) => value.provider === 'antigravity',
    );
    const native = JSON.parse(await readFile(agy.path, 'utf8'));
    native.mcpServers[added.nativeName].command = 'externally-modified';
    await writeFile(agy.path, JSON.stringify(native));
    assert.equal(
      syncMcp(added.id).publications.find(
        (value) => value.provider === 'antigravity',
      ).status,
      'error',
    );
    assert.throws(() => deleteMcp(added.id), /preserved/);
    assert.equal(
      JSON.parse(await readFile(agy.path, 'utf8')).mcpServers[added.nativeName]
        .command,
      'externally-modified',
    );
    delete native.mcpServers[added.nativeName];
    await writeFile(agy.path, JSON.stringify(native));
    deleteMcp(added.id);
    await assert.rejects(readFile(file), { code: 'ENOENT' });
    for (const mcp of imported) deleteMcp(mcp.id);
    for (const destination of mcpDestinations()) {
      const contents = await readFile(destination.path, 'utf8');
      assert.ok(contents.includes('existing-command'));
      assert.equal(contents.includes('agent-manager-'), false);
    }
    assert.equal(getMcps().length, 0);
  } finally {
    database.close();
    for (const [key, value] of [
      ['AGENT_MANAGER_DB_PATH', previous.db],
      ['AGENT_MANAGER_MCP_HOME', previous.home],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(dir, { recursive: true, force: true });
  }
});
