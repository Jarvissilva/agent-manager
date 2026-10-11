import type { Request, Response } from 'express';
import { listSkills } from '../../services/skills.js';

export default function getSkills(_request: Request, response: Response) {
  response.json(listSkills());
}
