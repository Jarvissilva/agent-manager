import type { Request, Response } from 'express';
import { deleteSession as removeSession } from '../../services/sessions.js';

export default function deleteSession(request: Request, response: Response) {
  removeSession(String(request.params.sessionId));
  response.sendStatus(204);
}
