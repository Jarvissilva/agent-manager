import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { database, databasePath } from '../database.js';
import {
  findMcp,
  saveMcpPublication,
  type McpRecord,
} from '../../repositories/mcps.js';
import {
  atomicPrivateWrite,
  mcpDestinations,
  prepareMcpRename,
  type PreparedMcpPublication,
} from './publication.js';
import { RequestError } from '../http/errors.js';

const root = join(dirname(databasePath), 'mcps/renames');
const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
type RenameJournal = {
  id: number;
  oldName: string;
  newName: string;
  files: {
    path: string;
    backup: string;
    existed: boolean;
    before: string;
    after: string;
  }[];
};
function restore(folder: string, journal: RenameJournal) {
  // Validate every destination before restoring any of them; never overwrite external edits.
  for (const file of journal.files) {
    if (
      file.existed &&
      digest(readFileSync(join(folder, file.backup), 'utf8')) !== file.before
    )
      throw new RequestError(
        409,
        'MCP rename backup changed; configuration was left untouched.',
      );
    const present = existsSync(file.path);
    const current = present ? digest(readFileSync(file.path, 'utf8')) : null;
    if (
      current !== file.after &&
      current !== (file.existed ? file.before : null)
    )
      throw new RequestError(
        409,
        'MCP rename recovery found external changes; configuration was left untouched. Restore the provider files from the private rename backups before retrying.',
      );
  }
  for (const file of [...journal.files].reverse()) {
    const current = existsSync(file.path)
      ? digest(readFileSync(file.path, 'utf8'))
      : null;
    if (current === (file.existed ? file.before : null)) continue;
    if (file.existed)
      atomicPrivateWrite(
        file.path,
        readFileSync(join(folder, file.backup), 'utf8'),
      );
    else rmSync(file.path, { force: true });
  }
}
export function recoverMcpRenames() {
  const blocked = new Set<number>();
  if (!existsSync(root)) return blocked;
  for (const name of readdirSync(root)) {
    const folder = join(root, name);
    const path = join(folder, 'journal.json');
    if (!existsSync(path)) continue; // Interrupted staging has not changed provider files.
    const journal = JSON.parse(readFileSync(path, 'utf8')) as RenameJournal;
    const record = findMcp(journal.id);
    if (record?.nativeName === journal.newName) {
      rmSync(folder, { recursive: true, force: true });
      continue;
    }
    try {
      if (!record || record.nativeName !== journal.oldName)
        throw Error('Unexpected MCP rename state.');
      restore(folder, journal);
      rmSync(folder, { recursive: true, force: true });
    } catch {
      blocked.add(journal.id);
      const publications = mcpDestinations().map((destination) => ({
        ...destination,
        status: 'error',
        error:
          'MCP rename recovery is blocked by external changes or file permissions. Private backups were preserved; resolve this before synchronizing.',
      }));
      database
        .prepare('UPDATE mcp_servers SET publications=? WHERE id=?')
        .run(JSON.stringify(publications), journal.id);
    }
  }
  return blocked;
}
export function renameMcp(
  record: McpRecord,
  name: string,
  displayName: string,
  enabled: number,
  config: Parameters<typeof prepareMcpRename>[2],
  launcher: string,
  source: string,
) {
  const prepared = prepareMcpRename(
    { ...record, enabled },
    name,
    config,
    launcher,
    source,
  );
  const folder = join(root, randomUUID());
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  // Credentials remain exclusively in private files, never in the journal or SQLite.
  const files = [
    ...prepared,
    {
      path: source,
      original: readFileSync(source, 'utf8'),
      existed: true,
      contents: JSON.stringify(config, null, 2) + '\n',
    },
  ];
  const journal: RenameJournal = {
    id: record.id,
    oldName: record.nativeName,
    newName: name,
    files: files.map((file, index) => ({
      path: file.path,
      backup: `${index}.before`,
      existed: file.existed,
      before: digest(file.original),
      after: digest(file.contents),
    })),
  };
  files.forEach((file, index) =>
    atomicPrivateWrite(join(folder, `${index}.before`), file.original),
  );
  atomicPrivateWrite(join(folder, 'journal.json'), JSON.stringify(journal));
  try {
    for (const file of files) {
      const current = existsSync(file.path)
        ? readFileSync(file.path, 'utf8')
        : '';
      if (current !== file.original)
        throw Error('Provider configuration changed during MCP rename.');
      if (file.contents !== file.original)
        atomicPrivateWrite(file.path, file.contents);
    }
    database.exec('BEGIN IMMEDIATE');
    try {
      database
        .prepare(
          'UPDATE mcp_servers SET name=?,nativeName=?,previousNativeName=?,enabled=?,updatedAt=?,publications=? WHERE id=?',
        )
        .run(
          displayName,
          name,
          record.nativeName,
          enabled,
          new Date().toISOString(),
          JSON.stringify(
            prepared.map((file) => ({
              provider: file.provider,
              path: file.path,
              status: enabled ? 'published' : 'disabled',
              error: null,
            })),
          ),
          record.id,
        );
      for (const file of prepared) saveRenamePublication(record.id, file);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  } catch {
    try {
      restore(folder, journal);
      rmSync(folder, { recursive: true, force: true });
    } catch {
      throw new RequestError(
        409,
        'MCP rename could not finish or recover. The old name and private backups were preserved; resolve file permissions or external changes before retrying.',
      );
    }
    throw new RequestError(
      409,
      'MCP rename failed. The old name and provider configurations were restored. Check provider file permissions.',
    );
  }
  // A crash after the DB commit is handled by recovery without reverting the committed rename.
  rmSync(folder, { recursive: true, force: true });
}
function saveRenamePublication(id: number, file: PreparedMcpPublication) {
  saveMcpPublication({
    mcpId: id,
    provider: file.provider,
    path: file.path,
    signature: file.publishedSignature,
  });
}
