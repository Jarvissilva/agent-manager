import type { Request, Response } from 'express';
import { positiveId } from '../../lib/http/errors.js';
import { deleteProject as removeProject } from '../../services/projects.js';

export default function deleteProject(request: Request, response: Response) {
  removeProject(
    positiveId(request.params.projectId, 'project'),
    request.body?.sessionDisposition,
  );
  response.status(204).end();
}
