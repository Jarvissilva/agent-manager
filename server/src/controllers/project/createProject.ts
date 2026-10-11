import type { Request, Response } from 'express';
import { database } from '../../lib/database.js';
export default function createProject(request: Request, response: Response) {
  const name: unknown = request.body?.name;
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 100) {
    response
      .status(400)
      .json({ error: 'Enter a project name up to 100 characters.' });
    return;
  }
  const result = database
    .prepare('INSERT INTO projects(name) VALUES(?)')
    .run(name.trim());
  response
    .status(201)
    .json({ id: Number(result.lastInsertRowid), name: name.trim(), paths: [] });
}
