import type { Skill } from './skill';

export type Agent = {
  id: number;
  name: string;
  provider: 'codex' | 'antigravity' | 'opencode';
  instructions: string;
  createdAt: string;
  updatedAt: string;
  skillIds: number[];
  skills: Skill[];
};
