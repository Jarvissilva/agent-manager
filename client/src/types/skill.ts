export type Skill = {
  id: number;
  name: string;
  instructions: string;
  nativeName: string;
  description: string;
  path: string;
  source: 'managed' | 'imported';
  error: string | null;
  publications: {
    provider: string;
    path: string;
    status: string;
    error: string | null;
  }[];
  createdAt: string;
  updatedAt: string;
};
