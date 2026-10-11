import type { Request, Response } from 'express';
import { deleteSkill as removeSkill } from '../../services/skills.js';
import { skillId, allowSkillWrite } from './validation.js';

export default function deleteSkill(request: Request, response: Response) {
  if (!allowSkillWrite(request, response)) return;
  const id = skillId(request, response);
  if (!id) return;
  if (!removeSkill(id)) {
    response.status(404).json({ error: 'Skill not found.' });
    return;
  }
  response.status(204).end();
}
