import type { Request, Response } from 'express';
import { database } from '../../lib/database.js';
import { isAllowedOrigin } from '../../lib/security/requestOrigin.js';
import {
  getSession,
  stopSession,
  withSessionActivity,
} from '../../services/sessions.js';
import {
  listSessions,
  queuedSessionCount,
} from '../../repositories/sessions.js';

const findProject = database.prepare('SELECT id FROM projects WHERE id = ?');

function getProject(request: Request, response: Response) {
  if (request.headers.origin && !isAllowedOrigin(request)) {
    response.status(403).json({
      error: 'This request must come from a trusted dashboard origin.',
    });
    return;
  }

  const id = Number(request.params.projectId);
  if (!Number.isSafeInteger(id) || id <= 0) {
    response.status(400).json({ error: 'Invalid project.' });
    return;
  }

  const project = findProject.get(id);
  if (!project) {
    response.status(404).json({ error: 'Project not found.' });
    return;
  }

  return { id };
}

export function getProjectSession(request: Request, response: Response) {
  const project = getProject(request, response);
  if (!project) return;
  const runtime = getSession(project.id);
  response.json({
    session: runtime ? withSessionActivity(runtime.info) : null,
    sessions: listSessions(project.id).map(withSessionActivity),
    queuedSessionCount: queuedSessionCount(project.id),
  });
}

export function stopProjectSession(request: Request, response: Response) {
  const project = getProject(request, response);
  if (!project) return;
  const session = getSession(project.id);
  if (session) stopSession(session);
  response.json({
    session: session ? withSessionActivity(session.info) : null,
  });
}
