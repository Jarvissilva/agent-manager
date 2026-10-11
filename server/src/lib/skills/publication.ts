import {
  cpSync,
  lstatSync,
  realpathSync,
  readdirSync,
  statSync,
  renameSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import {
  publications,
  savePublication,
  forgetPublication,
  type Publication,
  type Skill,
} from '../../repositories/skills.js';

const marker = '.agent-manager-owner';
function fingerprint(folder: string, parents = new Set<string>()): string {
  folder = realpathSync(folder);
  const hash = createHash('sha256');
  if (parents.has(folder))
    throw Error('Circular supporting-file links cannot be synchronized.');
  const next = new Set(parents).add(folder);
  for (const entry of readdirSync(folder).sort()) {
    if (entry === marker || entry === '.agent-manager-signature') continue;
    const path = join(folder, entry);
    const stat = statSync(path);
    hash.update(entry);
    if (stat.isDirectory()) hash.update(fingerprint(path, next));
    else if (stat.isFile()) hash.update(readFileSync(path));
    else throw Error('Skill resources must be regular files or directories.');
  }
  return hash.digest('hex');
}
export function skillDestinations(name: string) {
  const home = process.env.AGENT_MANAGER_SKILL_HOME ?? homedir();
  return [
    {
      provider: 'Codex / OpenCode',
      path: join(home, '.agents/skills', name),
      mode: 'link' as const,
    },
    {
      provider: 'Antigravity',
      path: join(home, '.gemini/antigravity-cli/skills', name),
      mode:
        process.env.AGENT_MANAGER_AGY_SKILL_LINKS === '1'
          ? ('link' as const)
          : ('copy' as const),
    },
  ];
}
function exists(path: string) {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}
export function ownsPublication(value: Publication) {
  try {
    const stat = lstatSync(value.path);
    if (value.mode === 'link')
      return (
        stat.isSymbolicLink() &&
        resolve(dirname(value.path), readlinkSync(value.path)) === value.target
      );
    return (
      stat.isDirectory() &&
      readFileSync(join(value.path, marker), 'utf8') === value.owner
    );
  } catch {
    return false;
  }
}
export function cleanupPublications(id: number) {
  for (const value of publications(id)) {
    if (ownsPublication(value))
      rmSync(value.path, { recursive: value.mode === 'copy' });
    forgetPublication(value.path);
  }
}
export function publishSkill(
  skill: Pick<Skill, 'id' | 'nativeName' | 'path'>,
): Skill['publications'] {
  return skillDestinations(skill.nativeName).map((destination) => {
    try {
      const saved = publications(skill.id).find(
        (value) => value.path === destination.path,
      );
      const stat = exists(destination.path);
      // A pre-existing discovery folder or link to the same original needs no ownership claim.
      if (
        resolve(destination.path) === skill.path ||
        (stat?.isSymbolicLink() &&
          resolve(dirname(destination.path), readlinkSync(destination.path)) ===
            skill.path)
      )
        return { ...destination, status: 'linked', error: null };
      if (stat && (!saved || !ownsPublication(saved)))
        throw Error(
          'This name already exists; the existing folder was left untouched.',
        );
      mkdirSync(dirname(destination.path), { recursive: true });
      const value: Publication = saved ?? {
        skillId: skill.id,
        path: destination.path,
        target: skill.path,
        mode: destination.mode,
        owner: randomUUID(),
      };
      savePublication(value);
      if (value.mode === 'copy') {
        const signature = fingerprint(skill.path);
        const signatureFile = join(value.path, '.agent-manager-signature');
        if (
          stat &&
          exists(signatureFile) &&
          readFileSync(signatureFile, 'utf8') === signature
        )
          return { ...destination, status: 'synchronized', error: null };
        const staging = value.path + '.' + randomUUID() + '.tmp';
        try {
          cpSync(skill.path, staging, { recursive: true, dereference: true });
          writeFileSync(join(staging, marker), value.owner);
          writeFileSync(join(staging, '.agent-manager-signature'), signature);
          if (stat) rmSync(value.path, { recursive: true });
          renameSync(staging, value.path);
        } finally {
          rmSync(staging, { recursive: true, force: true });
        }
      } else if (!stat) symlinkSync(skill.path, value.path, 'dir');
      return {
        ...destination,
        status: value.mode === 'copy' ? 'synchronized' : 'linked',
        error: null,
      };
    } catch (error) {
      return {
        ...destination,
        status: 'error',
        error:
          error instanceof Error ? error.message : 'Could not publish skill.',
      };
    }
  });
}
