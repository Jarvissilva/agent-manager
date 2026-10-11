import type { Request, Response } from 'express';
import { createAgent as insertAgent } from '../../services/agents.js';
import { allowAgentWrite, validateAgent } from './validation.js';

export default function createAgent(request: Request, response: Response) {
  if (!allowAgentWrite(request, response)) return;
  const input = validateAgent(request.body);
  if ('error' in input) {
    response.status(400).json(input);
    return;
  }
  const agent = insertAgent(input.value);
  if (!agent) {
    response
      .status(409)
      .json({ error: 'An agent with this name already exists.' });
    return;
  }
  response.status(201).json(agent);
}
