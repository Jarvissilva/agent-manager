import type { Request, Response } from 'express';
import { createSkill as insertSkill } from '../../services/skills.js';
import { allowSkillWrite, validateSkill } from './validation.js';

export default function createSkill(request: Request, response: Response) {
  if (!allowSkillWrite(request, response)) return;
  const input = validateSkill(request.body);
  if ('error' in input) {
    response.status(400).json(input);
    return;
  }
  const skill = insertSkill(input.value);
  if (!skill) {
    response
      .status(409)
      .json({ error: 'A skill with this name already exists.' });
    return;
  }
  response.status(201).json(skill);
}
