import type { Request, Response, NextFunction } from 'express';
import { getSettings } from '../repositories/settings.js';
import { updateSettings } from '../services/settings.js';
export function getAppSettings(_request: Request, response: Response) {
  response.json(getSettings());
}
export async function patchAppSettings(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  try {
    response.json(await updateSettings(request.body));
  } catch (error) {
    next(error);
  }
}
