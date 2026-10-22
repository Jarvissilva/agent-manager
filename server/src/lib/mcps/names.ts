import { RequestError } from '../http/errors.js';

export function mcpName(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)
  )
    throw new RequestError(
      400,
      'Use an MCP name of 1–64 letters, numbers, dots, underscores, or hyphens, starting with a letter or number.',
    );
  return value;
}

// Inspect keys without matching names inside URLs, comments, or multiline strings.
// Refuse inline root MCP tables: extending a TOML inline table is not safe.
export function codexMcpNames(source: string): Set<string> {
  const names = new Set<string>();
  const statements: string[] = [];
  let statement = '',
    quote = '',
    multiline = false,
    escaped = false,
    depth = 0;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quote) {
      statement += char;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (quote === '"' && char === '\\') {
        escaped = true;
        continue;
      }
      if (multiline && source.slice(i, i + 3) === quote.repeat(3)) {
        statement += quote.repeat(2);
        i += 2;
        quote = '';
        multiline = false;
      } else if (!multiline && char === quote) quote = '';
      continue;
    }
    if (char === '#') {
      while (i < source.length && source[i] !== '\n') i++;
      if (!depth) {
        statements.push(statement.trim());
        statement = '';
      } else statement += '\n';
    } else if (char === '"' || char === "'") {
      quote = char;
      multiline = source.slice(i, i + 3) === char.repeat(3);
      statement += multiline ? char.repeat(3) : char;
      if (multiline) i += 2;
    } else if (char === '\n' && !depth) {
      statements.push(statement.trim());
      statement = '';
    } else {
      statement += char;
      if (char === '[' || char === '{') depth++;
      if (char === ']' || char === '}') depth--;
      if (depth < 0)
        throw Error(
          'The Codex configuration is invalid; it was left untouched.',
        );
    }
  }
  if (quote || depth)
    throw Error('The Codex configuration is invalid; it was left untouched.');
  statements.push(statement.trim());
  let table: string[] = [];
  for (const line of statements.filter(Boolean)) {
    if (line.startsWith('[')) {
      if (line.startsWith('[[')) {
        table = keyPath(line.slice(2, -2));
        if (table[0] === 'mcp_servers')
          throw Error(
            'MCP array tables are unsupported; configuration was left untouched.',
          );
      } else table = keyPath(line.slice(1, -1));
      if (table[0] === 'mcp_servers' && table.length > 1) names.add(table[1]);
    } else {
      let index = 0,
        quoted = '',
        escape = false;
      for (; index < line.length; index++) {
        const char = line[index];
        if (escape) {
          escape = false;
          continue;
        }
        if (quoted === '"' && char === '\\') {
          escape = true;
          continue;
        }
        if (quoted) {
          if (char === quoted) quoted = '';
        } else if (char === '"' || char === "'") quoted = char;
        else if (char === '=') break;
      }
      if (index === line.length)
        throw Error(
          'The Codex configuration is invalid; it was left untouched.',
        );
      const keys = [...table, ...keyPath(line.slice(0, index))];
      if (keys[0] === 'mcp_servers') {
        if (keys.length === 1)
          throw Error(
            'Inline root MCP tables are unsupported; configuration was left untouched.',
          );
        names.add(keys[1]);
      }
    }
  }
  return names;
}
function keyPath(value: string): string[] {
  const keys: string[] = [];
  let remaining = value.trim();
  while (remaining) {
    const match = /^(?:([A-Za-z0-9_-]+)|("(?:[^"\\]|\\.)*")|'([^']*)')/.exec(
      remaining,
    );
    if (!match)
      throw Error(
        'Unsupported Codex key syntax; configuration was left untouched.',
      );
    let key: string;
    try {
      key =
        match[1] ?? (match[2] ? (JSON.parse(match[2]) as string) : match[3]);
    } catch {
      throw Error(
        'Unsupported Codex key syntax; configuration was left untouched.',
      );
    }
    keys.push(key);
    remaining = remaining.slice(match[0].length).trim();
    if (!remaining) break;
    if (!remaining.startsWith('.') || !remaining.slice(1).trim())
      throw Error('The Codex configuration is invalid; it was left untouched.');
    remaining = remaining.slice(1).trim();
  }
  if (!keys.length)
    throw Error('The Codex configuration is invalid; it was left untouched.');
  return keys;
}
