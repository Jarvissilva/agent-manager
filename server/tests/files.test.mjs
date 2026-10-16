import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
  truncate,
  stat,
} from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

test('file browsing, reference validation and private persistent uploads', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'agent-manager-files-'));
  const originalDb = process.env.AGENT_MANAGER_DB_PATH;
  process.env.AGENT_MANAGER_DB_PATH = join(directory, 'db.sqlite');
  const { database } = await import('../src/lib/database.ts');
  const { default: app } = await import('../src/app.ts');
  const { validateAttachments, openCodeAttachments, uploadDirectory } =
    await import('../src/services/files.ts');
  const folder = join(directory, 'laptop');
  await mkdir(join(folder, 'folder'), { recursive: true });
  await writeFile(join(folder, 'notes.md'), 'Reference notes');
  await writeFile(join(folder, '.hidden'), 'hidden');
  await symlink(join(folder, 'notes.md'), join(folder, 'alias.md'));
  await symlink(join(folder, 'missing'), join(folder, 'broken'));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, body, origin = base) =>
    fetch(`${base}/api/files/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(origin ? { Origin: origin } : {}),
      },
      body: JSON.stringify(body),
    });
  const upload = (name, body, extra = {}) =>
    fetch(`${base}/api/files/uploads`, {
      method: 'POST',
      headers: {
        Origin: base,
        'Content-Type': 'application/octet-stream',
        'X-File-Name': encodeURIComponent(name),
        ...extra,
      },
      body,
    });
  try {
    await t.test(
      'browser shows folders, hidden files on request and canonical references',
      async () => {
        const response = await request('browse', { path: folder });
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        const listing = await response.json();
        assert.equal(listing.path, folder);
        assert.equal(listing.parent, directory);
        assert.deepEqual(
          listing.entries.map((entry) => entry.name),
          ['folder', 'alias.md', 'notes.md'],
        );
        assert.equal(listing.entries[0].type, 'directory');
        assert.equal(listing.nextOffset, null);
        const hidden = await (
          await request('browse', { path: folder, hidden: true })
        ).json();
        assert.ok(hidden.entries.some((entry) => entry.name === '.hidden'));
        const file = await (
          await request('reference', { path: join(folder, 'alias.md') })
        ).json();
        assert.equal(file.path, join(folder, 'notes.md'));
        assert.equal(file.source, 'reference');
        assert.equal(file.mime, 'text/markdown');
        const validated = await validateAttachments([
          { ...file, size: 0, mime: 'fake', source: 'upload' },
          file.path,
        ]);
        assert.deepEqual(validated, [file]);
      },
    );
    await t.test(
      'private endpoints reject foreign origins and invalid paths',
      async () => {
        for (const path of ['browse', 'reference', 'uploads']) {
          assert.equal(
            (await request(path, { path: folder }, 'https://foreign.example'))
              .status,
            403,
          );
          assert.equal(
            (await request(path, { path: folder }, null)).status,
            403,
          );
        }
        for (const path of [
          folder,
          'relative.md',
          '/dev/null',
          join(folder, 'missing'),
          'bad\0path',
        ])
          assert.equal((await request('reference', { path })).status, 400);
        assert.equal(
          (await request('browse', { path: folder, offset: -1 })).status,
          400,
        );
        await assert.rejects(
          validateAttachments(new Array(9).fill(join(folder, 'notes.md'))),
          /up to 8/,
        );
        await assert.rejects(validateAttachments(null), /up to 8/);
      },
    );
    await t.test(
      'uploads preserve bytes, isolate identical filenames and restrict file permissions',
      async () => {
        const data = Buffer.from([0, 10, 255, 100]);
        const firstResponse = await upload('../../mobile photo.png', data);
        assert.equal(
          firstResponse.status,
          201,
          await firstResponse.clone().text(),
        );
        const first = await firstResponse.json();
        const second = await (await upload('mobile photo.png', data)).json();
        assert.equal(first.name, 'mobile photo.png');
        assert.equal(dirname(dirname(first.path)), uploadDirectory);
        assert.notEqual(first.path, second.path);
        assert.equal(first.source, 'upload');
        assert.equal(first.size, data.length);
        assert.deepEqual(await readFile(first.path), data);
        assert.equal((await stat(first.path)).mode & 0o777, 0o600);
        assert.equal((await stat(dirname(first.path))).mode & 0o777, 0o700);
        const native = await openCodeAttachments([
          first,
          await (
            await request('reference', { path: join(folder, 'notes.md') })
          ).json(),
        ]);
        assert.equal(native.length, 1);
        assert.equal(native[0].data, data.toString('base64'));
        assert.equal(native[0].mime, 'image/png');
        assert.equal(native[0].source.type, 'uri');
        assert.match(native[0].source.uri, /^file:/);
        assert.equal((await upload('', data)).status, 400);
        assert.equal((await upload('empty.txt', Buffer.alloc(0))).status, 400);
        assert.equal(
          (await upload('bad.txt', data, { 'X-File-Name': '%' })).status,
          400,
        );
        assert.equal(
          (await request('uploads', { data: 'wrong content type' })).status,
          400,
        );
        await rm(first.path);
        await assert.rejects(validateAttachments([first]), /cannot be read/);
      },
    );
    await t.test('file limits and paginated listings', async () => {
      const large = join(folder, 'large');
      await writeFile(large, '');
      await truncate(large, 20 * 1024 * 1024 + 1);
      assert.equal((await request('reference', { path: large })).status, 400);
      await truncate(large, 15 * 1024 * 1024);
      const others = [join(folder, 'large2'), join(folder, 'large3')];
      for (const path of others) {
        await writeFile(path, '');
        await truncate(path, 15 * 1024 * 1024);
      }
      await assert.rejects(validateAttachments([large, ...others]), /40 MB/);
      const pages = join(folder, 'pages');
      await mkdir(pages);
      await Promise.all(
        Array.from({ length: 205 }, (_, i) =>
          writeFile(join(pages, `file-${String(i).padStart(3, '0')}`), ''),
        ),
      );
      const first = await (await request('browse', { path: pages })).json();
      const second = await (
        await request('browse', { path: pages, offset: first.nextOffset })
      ).json();
      assert.equal(first.entries.length, 200);
      assert.equal(second.entries.length, 5);
      assert.equal(second.nextOffset, null);
      assert.equal(
        new Set(
          [...first.entries, ...second.entries].map((entry) => entry.path),
        ).size,
        205,
      );
      assert.equal(
        (await upload('too-large.bin', Buffer.alloc(20 * 1024 * 1024 + 1)))
          .status,
        413,
      );
    });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    database.close();
    if (originalDb === undefined) delete process.env.AGENT_MANAGER_DB_PATH;
    else process.env.AGENT_MANAGER_DB_PATH = originalDb;
    await rm(directory, { recursive: true, force: true });
  }
});
