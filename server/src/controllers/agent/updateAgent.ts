import type { Request, Response } from 'express';
import { findAgent, updateAgent as saveAgent } from '../../services/agents.js';
import { agentId, allowAgentWrite, validateAgent } from './validation.js';

export default function updateAgent(request: Request, response: Response) {
  if (!allowAgentWrite(request, response)) return;
  const id = agentId(request, response);
  if (!id) return;
  if (!findAgent(id)) {
    response.status(404).json({ error: 'Agent not found.' });
    return;
  }
  const input = validateAgent(request.body);
  if ('error' in input) {
    response.status(400).json(input);
    return;
  }
  const agent = saveAgent(id, input.value);
  if (!agent) {
    response
      .status(409)
      .json({ error: 'An agent with this name already exists.' });
    return;
  }
  response.json(agent);
}
