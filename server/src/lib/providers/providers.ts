import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { delimiter, resolve } from 'node:path';
const providers = [
  { id: 'codex', name: 'Codex', command: 'codex' },
  { id: 'antigravity', name: 'Antigravity', command: 'agy' },
  { id: 'opencode', name: 'OpenCode', command: 'opencode' },
];

export async function isAvailable(command: string) {
  const directories = process.env.PATH?.split(delimiter) ?? [];

  for (const directory of directories) {
    try {
      const path = resolve(directory, command);
      await access(path, constants.X_OK);

      if ((await stat(path)).isFile()) {
        return true;
      }
    } catch {
      // This PATH entry does not contain an accessible executable.
    }
  }

  return false;
}

export async function listProviders() {
  return Promise.all(
    providers.map(async (provider) => ({
      ...provider,
      available: await isAvailable(provider.command),
    })),
  );
}
