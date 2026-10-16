import { database } from '../lib/database.js';
import type { SkillRecord } from './skills.js';

export type AgentInput = {
  name: string;
  provider: 'codex' | 'antigravity' | 'opencode';
  instructions: string;
  skillIds?: number[];
};
export type Agent = AgentInput & {
  skills: SkillRecord[];
  id: number;
  createdAt: string;
  updatedAt: string;
};

export function listAgents() {
  return database
    .prepare('SELECT * FROM agents ORDER BY name COLLATE NOCASE, id')
    .all()
    .map((row) => withConfiguration(row as unknown as Agent));
}

export function findAgent(id: number) {
  const row = database.prepare('SELECT * FROM agents WHERE id = ?').get(id);
  return row ? withConfiguration(row as unknown as Agent) : undefined;
}

function withConfiguration(agent: Agent): Agent {
  const skills = database
    .prepare(
      `SELECT skills.* FROM skills
    JOIN agent_skills ON skills.id = agent_skills.skillId
    WHERE agent_skills.agentId = ? ORDER BY skills.name COLLATE NOCASE, skills.id`,
    )
    .all(agent.id) as unknown as SkillRecord[];
  return {
    ...agent,
    skills,
    skillIds: skills.map((skill) => skill.id),
  };
}

function saveSkills(id: number, skillIds: number[]) {
  database.prepare('DELETE FROM agent_skills WHERE agentId = ?').run(id);
  const insert = database.prepare(
    'INSERT INTO agent_skills (agentId,skillId) VALUES (?,?)',
  );
  for (const skillId of skillIds) insert.run(id, skillId);
}

export function createAgent(input: AgentInput) {
  database.exec('BEGIN');
  try {
    const now = new Date().toISOString();
    const result = database
      .prepare(
        `INSERT INTO agents (id,name,provider,instructions,createdAt,updatedAt)
         VALUES ((SELECT COALESCE(MAX(id),0)+1 FROM (SELECT id FROM agents UNION ALL SELECT agentId AS id FROM usage_turns WHERE agentId IS NOT NULL)),?,?,?,?,?)
         ON CONFLICT(name) DO NOTHING`,
      )
      .run(input.name, input.provider, input.instructions, now, now);
    const id = Number(result.lastInsertRowid);
    if (result.changes) {
      saveSkills(id, input.skillIds ?? []);
    }
    database.exec('COMMIT');
    return result.changes ? findAgent(id) : undefined;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

export function updateAgent(id: number, input: AgentInput) {
  database.exec('BEGIN');
  try {
    const result = database
      .prepare(
        `UPDATE agents SET name = ?, provider = ?, instructions = ?, updatedAt = ?
    WHERE id = ? AND NOT EXISTS (SELECT 1 FROM agents WHERE name = ? COLLATE NOCASE AND id != ?)`,
      )
      .run(
        input.name,
        input.provider,
        input.instructions,
        new Date().toISOString(),
        id,
        input.name,
        id,
      );
    if (result.changes) {
      saveSkills(id, input.skillIds ?? []);
    }
    database.exec('COMMIT');
    return result.changes ? findAgent(id) : undefined;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

export function deleteAgent(id: number) {
  return (
    database.prepare('DELETE FROM agents WHERE id = ?').run(id).changes > 0
  );
}
