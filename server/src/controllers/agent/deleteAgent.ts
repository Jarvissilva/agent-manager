import type { Request, Response } from 'express';
import { deleteAgent as removeAgent } from '../../services/agents.js';
import { agentId, allowAgentWrite } from './validation.js';
import { detachAgent } from '../../services/sessions.js';
import { agentHasSchedules } from '../../repositories/schedules.js';

export default function deleteAgent(request: Request, response: Response) {
  if (!allowAgentWrite(request, response)) return;
  const id = agentId(request, response);
  if (!id) return;
  if (agentHasSchedules(id)) {
    response.status(409).json({
      error:
        'This agent is used by a schedule. Reassign or delete its schedules first.',
    });
    return;
  }
  if (!removeAgent(id)) {
    response.status(404).json({ error: 'Agent not found.' });
    return;
  }
  detachAgent(id);
  response.status(204).end();
}
