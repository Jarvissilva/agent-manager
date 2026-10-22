import type { Request, Response } from 'express';
import { isAllowedOrigin } from '../../lib/security/requestOrigin.js';
import type { AgentInput } from '../../repositories/agents.js';
import { findSkill } from '../../services/skills.js';

export function allowAgentWrite(request: Request, response: Response) {
  if (request.headers.origin && !isAllowedOrigin(request)) {
    response.status(403).json({
      error: 'This request must come from a trusted dashboard origin.',
    });
    return false;
  }
  return true;
}

export function agentId(request: Request, response: Response) {
  const id = Number(request.params.agentId);
  if (!Number.isSafeInteger(id) || id <= 0) {
    response.status(400).json({ error: 'Invalid agent.' });
    return;
  }
  return id;
}

export function validateAgent(
  body: unknown,
): { value: AgentInput } | { error: string } {
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
        'Enter an agent name of 1–100 characters without control characters.',
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
  const skillIds = 'skillIds' in body ? body.skillIds : [];
  if (
    !Array.isArray(skillIds) ||
    skillIds.length > 50 ||
    !skillIds.every(
      (id): id is number =>
        typeof id === 'number' && Number.isSafeInteger(id) && id > 0,
    ) ||
    new Set(skillIds).size !== skillIds.length
  ) {
    return { error: 'Choose up to 50 unique skills.' };
  }
  if (skillIds.some((id) => !findSkill(id))) {
    return {
      error:
        'One of the selected skills no longer exists. Refresh and try again.',
    };
  }
  return {
    value: {
      name: body.name.trim(),
      instructions: body.instructions.trim(),
      skillIds,
    },
  };
}
