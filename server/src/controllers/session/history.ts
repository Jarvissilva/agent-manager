import type { Request, Response } from 'express';
import {
  listSessions,
  legacySession,
  scheduleSessions,
} from '../../repositories/sessions.js';
import { positiveId, RequestError } from '../../lib/http/errors.js';
import { cancelScheduledSession } from '../../services/scheduledSessions.js';
import { withSessionActivity } from '../../services/sessions.js';
export function getScheduleSessions(request: Request, response: Response) {
  response.json(
    scheduleSessions(positiveId(request.params.scheduleId, 'schedule')).map(
      withSessionActivity,
    ),
  );
}
export function getLegacySession(request: Request, response: Response) {
  const session = legacySession(String(request.params.runId));
  if (!session) throw new RequestError(404, 'Session not found.');
  response.json(withSessionActivity(session));
}
export function cancelSession(request: Request, response: Response) {
  response.json(
    withSessionActivity(
      cancelScheduledSession(String(request.params.sessionId)),
    ),
  );
}

export function getSessions(request: Request, response: Response) {
  response.json(
    listSessions(
      request.query.projectId === undefined
        ? undefined
        : positiveId(request.query.projectId, 'project'),
    ).map(withSessionActivity),
  );
}
