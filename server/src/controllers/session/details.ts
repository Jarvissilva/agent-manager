import { chatQueue } from '../../repositories/chatQueue.js';
import { usageSummary } from '../../repositories/usage.js';
import type { Request, Response } from 'express';
import {
  findSessionById,
  findSavedSession,
  updateSessionProject,
  renameSession,
} from '../../repositories/sessions.js';
import { findProject } from '../../repositories/projects.js';
import { positiveId, RequestError, textField } from '../../lib/http/errors.js';
import {
  getSessionById,
  withSessionActivity,
} from '../../services/sessions.js';

export function getSavedSession(request: Request, response: Response) {
  const row = findSessionById(String(request.params.sessionId));
  const session = row ? findSavedSession(row.projectId, row.id) : undefined;
  if (!session) throw new RequestError(404, 'Session not found.');
  response.json({
    ...withSessionActivity(session),
    usage: usageSummary(session.id),
    ...(session.mode === 'interactive' ? { queue: chatQueue(session.id) } : {}),
  });
}
export function updateSessionDetails(request: Request, response: Response) {
  const row = findSessionById(String(request.params.sessionId));
  const session = row ? findSavedSession(row.projectId, row.id) : undefined;
  if (!session) throw new RequestError(404, 'Session not found.');
  if (request.body?.name !== undefined) {
    if (request.body?.projectId !== undefined)
      throw new RequestError(400, 'Update the name and project separately.');
    const name = textField(request.body.name, 'a session name', 100);
    const updated = renameSession(session.id, name);
    const runtime = getSessionById(session.id);
    if (runtime) runtime.info.name = name;
    response.json(withSessionActivity(updated));
    return;
  }
  if (!['exited', 'interrupted'].includes(session.status))
    throw new RequestError(
      409,
      'End this session before changing its project.',
    );
  if (request.body?.projectId === undefined)
    throw new RequestError(400, 'Choose a project or no project.');
  const projectId =
    request.body.projectId === null
      ? null
      : positiveId(request.body.projectId, 'project');
  if (projectId !== null && !findProject(projectId))
    throw new RequestError(404, 'Project not found.');
  const updated = updateSessionProject(session.id, projectId);
  const runtime = getSessionById(session.id);
  if (runtime) runtime.info.projectId = projectId;
  response.json(withSessionActivity(updated));
}
