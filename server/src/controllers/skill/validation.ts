import type { Request, Response } from 'express';
import { isAllowedOrigin } from '../../lib/security/requestOrigin.js';
import type { SkillInput } from '../../repositories/skills.js';

export function allowSkillWrite(request: Request, response: Response) {
  if (request.headers.origin && !isAllowedOrigin(request)) {
    response.status(403).json({
      error: 'This request must come from a trusted dashboard origin.',
    });
    return false;
  }
  return true;
}

export function skillId(request: Request, response: Response) {
  const id = Number(request.params.skillId);
  if (!Number.isSafeInteger(id) || id <= 0) {
    response.status(400).json({ error: 'Invalid skill.' });
    return;
  }
  return id;
}

export function validateSkill(
  body: unknown,
): { value: SkillInput } | { error: string } {
  if (
    typeof body !== 'object' ||
    body === null ||
    !('name' in body) ||
    typeof body.name !== 'string' ||
    !body.name.trim() ||
    body.name.trim().length > 100 ||
    Array.from(body.name).some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  ) {
    return {
      error:
        'Enter a skill name of 1–100 characters without control characters.',
    };
  }
  if (
    !('instructions' in body) ||
    typeof body.instructions !== 'string' ||
    !body.instructions.trim() ||
    body.instructions.length > 20000 ||
    body.instructions.includes('\0')
  ) {
    return { error: 'Enter instructions of 1–20,000 characters.' };
  }
  for (const field of ['nativeName', 'description'] as const) {
    const value = (body as Record<string, unknown>)[field];
    if (
      field in body &&
      (typeof value !== 'string' ||
        !(value as string).trim() ||
        (field === 'nativeName'
          ? !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value as string) ||
            (value as string).length > 64
          : (value as string).length > 1024))
    )
      return {
        error:
          field === 'nativeName'
            ? 'Use a lowercase hyphenated native name (1–64 characters).'
            : 'Enter a description of 1–1,024 characters.',
      };
  }
  return {
    value: {
      name: body.name.trim(),
      ...('nativeName' in body
        ? { nativeName: body.nativeName as string }
        : {}),
      ...('description' in body
        ? { description: (body.description as string).trim() }
        : {}),
      instructions: body.instructions.trim(),
    },
  };
}
