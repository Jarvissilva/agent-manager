import { realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { RequestError } from './http/errors.js';

export async function workingDirectory(value: unknown) {
  if (typeof value !== 'string' || !value.trim())
    throw new RequestError(400, 'Choose a working folder.');
  const input = value.trim();
  const expanded =
    input === '~'
      ? homedir()
      : input.startsWith('~/')
        ? join(homedir(), input.slice(2))
        : input;
  if (!isAbsolute(expanded))
    throw new RequestError(
      400,
      'Use an absolute directory path or a path starting with ~/.',
    );
  try {
    const path = await realpath(expanded);
    if ((await stat(path)).isDirectory()) return path;
  } catch {
    /* Use the same error for unavailable directories. */
  }
  throw new RequestError(
    400,
    'The working folder does not exist or cannot be accessed.',
  );
}

export async function requireWorkingDirectory(path: string) {
  try {
    if ((await stat(path)).isDirectory()) return;
  } catch {
    /* Keep the saved path unchanged. */
  }
  throw new RequestError(
    400,
    'The saved working folder is no longer available.',
  );
}
