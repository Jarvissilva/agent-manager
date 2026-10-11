import type { Request, Response } from 'express';
import { findAgent } from '../../services/agents.js';
import { agentId } from './validation.js';

export default function getAgent(request: Request, response: Response) {
  const id = agentId(request, response);
  if (!id) return;
  const agent = findAgent(id);
  if (!agent) {
    response.status(404).json({ error: 'Agent not found.' });
    return;
  }
  response.json(agent);
}
