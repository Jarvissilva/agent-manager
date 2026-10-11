export type AgentProvider = 'codex' | 'antigravity' | 'opencode';

export type ChatSettings = {
  model: string | null;
  effort: string | null;
  permissions: 'read-only' | 'workspace-write';
};

export type ProviderModel = {
  id: string;
  model: string;
  displayName: string;
  description: string;
  isDefault: boolean;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: { reasoningEffort: string; description: string }[];
};
