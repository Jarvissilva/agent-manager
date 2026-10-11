import { join } from 'node:path';
export function codexSkillInput(
  prompt: string,
  skills: { nativeName: string; path: string }[],
) {
  return [
    { type: 'text', text: prompt, text_elements: [] },
    ...skills.map((skill) => ({
      type: 'skill',
      name: skill.nativeName,
      path: join(skill.path, 'SKILL.md'),
    })),
  ];
}
