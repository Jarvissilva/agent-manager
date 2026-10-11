import type { Request, Response } from 'express';
import { findSkill, updateSkill as saveSkill } from '../../services/skills.js';
import { skillId, allowSkillWrite, validateSkill } from './validation.js';

export default function updateSkill(request: Request, response: Response) {
  if (!allowSkillWrite(request, response)) return;
  const id = skillId(request, response);
  if (!id) return;
  if (!findSkill(id)) {
    response.status(404).json({ error: 'Skill not found.' });
    return;
  }
  const input = validateSkill(request.body);
  if ('error' in input) {
    response.status(400).json(input);
    return;
  }
  const skill = saveSkill(id, input.value);
  if (!skill) {
    response
      .status(409)
      .json({ error: 'A skill with this name already exists.' });
    return;
  }
  response.json(skill);
}
