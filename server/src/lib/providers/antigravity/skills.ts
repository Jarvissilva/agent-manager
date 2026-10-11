export function antigravitySkillPrompt(
  prompt: string,
  skills: { nativeName: string }[],
) {
  for (const skill of skills)
    prompt = prompt.replace(
      new RegExp(`(^|\\s)\\$${skill.nativeName}(?=\\s|[.,:;!?]|$)`, 'g'),
      `$1/${skill.nativeName}`,
    );
  return prompt;
}
