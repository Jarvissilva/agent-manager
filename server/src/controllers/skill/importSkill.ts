import type { Request, Response } from 'express';
import { discoverSkills, importSkill } from '../../services/skills.js';
import { allowSkillWrite } from './validation.js';
import { RequestError } from '../../lib/http/errors.js';
export function getDiscoveredSkills(_request: Request, response: Response) {
  response.json(discoverSkills());
}
export function postImportedSkill(request: Request, response: Response) {
  if (!allowSkillWrite(request, response)) return;
  const path: unknown = request.body?.path;
  if (typeof path !== 'string' || !path.trim() || path.includes('\0'))
    throw new RequestError(400, 'Choose a local skill folder.');
  response.status(201).json(importSkill(path));
}
