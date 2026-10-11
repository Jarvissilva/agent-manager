import {
  lstatSync,
  statSync,
  rmSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parse } from 'yaml';
import { RequestError } from '../http/errors.js';

export const nativeNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export function validNativeName(name: string) {
  return name.length <= 64 && nativeNamePattern.test(name);
}
export function slug(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 55)
      .replace(/-$/, '') || 'skill'
  );
}
export function readSkill(folder: string) {
  const path = realpathSync(folder);
  const file = join(path, 'SKILL.md');
  if (statSync(file).size > 1024 * 1024) throw Error('SKILL.md is too large.');
  const content = readFileSync(file, 'utf8');
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(
    content,
  );
  if (!match)
    throw Error('SKILL.md needs YAML frontmatter with name and description.');
  const metadata: unknown = parse(match[1], { maxAliasCount: 0 });
  if (
    !metadata ||
    typeof metadata !== 'object' ||
    !('name' in metadata) ||
    !('description' in metadata) ||
    typeof metadata.name !== 'string' ||
    !validNativeName(metadata.name) ||
    typeof metadata.description !== 'string' ||
    !metadata.description.trim() ||
    metadata.description.length > 1024 ||
    !match[2].trim()
  )
    throw Error(
      'Use a lowercase hyphenated name, a description (1–1,024 characters), and instructions.',
    );
  return {
    path,
    nativeName: metadata.name,
    description: metadata.description.trim(),
    instructions: match[2].trim(),
  };
}
export function writeSkill(
  folder: string,
  skill: { nativeName: string; description: string; instructions: string },
  create = false,
) {
  mkdirSync(dirname(folder), { recursive: true });
  if (create)
    mkdirSync(folder); // Refuse existing unrelated directories, including symlinks.
  else if (!lstatSync(folder).isDirectory())
    throw new RequestError(
      409,
      'The skill folder was replaced. Restore it before editing.',
    );
  const file = join(folder, 'SKILL.md');
  const temporary = join(folder, `.SKILL-${randomUUID()}.tmp`);
  try {
    writeFileSync(
      temporary,
      `---\nname: ${JSON.stringify(skill.nativeName)}\ndescription: ${JSON.stringify(skill.description)}\n---\n\n${skill.instructions}\n`,
      { flag: 'wx' },
    );
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}
