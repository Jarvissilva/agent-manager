export type AgentProvider = 'codex' | 'antigravity' | 'opencode';

export type ChatSettings = {
  mode?: 'default' | 'plan';
  model: string | null;
  effort: string | null;
  permissions: 'read-only' | 'workspace-write' | 'danger-full-access';
  networkAccess?: boolean;
  approvalPolicy?: 'on-request' | 'untrusted' | 'never';
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
