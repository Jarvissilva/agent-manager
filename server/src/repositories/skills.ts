import { database } from '../lib/database.js';

export type SkillInput = {
  name: string;
  instructions: string;
  nativeName?: string;
  description?: string;
};
export type SkillRecord = Omit<SkillInput, 'nativeName' | 'description'> & {
  id: number;
  nativeName: string | null;
  description: string | null;
  source: 'managed' | 'imported';
  path: string | null;
  createdAt: string;
  updatedAt: string;
};
export type Skill = Omit<SkillRecord, 'nativeName' | 'description' | 'path'> & {
  nativeName: string;
  description: string;
  path: string;
  error: string | null;
  publications: {
    provider: string;
    path: string;
    status: string;
    error: string | null;
  }[];
};

export function listSkills() {
  return database
    .prepare('SELECT * FROM skills ORDER BY name COLLATE NOCASE, id')
    .all() as unknown as SkillRecord[];
}
export function findSkill(id: number) {
  return database.prepare('SELECT * FROM skills WHERE id = ?').get(id) as
    SkillRecord | undefined;
}
export function saveSkill(input: {
  id?: number;
  name: string;
  instructions: string;
  nativeName: string;
  description: string;
  source: SkillRecord['source'];
  path: string;
}) {
  const now = new Date().toISOString();
  if (input.id) {
    database
      .prepare(
        `UPDATE skills SET name=?,instructions=?,nativeName=?,description=?,source=?,path=?,updatedAt=? WHERE id=?`,
      )
      .run(
        input.name,
        input.instructions,
        input.nativeName,
        input.description,
        input.source,
        input.path,
        now,
        input.id,
      );
    return findSkill(input.id)!;
  }
  const result = database
    .prepare(
      `INSERT INTO skills(name,instructions,nativeName,description,source,path,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?)`,
    )
    .run(
      input.name,
      input.instructions,
      input.nativeName,
      input.description,
      input.source,
      input.path,
      now,
      now,
    );
  return findSkill(Number(result.lastInsertRowid))!;
}
export function deleteSkill(id: number) {
  return database.prepare('DELETE FROM skills WHERE id=?').run(id).changes > 0;
}
export type Publication = {
  skillId: number;
  path: string;
  target: string;
  mode: 'link' | 'copy';
  owner: string;
};
export function publications(id: number) {
  return database
    .prepare('SELECT * FROM skill_publications WHERE skillId=?')
    .all(id) as unknown as Publication[];
}
export function savePublication(value: Publication) {
  database
    .prepare(
      'INSERT OR REPLACE INTO skill_publications(skillId,path,target,mode,owner) VALUES (?,?,?,?,?)',
    )
    .run(value.skillId, value.path, value.target, value.mode, value.owner);
}
export function forgetPublication(path: string) {
  database.prepare('DELETE FROM skill_publications WHERE path=?').run(path);
}
