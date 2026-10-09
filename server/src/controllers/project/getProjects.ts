import type { Request, Response } from 'express';
import { database } from '../../database.js';

const listProjects = database.prepare(
  'SELECT id, name, path FROM projects ORDER BY id',
);

export default function getProjects(_request: Request, response: Response) {
  response.json(listProjects.all());
}
