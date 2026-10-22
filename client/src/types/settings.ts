import type { AgentProvider } from './chat';
export type AppSettings = {
  providers: Record<
    AgentProvider,
    { model: string | null; effort: string | null }
  >;
  timezone: string;
  shortcutsEnabled: boolean;
};
