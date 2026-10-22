import { backup, DatabaseSync } from 'node:sqlite';
import {
  chmodSync,
  existsSync,
  lstatSync,
  readlinkSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

// Run with the application stopped. Do not import the server: it initializes
// providers and performs unrelated startup migrations.
export async function migrateRepository({ databasePath, from, to }) {
  from = resolve(from);
  to = resolve(to);
  if (from === to) throw Error('The old and new repository paths must differ.');
  if (!existsSync(to)) throw Error('The new repository directory is missing.');
  if (!existsSync(databasePath))
    throw Error('The existing database is missing.');
  const relocated = (value) =>
    value === from || value.startsWith(from + sep)
      ? to + value.slice(from.length)
      : value;
  const db = new DatabaseSync(databasePath);
  const links = [];
  const changedLinks = [];
  const updates = [];
  let transaction = false;
  try {
    for (const [table, column] of [
      ['sessions', 'workingDirectory'],
      ['skills', 'path'],
      ['skill_publications', 'target'],
    ]) {
      for (const row of db
        .prepare(`SELECT rowid AS id, "${column}" AS value FROM "${table}"`)
        .all()) {
        if (typeof row.value !== 'string') continue;
        const value = relocated(row.value);
        if (value !== row.value)
          updates.push({ table, column, id: row.id, value });
      }
    }
    for (const row of db
      .prepare(
        "SELECT path, target FROM skill_publications WHERE mode = 'link'",
      )
      .all()) {
      const target = relocated(row.target);
      if (target === row.target) continue;
      let stat;
      try {
        stat = lstatSync(row.path);
      } catch (error) {
        if (error.code === 'ENOENT') continue;
        throw error;
      }
      if (!stat.isSymbolicLink())
        throw Error(`Managed skill link was replaced: ${row.path}`);
      const original = readlinkSync(row.path);
      const current = resolve(dirname(row.path), original);
      if (current === target) continue;
      if (current !== row.target)
        throw Error(`Managed skill link points elsewhere: ${row.path}`);
      links.push({ path: row.path, original, target });
    }
    if (!updates.length) return { changes: 0, links: 0, backupPath: null };
    const backupPath = `${databasePath}.before-agent-manager-${Date.now()}.sqlite`;
    await backup(db, backupPath);
    chmodSync(backupPath, 0o600);
    db.exec('BEGIN IMMEDIATE');
    transaction = true;
    for (const link of links) {
      unlinkSync(link.path);
      changedLinks.push(link);
      symlinkSync(link.target, link.path, 'dir');
    }
    for (const { table, column, id, value } of updates)
      db.prepare(`UPDATE "${table}" SET "${column}" = ? WHERE rowid = ?`).run(
        value,
        id,
      );
    db.exec('COMMIT');
    transaction = false;
    return { changes: updates.length, links: links.length, backupPath };
  } catch (error) {
    if (transaction) db.exec('ROLLBACK');
    for (const link of changedLinks.reverse()) {
      try {
        unlinkSync(link.path);
      } catch (unlinkError) {
        if (unlinkError.code !== 'ENOENT') throw unlinkError;
      }
      symlinkSync(link.original, link.path, 'dir');
    }
    throw error;
  } finally {
    db.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const from = process.argv[2];
  if (!from)
    throw Error('Usage: pnpm prod:migrate-paths /absolute/old/repository');
  const to = import.meta.dirname;
  const databasePath = resolve(
    to,
    'server',
    process.env.AGENT_MANAGER_DB_PATH ?? 'data/agent-manager.sqlite',
  );
  console.log(await migrateRepository({ databasePath, from, to }));
}
