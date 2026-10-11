import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readlink,
  lstat,
  rm,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

test('native files migrate, publish safely, load live resources, import read-only and preserve originals', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'native-skills-'));
  process.env.AGENT_MANAGER_DB_PATH = join(dir, 'manager.sqlite');
  process.env.AGENT_MANAGER_SKILL_HOME = join(dir, 'home');
  const old = new DatabaseSync(process.env.AGENT_MANAGER_DB_PATH);
  old.exec(`CREATE TABLE skills(id INTEGER PRIMARY KEY,name TEXT NOT NULL COLLATE NOCASE UNIQUE,instructions TEXT NOT NULL,createdAt TEXT NOT NULL,updatedAt TEXT NOT NULL);
    INSERT INTO skills VALUES(1,'Review','Legacy body','2026-01-01','2026-01-01');`);
  old.close();
  const { database } = await import('../src/lib/database.ts');
  const service = await import('../src/services/skills.ts');
  try {
    const migrated = service.findSkill(1);
    assert.equal(migrated.error, null);
    assert.equal(migrated.nativeName, 'review-1');
    assert.equal(migrated.instructions, 'Legacy body');
    assert.equal(migrated.createdAt, '2026-01-01');
    assert.equal(service.findSkill(1).path, migrated.path);
    assert.equal(
      database.prepare('SELECT instructions FROM skills WHERE id=1').get()
        .instructions,
      'Legacy body',
    );
    const shared = join(dir, 'home/.agents/skills/review-1');
    const agy = join(dir, 'home/.gemini/antigravity-cli/skills/review-1');
    assert.equal(await readlink(shared), migrated.path);
    assert.ok((await lstat(agy)).isDirectory());
    const stableMtime = (await lstat(join(agy, 'SKILL.md'))).mtimeMs;
    service.findSkill(1);
    assert.equal((await lstat(join(agy, 'SKILL.md'))).mtimeMs, stableMtime);
    await mkdir(join(migrated.path, 'scripts'));
    await writeFile(join(migrated.path, 'scripts/check.sh'), 'echo checked\n');
    const updated = service.updateSkill(1, {
      name: 'Review renamed',
      description: 'Use for reviews.',
      instructions: 'Read scripts/check.sh.',
    });
    assert.equal(updated.nativeName, 'review-1');
    assert.equal(
      await readFile(join(agy, 'scripts/check.sh'), 'utf8'),
      'echo checked\n',
    );
    assert.match(
      await readFile(join(shared, 'SKILL.md'), 'utf8'),
      /Use for reviews/,
    );
    assert.equal(
      service.createSkill({
        name: 'Duplicate',
        nativeName: 'review-1',
        instructions: 'x',
      }),
      undefined,
    );
    assert.throws(
      () =>
        service.updateSkill(1, {
          name: 'Review',
          nativeName: 'changed',
          instructions: 'x',
        }),
      /permanent/,
    );
    const conflict = join(dir, 'home/.agents/skills/conflicting');
    await mkdir(conflict);
    await writeFile(join(conflict, 'unrelated'), 'keep');
    const colliding = service.createSkill({
      name: 'Conflicting',
      instructions: 'Workflow',
    });
    assert.match(colliding.publications[0].error, /already exists/);
    service.deleteSkill(colliding.id);
    assert.equal(await readFile(join(conflict, 'unrelated'), 'utf8'), 'keep');
    const imported = join(dir, 'external/deploy-app');
    await mkdir(imported, { recursive: true });
    await writeFile(
      join(imported, 'SKILL.md'),
      '---\nname: deploy-app\ndescription: |\n  Deploy the app.\n  Use for releases.\n---\n\nDeploy safely.\n',
    );
    const external = service.importSkill(imported);
    assert.equal(external.source, 'imported');
    assert.match(external.description, /Use for releases/);
    assert.throws(
      () => service.updateSkill(external.id, { name: 'x', instructions: 'x' }),
      /read-only/,
    );
    await writeFile(
      join(imported, 'SKILL.md'),
      '---\nname: deploy-app\ndescription: Release the app.\n---\nChanged externally.',
    );
    assert.equal(
      service.findSkill(external.id).instructions,
      'Changed externally.',
    );
    assert.equal(
      service.mentionedSkills('$deploy-app release')[0].id,
      external.id,
    );
    service.deleteSkill(external.id);
    assert.match(
      await readFile(join(imported, 'SKILL.md'), 'utf8'),
      /Changed externally/,
    );
    await assert.rejects(lstat(join(dir, 'home/.agents/skills/deploy-app')), {
      code: 'ENOENT',
    });
    await rm(shared);
    await symlink(imported, shared);
    service.deleteSkill(1);
    assert.equal(
      await readlink(shared),
      imported,
      'do not delete a replaced link',
    );
    assert.match(
      await readFile(join(migrated.path, 'SKILL.md'), 'utf8'),
      /Read scripts/,
    );
    await assert.rejects(lstat(agy), { code: 'ENOENT' });
    const missing = service.createSkill({ name: 'Missing', instructions: 'x' });
    await rm(missing.path, { recursive: true });
    assert.ok(service.findSkill(missing.id).error);
    assert.throws(
      () => service.mentionedSkills('$missing run'),
      /Skill missing/,
    );
    const discovered = join(dir, 'home/.agents/skills/found');
    await mkdir(discovered);
    await writeFile(
      join(discovered, 'SKILL.md'),
      '---\nname: found\ndescription: Discover me.\n---\nFound instructions.',
    );
    assert.ok(
      service.discoverSkills().some((skill) => skill.nativeName === 'found'),
    );
    const { codexSkillInput } =
      await import('../src/lib/providers/codex/skills.ts');
    const { openCodeSkillPrompt } =
      await import('../src/lib/providers/opencode/skills.ts');
    const { antigravitySkillPrompt } =
      await import('../src/lib/providers/antigravity/skills.ts');
    const selection = [{ nativeName: 'found', path: discovered }];
    assert.deepEqual(codexSkillInput('$found inspect', selection)[1], {
      type: 'skill',
      name: 'found',
      path: join(discovered, 'SKILL.md'),
    });
    assert.equal(
      openCodeSkillPrompt('$found inspect', selection),
      '@found inspect',
    );
    assert.equal(
      antigravitySkillPrompt('$found inspect', selection),
      '/found inspect',
    );
  } finally {
    database.close();
    await rm(dir, { recursive: true, force: true });
  }
});
