import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import {
  forgetMcpPublication,
  mcpPublications,
  saveMcpPublication,
  type McpRecord,
} from '../../repositories/mcps.js';
import { stable, type McpConfig } from './config.js';
import { codexMcpNames } from './names.js';
import { RequestError } from '../http/errors.js';

export function atomicPrivateWrite(path: string, contents: string) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const existing = lstatSync(path, { throwIfNoEntry: false });
  if (existing && !existing.isFile())
    throw Error('The configuration path is not a regular file.');
  const temporary = path + '.' + randomUUID() + '.tmp';
  try {
    writeFileSync(temporary, contents, { mode: 0o600, flag: 'wx' });
    renameSync(temporary, path);
    chmodSync(path, 0o600);
  } finally {
    rmSync(temporary, { force: true });
  }
}
const signature = (value: unknown) =>
  createHash('sha256').update(stable(value)).digest('hex');

// Strip JSONC comments and trailing commas without treating strings as comments.
export function parseProviderJson(source: string): Record<string, unknown> {
  let stripped = '',
    quoted = false,
    escaped = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      stripped += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') {
      quoted = true;
      stripped += char;
    } else if (char === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      stripped += '\n';
    } else if (char === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      if (end < 0) throw Error('Invalid JSON configuration.');
      i = end + 1;
      stripped += ' ';
    } else stripped += char;
  }
  let normalized = '';
  quoted = false;
  escaped = false;
  for (let i = 0; i < stripped.length; i++) {
    const char = stripped[i];
    if (!quoted && char === ',' && /^\s*[}\]]/.test(stripped.slice(i + 1)))
      continue;
    normalized += char;
    if (escaped) escaped = false;
    else if (quoted && char === '\\') escaped = true;
    else if (char === '"') quoted = !quoted;
  }
  const value: unknown = JSON.parse(normalized);
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('Expected a JSON configuration object.');
  return value as Record<string, unknown>;
}

export function mcpDestinations() {
  const override = process.env.AGENT_MANAGER_MCP_HOME;
  const home = override ?? homedir();
  const openCodeRoot = override
    ? join(home, '.config')
    : (process.env.XDG_CONFIG_HOME ?? join(home, '.config'));
  const json = join(openCodeRoot, 'opencode/opencode.json');
  const jsonc = join(openCodeRoot, 'opencode/opencode.jsonc');
  return [
    {
      provider: 'codex',
      path: join(
        override
          ? join(home, '.codex')
          : (process.env.CODEX_HOME ?? join(home, '.codex')),
        'config.toml',
      ),
    },
    {
      provider: 'antigravity',
      path: join(home, '.gemini/config/mcp_config.json'),
    },
    {
      provider: 'opencode',
      path: existsSync(jsonc) && !existsSync(json) ? jsonc : json,
    },
  ];
}

function toml(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(toml).join(', ') + ']';
  if (value && typeof value === 'object')
    return (
      '{ ' +
      Object.entries(value)
        .map(([key, item]) => JSON.stringify(key) + ' = ' + toml(item))
        .join(', ') +
      ' }'
    );
  return JSON.stringify(value);
}

export type McpPublicationStatus = {
  provider: string;
  path: string;
  status: string;
  error: string | null;
};
export type PreparedMcpPublication = {
  provider: string;
  path: string;
  original: string;
  existed: boolean;
  contents: string;
  publishedSignature: string;
};
function prepareDestination(
  destination: ReturnType<typeof mcpDestinations>[number],
  record: McpRecord,
  config: McpConfig,
  launcher: string,
  source: string,
  remove = false,
  nativeName = record.nativeName,
): PreparedMcpPublication {
  const ownership = mcpPublications(record.id).find(
    (value) => value.provider === destination.provider,
  );
  if (ownership && ownership.path !== destination.path)
    throw Error(
      'The provider configuration location changed. Restore the previous location before publishing.',
    );
  const stat = lstatSync(destination.path, { throwIfNoEntry: false });
  if (stat && !stat.isFile())
    throw Error(
      'Provider configuration must be a regular file; its existing link was left untouched.',
    );
  const original = existsSync(destination.path)
    ? readFileSync(destination.path, 'utf8')
    : '';
  const active = !remove;
  const local = { command: process.execPath, args: [launcher, source] };
  let entry: Record<string, unknown>;
  if (destination.provider === 'codex')
    entry =
      config.type === 'stdio'
        ? { ...local, enabled: Boolean(record.enabled) }
        : {
            url: config.url,
            http_headers: config.headers,
            enabled: Boolean(record.enabled),
          };
  else if (destination.provider === 'antigravity')
    entry =
      config.type === 'stdio'
        ? { ...local, disabled: !record.enabled }
        : {
            serverUrl: config.url,
            headers: config.headers,
            disabled: !record.enabled,
          };
  else
    entry =
      config.type === 'stdio'
        ? {
            type: 'local',
            command: [local.command, ...local.args],
            enabled: Boolean(record.enabled),
          }
        : {
            type: 'remote',
            url: config.url,
            headers: config.headers,
            enabled: Boolean(record.enabled),
            ...(Object.keys(config.headers).some(
              (key) => key.toLowerCase() === 'authorization',
            )
              ? { oauth: false }
              : {}),
          };

  let contents: string;
  let current: unknown;
  let published: unknown;
  if (destination.provider === 'codex') {
    const begin = `# BEGIN Agent Manager MCP ${record.nativeName}\n`;
    const end = `# END Agent Manager MCP ${record.nativeName}\n`;
    const start = original.indexOf(begin);
    const finish = start < 0 ? -1 : original.indexOf(end, start + begin.length);
    if (start >= 0 && finish < 0)
      throw Error('The managed MCP block was modified; it was left untouched.');
    const block =
      start < 0 ? undefined : original.slice(start, finish + end.length);
    current = block;
    const rest = block
      ? original.slice(0, start) + original.slice(finish + end.length)
      : original;
    if (
      [...codexMcpNames(rest)].some(
        (name) =>
          name.toLowerCase() === nativeName.toLowerCase() ||
          name.toLowerCase() === record.nativeName.toLowerCase(),
      )
    )
      throw Error(
        'An existing MCP configuration conflicts with this publication; it was left untouched.',
      );
    const next = `# BEGIN Agent Manager MCP ${nativeName}\n[mcp_servers.${JSON.stringify(nativeName)}]\n${Object.entries(
      entry,
    )
      .map(([key, value]) => `${key} = ${toml(value)}\n`)
      .join('')}# END Agent Manager MCP ${nativeName}\n`;
    published = next;
    contents = active
      ? block
        ? original.replace(block, next)
        : original + (original.endsWith('\n') || !original ? '' : '\n') + next
      : rest;
    codexMcpNames(contents);
  } else {
    const root = original ? parseProviderJson(original) : {};
    const key = destination.provider === 'opencode' ? 'mcp' : 'mcpServers';
    const existing = root[key];
    if (
      existing !== undefined &&
      (!existing || typeof existing !== 'object' || Array.isArray(existing))
    )
      throw Error('The provider MCP configuration is invalid.');
    const entries = (existing ?? {}) as Record<string, unknown>;
    current = Object.hasOwn(entries, record.nativeName)
      ? entries[record.nativeName]
      : undefined;
    if (
      nativeName !== record.nativeName &&
      Object.keys(entries).some(
        (name) =>
          name !== record.nativeName &&
          name.toLowerCase() === nativeName.toLowerCase(),
      )
    )
      throw Error(
        'An existing MCP configuration conflicts with this publication; it was left untouched.',
      );
    published = entry;
    delete entries[record.nativeName];
    if (active) entries[nativeName] = entry;
    root[key] = entries;
    contents = JSON.stringify(root, null, 2) + '\n';
  }
  if (
    current !== undefined &&
    (!ownership || signature(current) !== ownership.signature)
  )
    throw Error(
      'This MCP entry was changed outside Agent OS; it was left untouched.',
    );

  return {
    ...destination,
    original,
    existed: Boolean(stat),
    contents,
    publishedSignature: signature(published),
  };
}
export function prepareMcpRename(
  record: McpRecord,
  name: string,
  config: McpConfig,
  launcher: string,
  source: string,
) {
  return mcpDestinations().map((destination) => {
    try {
      return prepareDestination(
        destination,
        record,
        config,
        launcher,
        source,
        false,
        name,
      );
    } catch (error) {
      throw new RequestError(
        409,
        `${destination.provider}: ${safePublicationError(error)}`,
      );
    }
  });
}
export function assertMcpNameAvailable(name: string, except?: McpRecord) {
  for (const destination of mcpDestinations()) {
    try {
      const stat = lstatSync(destination.path, { throwIfNoEntry: false });
      if (!stat) continue;
      if (!stat.isFile())
        throw Error(
          'Provider configuration must be a regular file; it was left untouched.',
        );
      const original = readFileSync(destination.path, 'utf8');
      let names: string[];
      if (destination.provider === 'codex')
        names = [...codexMcpNames(original)];
      else {
        const root = parseProviderJson(original);
        const value =
          root[destination.provider === 'opencode' ? 'mcp' : 'mcpServers'];
        if (
          value !== undefined &&
          (!value || typeof value !== 'object' || Array.isArray(value))
        )
          throw Error('The provider MCP configuration is invalid.');
        names = Object.keys(value ?? {});
      }
      if (
        names.some(
          (existing) =>
            existing.toLowerCase() === name.toLowerCase() &&
            existing !== except?.nativeName,
        )
      )
        throw new RequestError(
          409,
          `${destination.provider}: MCP name "${name}" already exists. Existing configuration was left untouched.`,
        );
    } catch (error) {
      if (error instanceof RequestError) throw error;
      throw new RequestError(
        409,
        `${destination.provider}: ${safePublicationError(error)}`,
      );
    }
  }
}
export function safePublicationError(error: unknown) {
  return error instanceof Error &&
    /left untouched|location changed|regular file|configuration is invalid/.test(
      error.message,
    )
    ? error.message
    : 'Could not publish provider configuration. Check file permissions and configuration syntax.';
}
export function publishMcp(
  record: McpRecord,
  config: McpConfig,
  launcher: string,
  source: string,
  remove = false,
): McpPublicationStatus[] {
  return mcpDestinations().map((destination) => {
    try {
      const prepared = prepareDestination(
        destination,
        record,
        config,
        launcher,
        source,
        remove,
      );
      if (prepared.contents !== prepared.original) {
        if (
          prepared.original &&
          !existsSync(destination.path + '.before-agent-manager')
        )
          atomicPrivateWrite(
            destination.path + '.before-agent-manager',
            prepared.original,
          );
        atomicPrivateWrite(destination.path, prepared.contents);
      }
      if (remove) forgetMcpPublication(record.id, destination.provider);
      else
        saveMcpPublication({
          mcpId: record.id,
          ...destination,
          signature: prepared.publishedSignature,
        });
      return {
        ...destination,
        status: remove ? 'removed' : record.enabled ? 'published' : 'disabled',
        error: null,
      };
    } catch (error) {
      return {
        ...destination,
        status: 'error',
        error: safePublicationError(error),
      };
    }
  });
}
