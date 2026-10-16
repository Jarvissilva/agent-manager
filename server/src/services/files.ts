import {
  access,
  mkdir,
  readdir,
  realpath,
  readFile,
  stat,
  writeFile,
  rm,
} from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
} from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { databasePath } from '../lib/database.js';
import { workingDirectory } from '../lib/directories.js';
import { RequestError } from '../lib/http/errors.js';

export type FileAttachment = {
  path: string;
  name: string;
  size: number;
  mime: string;
  source: 'reference' | 'upload';
};
export const maxFileSize = 20 * 1024 * 1024;
export const maxAttachments = 8;
export const uploadDirectory = join(dirname(databasePath), 'uploads');
const mimeTypes: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.csv': 'text/csv',
};

export async function referenceFile(value: unknown): Promise<FileAttachment> {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 4096 ||
    value.includes('\0')
  )
    throw new RequestError(400, 'Choose a valid file path.');
  const input = value.startsWith('~/')
    ? join(homedir(), value.slice(2))
    : value;
  if (!isAbsolute(input))
    throw new RequestError(400, 'Use an absolute file path or ~/ path.');
  try {
    const path = await realpath(input);
    const info = await stat(path);
    if (!info.isFile()) throw Error('Not a regular file');
    await access(path, constants.R_OK);
    if (info.size > maxFileSize)
      throw new RequestError(400, 'Choose a file up to 20 MB.');
    const location = relative(uploadDirectory, path);
    return {
      path,
      name: basename(path),
      size: info.size,
      mime:
        mimeTypes[extname(path).toLowerCase()] ?? 'application/octet-stream',
      source:
        location && !location.startsWith('..') && !isAbsolute(location)
          ? 'upload'
          : 'reference',
    };
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError(400, 'The file does not exist or cannot be read.');
  }
}

export async function validateAttachments(
  value: unknown,
): Promise<FileAttachment[]> {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxAttachments)
    throw new RequestError(400, 'Attach up to 8 files.');
  const files: FileAttachment[] = [];
  for (const raw of value) {
    const file = await referenceFile(
      typeof raw === 'string'
        ? raw
        : raw && typeof raw === 'object'
          ? (raw as Record<string, unknown>).path
          : undefined,
    );
    if (!files.some((previous) => previous.path === file.path))
      files.push(file);
  }
  if (files.reduce((size, file) => size + file.size, 0) > maxFileSize * 2)
    throw new RequestError(400, 'Attachments must total 40 MB or less.');
  return files;
}

export async function browseFiles(
  path: unknown,
  hidden: boolean,
  offset: number,
) {
  const directory = await workingDirectory(path ?? homedir());
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    throw new RequestError(400, 'This folder cannot be read.');
  }
  const sorted = entries
    .filter(
      (entry) =>
        (hidden || !entry.name.startsWith('.')) &&
        (entry.isDirectory() || entry.isFile() || entry.isSymbolicLink()),
    )
    .sort(
      (a, b) =>
        Number(b.isDirectory()) - Number(a.isDirectory()) ||
        a.name.localeCompare(b.name),
    );
  const page = (
    await Promise.all(
      sorted.slice(offset, offset + 200).map(async (entry) => {
        try {
          const path = join(directory, entry.name);
          const info = await stat(path);
          if (!info.isDirectory() && !info.isFile()) return null;
          return {
            name: entry.name,
            path,
            type: info.isDirectory()
              ? ('directory' as const)
              : ('file' as const),
            size: info.size,
          };
        } catch {
          return null;
        }
      }),
    )
  ).filter((entry) => entry !== null);
  return {
    path: directory,
    parent: dirname(directory) === directory ? null : dirname(directory),
    entries: page,
    nextOffset: offset + 200 < sorted.length ? offset + 200 : null,
  };
}

export async function storeUpload(name: string, data: Buffer) {
  if (!data.length || data.length > maxFileSize)
    throw new RequestError(400, 'Upload a non-empty file up to 20 MB.');
  let filename = Array.from(basename(name.replaceAll('\\', '/')))
    .map((character) =>
      character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127
        ? '_'
        : character,
    )
    .join('');
  while (Buffer.byteLength(filename) > 200) filename = filename.slice(0, -1);
  if (!filename || filename === '.' || filename === '..')
    throw new RequestError(400, 'Choose a valid filename.');
  const directory = join(uploadDirectory, randomUUID());
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    const path = join(directory, filename);
    await writeFile(path, data, { flag: 'wx', mode: 0o600 });
    return await referenceFile(path);
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export function attachmentPrompt(prompt: string, files: FileAttachment[]) {
  if (!files.length) return prompt;
  return `${prompt || 'Use these files as reference.'}\n\nAttached files on this machine:\n${JSON.stringify(
    files.map(({ name, path }) => ({ name, path })),
    null,
    2,
  )}`;
}
export async function openCodeAttachments(files: FileAttachment[]) {
  return Promise.all(
    files
      .filter(
        (file) =>
          file.mime.startsWith('image/') || file.mime === 'application/pdf',
      )
      .map(async (file) => ({
        data: (await readFile(file.path)).toString('base64'),
        mime: file.mime,
        name: file.name,
        source: { type: 'uri', uri: pathToFileURL(file.path).href },
      })),
  );
}
