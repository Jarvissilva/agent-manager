import type { Agent } from './agent';
export type AppSettings = {
  providers: Record<
    Agent['provider'],
    { model: string | null; effort: string | null }
  >;
  timezone: string;
  shortcutsEnabled: boolean;
};
