import { realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import type { Request, Response } from 'express';
import { database } from '../../database.js';
const insertProject = database.prepare(
  'INSERT INTO projects (name, path) VALUES (?, ?) ON CONFLICT(path) DO NOTHING',
);

export default async function createProject(
  request: Request,
  response: Response,
) {
  const body: unknown = request.body;

  if (
    typeof body !== 'object' ||
    body === null ||
    !('name' in body) ||
    typeof body.name !== 'string' ||
    !body.name.trim() ||
    !('path' in body) ||
    typeof body.path !== 'string' ||
    !body.path.trim()
  ) {
    response
      .status(400)
      .json({ error: 'Enter a project name and directory path.' });
    return;
  }

  const name = body.name.trim();
  const inputPath = body.path.trim();
  const expandedPath = inputPath.startsWith('~/')
    ? join(homedir(), inputPath.slice(2))
    : inputPath === '~'
      ? homedir()
      : inputPath;

  if (!isAbsolute(expandedPath)) {
    response.status(400).json({
      error: 'Use an absolute directory path or a path starting with ~/.',
    });
    return;
  }

  let path: string;

  try {
    path = await realpath(expandedPath);

    if (!(await stat(path)).isDirectory()) {
      response
        .status(400)
        .json({ error: 'The project path must be a directory.' });
      return;
    }
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      ['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'ELOOP'].includes(
        String(error.code),
      )
    ) {
      response
        .status(400)
        .json({ error: 'The directory does not exist or cannot be accessed.' });
      return;
    }

    throw error;
  }

  const result = insertProject.run(name, path);

  if (result.changes === 0) {
    response
      .status(409)
      .json({ error: 'This directory is already registered.' });
    return;
  }

  response.status(201).json({ id: Number(result.lastInsertRowid), name, path });
}
