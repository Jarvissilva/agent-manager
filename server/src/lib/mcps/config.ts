import { RequestError } from '../http/errors.js';

export type McpConfig =
  | {
      type: 'stdio';
      command: string;
      args: string[];
      env: Record<string, string>;
      cwd?: string;
    }
  | { type: 'http'; url: string; headers: Record<string, string> };

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new RequestError(400, 'Expected a configuration object.');
  return value as Record<string, unknown>;
}
function string(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.includes('\0') ||
    value.length > 16384
  )
    throw new RequestError(400, `Enter a valid ${label}.`);
  return value;
}
function strings(value: unknown, label: string): Record<string, string> {
  const entries = Object.entries(object(value ?? {}));
  const validated: [string, string][] = [];
  if (entries.length > 100) throw new RequestError(400, `Too many ${label}.`);
  for (const [key, item] of entries) {
    if (
      !key ||
      typeof item !== 'string' ||
      item.includes('\0') ||
      item.length > 16384 ||
      (label === 'headers'
        ? !/^[!#$%&'*+.^_`|~\w-]+$/.test(key) || /[\r\n]/.test(item)
        : !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
    )
      throw new RequestError(400, `Enter valid ${label}.`);
    validated.push([key, item]);
  }
  return Object.fromEntries(validated);
}
export function validateMcpConfig(input: unknown): McpConfig {
  const value = object(input);
  if (
    ['url', 'serverUrl', 'httpUrl'].filter((key) => value[key] !== undefined)
      .length > 1
  )
    throw new RequestError(400, 'Specify only one server URL.');
  if (value.env !== undefined && value.environment !== undefined)
    throw new RequestError(400, 'Specify env or environment, not both.');
  const url = value.url ?? value.serverUrl ?? value.httpUrl;
  const type = value.type ?? (url ? 'http' : 'stdio');
  if (!['stdio', 'http', 'remote', 'local'].includes(String(type)))
    throw new RequestError(400, 'Choose a command (stdio) or HTTP MCP server.');
  if (type === 'http' || type === 'remote') {
    if (
      ['command', 'args', 'env', 'environment', 'cwd'].some(
        (key) => value[key] !== undefined,
      )
    )
      throw new RequestError(
        400,
        'Command options cannot be used with a remote server.',
      );
    const address = string(url, 'HTTP URL');
    let parsed: URL;
    try {
      parsed = new URL(address);
    } catch {
      throw new RequestError(400, 'Enter a valid HTTP URL.');
    }
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.hash
    )
      throw new RequestError(
        400,
        'Use an HTTP(S) URL without embedded credentials or a fragment.',
      );
    return {
      type: 'http',
      url: address,
      headers: strings(value.headers ?? value.http_headers, 'headers'),
    };
  }
  if (url !== undefined)
    throw new RequestError(400, 'Choose a command or URL, not both.');
  if (value.headers !== undefined || value.http_headers !== undefined)
    throw new RequestError(400, 'Headers require a remote HTTP server.');
  if (Array.isArray(value.command) && value.args !== undefined)
    throw new RequestError(
      400,
      'Put arguments in the command array or args, not both.',
    );
  // OpenCode configurations use a command array; other clients use command + args.
  const command = Array.isArray(value.command)
    ? value.command[0]
    : value.command;
  const args = Array.isArray(value.command)
    ? value.command.slice(1)
    : (value.args ?? []);
  if (
    !Array.isArray(args) ||
    args.length > 100 ||
    args.some(
      (item) =>
        typeof item !== 'string' || item.includes('\0') || item.length > 16384,
    )
  )
    throw new RequestError(400, 'Arguments must be an array of strings.');
  const cwd =
    value.cwd === undefined || value.cwd === ''
      ? undefined
      : string(value.cwd, 'working directory');
  if (cwd && !cwd.startsWith('/'))
    throw new RequestError(400, 'Use an absolute working directory.');
  return {
    type: 'stdio',
    command: string(command, 'command'),
    args,
    env: strings(value.env ?? value.environment, 'environment variables'),
    ...(cwd ? { cwd } : {}),
  };
}

export function importMcpConfigs(
  input: unknown,
): { name: string; config: McpConfig; enabled: boolean }[] {
  const root = object(input);
  const definitions = root.mcpServers ?? root.mcp;
  const entries =
    definitions === undefined
      ? [
          [
            string(root.name, 'server name'),
            root.config ??
              Object.fromEntries(
                Object.entries(root).filter(([key]) => key !== 'name'),
              ),
          ] as const,
        ]
      : Object.entries(object(definitions));
  if (!entries.length || entries.length > 50)
    throw new RequestError(400, 'Import between 1 and 50 MCP servers.');
  return entries.map(([name, config]) => {
    const raw = object(config);
    if (
      (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') ||
      (raw.disabled !== undefined && typeof raw.disabled !== 'boolean')
    )
      throw new RequestError(
        400,
        'Enabled and disabled must be true or false.',
      );
    const supported = new Set([
      'name',
      'type',
      'command',
      'args',
      'env',
      'environment',
      'cwd',
      'url',
      'serverUrl',
      'httpUrl',
      'headers',
      'http_headers',
      'enabled',
      'disabled',
    ]);
    if (Object.keys(raw).some((key) => !supported.has(key)))
      throw new RequestError(
        400,
        'Unsupported MCP options. Import command/arguments/environment or URL/headers configuration.',
      );
    return {
      name,
      config: validateMcpConfig(raw),
      enabled: raw.enabled !== false && raw.disabled !== true,
    };
  });
}

export function stable(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => JSON.stringify(key) + ':' + stable(item))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
