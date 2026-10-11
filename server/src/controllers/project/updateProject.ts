import type { Request, Response } from 'express';
import { positiveId, RequestError, textField } from '../../lib/http/errors.js';
import { findProject, renameProject } from '../../repositories/projects.js';

export default function updateProject(request: Request, response: Response) {
  const id = positiveId(request.params.projectId, 'project');
  if (!findProject(id)) throw new RequestError(404, 'Project not found.');
  const name = textField(request.body?.name, 'a project name', 100);
  response.json(renameProject(id, name));
}
