import { array, record, text, type OpenCodeServer } from './server.js';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
export function openCodeSkillPrompt(
  prompt: string,
  skills: { nativeName: string }[],
) {
  for (const skill of skills)
    prompt = prompt.replace(
      new RegExp(`(^|\\s)\\$${skill.nativeName}(?=\\s|[.,:;!?]|$)`, 'g'),
      `$1@${skill.nativeName}`,
    );
  return prompt;
}

// Reload completes before the asynchronous source plugins necessarily publish
// their catalogs. Wait for current files before allowing the next prompt.
export async function waitForNativeSkills(
  server: OpenCodeServer,
  cwd: string,
  expected: { nativeName: string; path: string; instructions: string }[],
  previous: { nativeName: string; path: string }[],
) {
  const names = new Set(expected.map((skill) => skill.nativeName));
  const removed = previous.filter((skill) => !names.has(skill.nativeName));
  const deadline = Date.now() + 10000;
  do {
    const result = await server.request(
      '/api/skill?' + new URLSearchParams({ 'location[directory]': cwd }),
    );
    const catalog = array(result.data).map(record);
    const ready =
      expected.every((skill) => {
        const native = catalog.find(
          (item) => (item.id ?? item.name) === skill.nativeName,
        );
        if (!native) return false;
        // Project-local overrides retain OpenCode's native precedence.
        try {
          if (
            realpathSync(text(native.path ?? native.location)) !==
            realpathSync(join(skill.path, 'SKILL.md'))
          )
            return true;
        } catch {
          return false;
        }
        return text(native.content).trim() === skill.instructions.trim();
      }) &&
      removed.every((skill) => {
        const native = catalog.find(
          (item) => (item.id ?? item.name) === skill.nativeName,
        );
        if (!native) return true;
        try {
          return (
            realpathSync(text(native.path ?? native.location)) !==
            realpathSync(join(skill.path, 'SKILL.md'))
          );
        } catch {
          return false;
        }
      });
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw Error(
    'OpenCode has not refreshed its native skills yet. Try this message again.',
  );
}
