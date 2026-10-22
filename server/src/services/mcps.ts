import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { database, databasePath } from '../lib/database.js';
import {
  object,
  importMcpConfigs,
  validateMcpConfig,
  type McpConfig,
} from '../lib/mcps/config.js';
import {
  atomicPrivateWrite,
  publishMcp,
  assertMcpNameAvailable,
  mcpDestinations,
} from '../lib/mcps/publication.js';
import { mcpName } from '../lib/mcps/names.js';
import { recoverMcpRenames, renameMcp } from '../lib/mcps/rename.js';
import { RequestError } from '../lib/http/errors.js';
import { findMcp, listMcps, type McpRecord } from '../repositories/mcps.js';

const root = join(dirname(databasePath), 'mcps');
const launcher = join(root, 'stdio.cjs');
const source = (id: number) => join(root, `${id}.json`);
const launcherContents = `// Agent Manager: shared stdio MCP launcher. No secret values appear in argv.
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const child = spawn(config.command, config.args, {
  cwd: config.cwd || process.cwd(), env: { ...process.env, ...config.env }, stdio: 'inherit',
});
child.on('error', () => { console.error('Could not start the configured MCP executable.'); process.exitCode = 1; });
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => child.kill(signal));
child.on('exit', (code, signal) => {
  if (signal) {
    for (const name of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.removeAllListeners(name);
    process.kill(process.pid, signal);
  } else process.exit(code ?? 1);
});
`;
function read(record: McpRecord): McpConfig {
  try {
    return validateMcpConfig(
      JSON.parse(readFileSync(source(record.id), 'utf8')),
    );
  } catch {
    throw new RequestError(
      409,
      'The saved MCP configuration is missing or invalid.',
    );
  }
}
function view(record: McpRecord) {
  const config = read(record);
  const redacted =
    config.type === 'stdio'
      ? {
          ...config,
          env: Object.fromEntries(
            Object.keys(config.env).map((key) => [key, null]),
          ),
        }
      : {
          ...config,
          headers: Object.fromEntries(
            Object.keys(config.headers).map((key) => [key, null]),
          ),
        };
  return {
    ...record,
    enabled: Boolean(record.enabled),
    config: redacted,
    publications: JSON.parse(record.publications),
  };
}
export function getMcps() {
  return listMcps().map(view);
}
export function getMcp(id: number) {
  const record = findMcp(id);
  if (!record) throw new RequestError(404, 'MCP server not found.');
  return view(record);
}
export function syncMcp(id: number) {
  if (recoverMcpRenames().has(id))
    throw new RequestError(
      409,
      'MCP rename recovery is blocked. Resolve the publication errors before retrying.',
    );
  let record = findMcp(id);
  if (!record) throw new RequestError(404, 'MCP server not found.');
  if (record.nativeName !== record.name) {
    try {
      const name = mcpName(record.name);
      nameAvailable(name, id);
      renameMcp(
        record,
        name,
        name,
        record.enabled,
        read(record),
        launcher,
        source(id),
      );
      record = findMcp(id)!;
    } catch (error) {
      migrationError(record, error);
      throw error;
    }
  }
  if (
    !existsSync(launcher) ||
    readFileSync(launcher, 'utf8') !== launcherContents
  )
    atomicPrivateWrite(launcher, launcherContents);
  const publications = publishMcp(record, read(record), launcher, source(id));
  database
    .prepare('UPDATE mcp_servers SET publications=? WHERE id=?')
    .run(JSON.stringify(publications), id);
  return getMcp(id);
}
function nameAvailable(name: string, id?: number) {
  if (
    database
      .prepare(
        'SELECT id FROM mcp_servers WHERE (name=? COLLATE NOCASE OR nativeName=? COLLATE NOCASE) AND id!=?',
      )
      .get(name, name, id ?? 0)
  )
    throw new RequestError(
      409,
      `MCP name "${name}" already exists in Agent Manager.`,
    );
  assertMcpNameAvailable(name, id ? findMcp(id) : undefined);
}
function addMany(
  entries: { name: string; config: McpConfig; enabled: boolean }[],
) {
  if (recoverMcpRenames().size)
    throw new RequestError(
      409,
      'Resolve pending MCP rename recovery before adding servers.',
    );
  const checked = entries.map((entry) => ({
    ...entry,
    name: mcpName(entry.name),
  }));
  const names = new Set<string>();
  for (const entry of checked) {
    nameAvailable(entry.name);
    const key = entry.name.toLowerCase();
    if (names.has(key))
      throw new RequestError(
        409,
        'The import contains duplicate server names.',
      );
    names.add(key);
  }
  const ids: number[] = [];
  database.exec('BEGIN IMMEDIATE');
  try {
    for (const entry of checked) {
      const now = new Date().toISOString();
      const result = database
        .prepare(
          'INSERT INTO mcp_servers(name,nativeName,enabled,createdAt,updatedAt) VALUES(?,?,?,?,?)',
        )
        .run(entry.name, entry.name, Number(entry.enabled), now, now);
      const id = Number(result.lastInsertRowid);
      ids.push(id);
      atomicPrivateWrite(
        source(id),
        JSON.stringify(entry.config, null, 2) + '\n',
      );
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    for (const id of ids) rmSync(source(id), { force: true });
    throw error;
  }
  return ids.map(syncMcp);
}
export function addMcp(input: unknown) {
  const value = object(input);
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean')
    throw new RequestError(400, 'Enabled must be true or false.');
  return addMany([
    {
      name: mcpName(value.name),
      config: validateMcpConfig(value.config),
      enabled: value.enabled !== false,
    },
  ])[0];
}
export function importMcps(input: unknown) {
  return addMany(importMcpConfigs(input));
}
export function updateMcp(id: number, input: unknown) {
  if (recoverMcpRenames().has(id))
    throw new RequestError(
      409,
      'Resolve pending MCP rename recovery before editing this server.',
    );
  const record = findMcp(id);
  if (!record) throw new RequestError(404, 'MCP server not found.');
  const value = object(input);
  const name = value.name === undefined ? record.name : mcpName(value.name);
  nameAvailable(name, id);
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean')
    throw new RequestError(400, 'Enabled must be true or false.');
  const old = read(record);
  let config = old;
  if (value.config !== undefined) {
    const next = { ...object(value.config) };
    const field = old.type === 'stdio' ? 'env' : 'headers';
    if (next[field] !== undefined) {
      const previous = old.type === 'stdio' ? old.env : old.headers;
      next[field] = Object.fromEntries(
        Object.entries(object(next[field])).map(([key, item]) => {
          if (item === null && !Object.hasOwn(previous, key))
            throw new RequestError(400, 'A new secret needs a value.');
          return [key, item === null ? previous[key] : item];
        }),
      );
    }
    config = validateMcpConfig(next);
  }
  if (record.nativeName !== name) {
    renameMcp(
      record,
      name,
      name,
      value.enabled === undefined ? record.enabled : Number(value.enabled),
      config,
      launcher,
      source(id),
    );
    return getMcp(id);
  }
  atomicPrivateWrite(source(id), JSON.stringify(config, null, 2) + '\n');
  try {
    database
      .prepare('UPDATE mcp_servers SET name=?,enabled=?,updatedAt=? WHERE id=?')
      .run(
        name,
        value.enabled === undefined ? record.enabled : Number(value.enabled),
        new Date().toISOString(),
        id,
      );
  } catch (error) {
    atomicPrivateWrite(source(id), JSON.stringify(old, null, 2) + '\n');
    throw error;
  }
  return syncMcp(id);
}
export function deleteMcp(id: number) {
  if (recoverMcpRenames().has(id))
    throw new RequestError(
      409,
      'Resolve pending MCP rename recovery before deleting this server.',
    );
  const record = findMcp(id);
  if (!record) throw new RequestError(404, 'MCP server not found.');
  const publications = publishMcp(
    record,
    read(record),
    launcher,
    source(id),
    true,
  );
  if (publications.some((value) => value.error)) {
    database
      .prepare('UPDATE mcp_servers SET publications=? WHERE id=?')
      .run(JSON.stringify(publications), id);
    throw new RequestError(
      409,
      'Some provider entries could not be removed. Resolve the publication errors and retry deletion; the saved MCP was preserved.',
    );
  }
  database.prepare('DELETE FROM mcp_servers WHERE id=?').run(id);
  rmSync(source(id), { force: true });
}
export function initializeMcps() {
  const blocked = recoverMcpRenames();
  for (const record of listMcps()) {
    if (blocked.has(record.id)) continue;
    try {
      syncMcp(record.id);
    } catch {
      console.error(`Could not synchronize MCP server ${record.id}.`);
    }
  }
}

function migrationError(record: McpRecord, error: unknown) {
  const message =
    error instanceof RequestError
      ? error.message
      : 'MCP name migration failed; the old name was preserved. Check provider file permissions.';
  database.prepare('UPDATE mcp_servers SET publications=? WHERE id=?').run(
    JSON.stringify(
      mcpDestinations().map((destination) => ({
        ...destination,
        status: 'error',
        error: message,
      })),
    ),
    record.id,
  );
}
