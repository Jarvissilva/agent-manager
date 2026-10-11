import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { existsSync, lstatSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { databasePath } from '../lib/database.js';
import * as repository from '../repositories/skills.js';
import {
  readSkill,
  slug,
  validNativeName,
  writeSkill,
} from '../lib/skills/files.js';
import {
  cleanupPublications,
  publishSkill,
  skillDestinations,
} from '../lib/skills/publication.js';
import { RequestError } from '../lib/http/errors.js';

const root = resolve(dirname(databasePath), 'skills');
export type { Skill } from '../repositories/skills.js';
function conflict(name: string, nativeName: string, except?: number) {
  return repository
    .listSkills()
    .some(
      (skill) =>
        skill.id !== except &&
        (skill.name.toLowerCase() === name.toLowerCase() ||
          skill.nativeName === nativeName),
    );
}
function hydrate(row: repository.SkillRecord): repository.Skill {
  const legacyName = `${slug(row.name).slice(0, 40)}-${row.id}`;
  let path = row.path ?? join(root, row.nativeName ?? legacyName);
  let nativeName = row.nativeName ?? basename(path);
  let description =
    row.description ??
    `Use the ${row.name} procedure when relevant to the task.`;
  let instructions = row.instructions;
  try {
    if (!row.path) {
      let suffix = 2;
      while (
        repository
          .listSkills()
          .some(
            (other) => other.id !== row.id && other.nativeName === nativeName,
          )
      )
        nativeName = `${legacyName}-${suffix++}`;
      path = join(root, nativeName);
      writeSkill(path, { nativeName, description, instructions }, true);
      row = repository.saveSkill({ ...row, nativeName, description, path });
    }
    const file = readSkill(path);
    if (file.nativeName !== nativeName)
      throw Error(
        'The name in SKILL.md changed. Restore the registered native name.',
      );
    description = file.description;
    instructions = file.instructions;
    return {
      ...row,
      nativeName,
      description,
      instructions,
      path,
      error: null,
      publications: publishSkill({ id: row.id, nativeName, path }),
    };
  } catch (error) {
    return {
      ...row,
      nativeName,
      description,
      instructions,
      path,
      error:
        error instanceof Error ? error.message : 'Skill folder unavailable.',
      publications: [],
    };
  }
}
export function listSkills() {
  return repository.listSkills().map(hydrate);
}
export function findSkill(id: number) {
  const row = repository.findSkill(id);
  return row ? hydrate(row) : undefined;
}
export function initializeSkills() {
  listSkills();
}
export function createSkill(input: repository.SkillInput) {
  const nativeName = input.nativeName ?? slug(input.name);
  const description =
    input.description ??
    `Use the ${input.name} procedure when relevant to the task.`;
  if (conflict(input.name, nativeName)) return undefined;
  const path = join(root, nativeName);
  if (existsSync(path))
    throw new RequestError(
      409,
      'This skill folder already exists. Import it instead.',
    );
  try {
    writeSkill(path, { ...input, nativeName, description }, true);
  } catch {
    throw new RequestError(
      409,
      'Could not create the skill folder; existing files were left untouched.',
    );
  }
  try {
    const row = repository.saveSkill({
      ...input,
      nativeName,
      description,
      source: 'managed',
      path,
    });
    return hydrate(row);
  } catch (error) {
    rmSync(path, { recursive: true });
    throw error;
  }
}
export function importSkill(folder: string) {
  let file: ReturnType<typeof readSkill>;
  try {
    file = readSkill(
      resolve(
        folder.startsWith('~/') ? join(homedir(), folder.slice(2)) : folder,
      ),
    );
  } catch (error) {
    throw new RequestError(
      400,
      error instanceof Error ? error.message : 'Could not read SKILL.md.',
    );
  }
  // Portable native discovery IDs must match the folder name in all providers.
  if (basename(file.path) !== file.nativeName)
    throw new RequestError(
      400,
      'The skill folder must match the name in SKILL.md.',
    );
  const name = file.nativeName;
  if (conflict(name, file.nativeName))
    throw new RequestError(409, 'This skill name is already registered.');
  return hydrate(repository.saveSkill({ ...file, name, source: 'imported' }));
}
export function updateSkill(id: number, input: repository.SkillInput) {
  const row = repository.findSkill(id);
  if (!row) return undefined;
  const skill = hydrate(row);
  if (skill.source === 'imported')
    throw new RequestError(
      409,
      'Imported skills are read-only. Edit their original files.',
    );
  if (skill.error) throw new RequestError(409, skill.error);
  if (input.nativeName && input.nativeName !== skill.nativeName)
    throw new RequestError(400, 'The native skill name is permanent.');
  if (conflict(input.name, skill.nativeName, id)) return undefined;
  const value = {
    ...input,
    nativeName: skill.nativeName,
    description: input.description ?? skill.description,
  };
  writeSkill(skill.path, value);
  return hydrate(repository.saveSkill({ ...row, ...value, path: skill.path }));
}
export function deleteSkill(id: number) {
  const row = repository.findSkill(id);
  if (!row) return false;
  cleanupPublications(id);
  // Keep the original, including scripts and manual edits. Deletion unregisters a skill.
  return repository.deleteSkill(id);
}
export function skillInstructions(
  instructions: string,
  skills: Pick<repository.Skill, 'nativeName' | 'description'>[],
) {
  return [
    instructions,
    skills.length
      ? 'Relevant native skills (load only when needed):\n' +
        skills
          .map((skill) => `- ${skill.nativeName}: ${skill.description}`)
          .join('\n')
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}
export function skillCatalogRevision() {
  return createHash('sha256')
    .update(
      JSON.stringify(
        listSkills().map(
          ({ nativeName, description, instructions, path, error }) => ({
            nativeName,
            description,
            instructions,
            path,
            error,
          }),
        ),
      ),
    )
    .digest('hex');
}
export function mentionedSkills(prompt: string) {
  const names = new Set(
    [
      ...prompt.matchAll(
        /(?:^|\s)[$@/]([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|[.,:;!?]|$)/g,
      ),
    ].map((match) => match[1]),
  );
  return listSkills()
    .filter((skill) => names.has(skill.nativeName))
    .map((skill) => {
      if (skill.error)
        throw new RequestError(
          409,
          `Skill ${skill.nativeName}: ${skill.error}`,
        );
      return skill;
    });
}
// Offer existing native folders without registering or moving them.
export function discoverSkills() {
  const homes = skillDestinations('unused').map((value) => dirname(value.path));
  const home = process.env.AGENT_MANAGER_SKILL_HOME ?? homedir();
  homes.push(
    join(home, '.config/opencode/skills'),
    join(home, '.claude/skills'),
    join(home, '.codex/skills'),
  );
  const result: { path: string; nativeName: string; description: string }[] =
    [];
  const registeredSkills = repository.listSkills();
  const registered = new Set(registeredSkills.map((skill) => skill.path));
  const registeredNames = new Set(
    registeredSkills.map((skill) => skill.nativeName),
  );
  for (const home of homes) {
    if (!existsSync(home)) continue;
    for (const name of readdirSync(home)) {
      if (!validNativeName(name)) continue;
      try {
        const folder = join(home, name);
        if (
          !lstatSync(folder).isDirectory() &&
          !lstatSync(folder).isSymbolicLink()
        )
          continue;
        const file = readSkill(folder);
        if (
          !registered.has(file.path) &&
          !registeredNames.has(file.nativeName) &&
          !result.some((skill) => skill.path === file.path)
        )
          result.push({
            path: file.path,
            nativeName: file.nativeName,
            description: file.description,
          });
      } catch {
        /* Ignore non-skill folders and malformed manifests. */
      }
    }
  }
  return result;
}
