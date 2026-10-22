import type { Skill } from './skill';

export type Agent = {
  id: number;
  name: string;
  instructions: string;
  createdAt: string;
  updatedAt: string;
  skillIds: number[];
  skills: Skill[];
};
