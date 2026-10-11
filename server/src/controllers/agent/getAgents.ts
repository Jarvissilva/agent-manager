import type { Request, Response } from 'express';
import { listAgents } from '../../services/agents.js';

export default function getAgents(_request: Request, response: Response) {
  response.json(listAgents());
}
