import {
  findProject,
  projectDependencies,
  removeProject,
} from '../repositories/projects.js';
import { detachProject } from './sessions.js';
import { RequestError } from '../lib/http/errors.js';

export function deleteProject(id: number, disposition: unknown) {
  if (!findProject(id)) throw new RequestError(404, 'Project not found.');
  if (
    disposition !== undefined &&
    (typeof disposition !== 'string' ||
      !['empty', 'keep', 'delete'].includes(disposition))
  )
    throw new RequestError(
      400,
      'Choose whether to keep or delete the sessions.',
    );
  const dependencies = projectDependencies(id);
  if (
    dependencies.sessionCount &&
    disposition !== 'keep' &&
    disposition !== 'delete'
  )
    throw new RequestError(
      409,
      'This project has sessions. Choose to keep them under No project or delete them with the project.',
    );
  if (disposition === 'delete' && dependencies.activeSessionCount)
    throw new RequestError(
      409,
      'End running sessions before deleting their records, or choose to keep them under No project.',
    );
  const mode = disposition === 'delete' ? 'delete' : 'keep';
  removeProject(id, mode);
  detachProject(id, mode === 'delete');
}
