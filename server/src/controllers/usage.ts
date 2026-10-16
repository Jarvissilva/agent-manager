import type { Request, Response } from 'express';
import { usageReport } from '../services/usage.js';
export function getUsage(request: Request, response: Response) {
  response.json(usageReport(request.query));
}
