import type { Request, Response } from 'express';
import { listProviders } from '../../lib/providers/providers.js';

export default async function getProviders(
  _request: Request,
  response: Response,
) {
  response.json(await listProviders());
}
