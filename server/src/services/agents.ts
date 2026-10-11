import * as repository from '../repositories/agents.js';
import { findSkill } from './skills.js';
import type { Skill } from './skills.js';
export type { AgentInput } from '../repositories/agents.js';
export type Agent = Omit<repository.Agent, 'skills'> & { skills: Skill[] };
function configuration(agent: repository.Agent): Agent {
  return {
    ...agent,
    skills: agent.skills
      .map((skill) => findSkill(skill.id))
      .filter((skill): skill is Skill => Boolean(skill)),
  };
}
export function findAgent(id: number) {
  const agent = repository.findAgent(id);
  return agent ? configuration(agent) : undefined;
}
export function listAgents() {
  return repository.listAgents().map(configuration);
}
export function createAgent(input: repository.AgentInput) {
  const agent = repository.createAgent(input);
  return agent ? configuration(agent) : undefined;
}
export function updateAgent(id: number, input: repository.AgentInput) {
  const agent = repository.updateAgent(id, input);
  return agent ? configuration(agent) : undefined;
}
export const deleteAgent = repository.deleteAgent;
