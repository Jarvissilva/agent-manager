import type { Request, Response } from 'express';
import { findSkill } from '../../services/skills.js';
import { skillId } from './validation.js';

export default function getSkill(request: Request, response: Response) {
  const id = skillId(request, response);
  if (!id) return;
  const skill = findSkill(id);
  if (!skill) {
    response.status(404).json({ error: 'Skill not found.' });
    return;
  }
  response.json(skill);
}
