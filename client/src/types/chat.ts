import type { UsageSummary } from './usage';
import type { FileAttachment } from './files';

export type AgentProvider = 'codex' | 'antigravity' | 'opencode';
export type ChatItem = {
  id: string;
  turnId: string;
  type: string;
  role: 'user' | 'assistant' | 'activity';
  title: string;
  text: string;
  status: string;
};
export type ChatRequest = {
  id: string | number;
  kind: 'approval' | 'question' | 'mcp';
  elicitation?: {
    mode: 'form' | 'url' | 'unsupported';
    schema?: Record<string, unknown>;
    url?: string;
  };
  title: string;
  detail: string;
  questions: {
    id: string;
    question: string;
    secret: boolean;
    inputType?: string;
    required?: boolean;
    options: { label: string; description: string; value?: string }[];
  }[];
};
export type ChatQueue = {
  entries: {
    id: string;
    sessionId: string;
    prompt: string;
    settings: ChatSettings;
    attachments?: FileAttachment[];
    status: 'queued' | 'sending' | 'failed';
    error: string | null;
    createdAt: string;
  }[];
  paused: boolean;
  reason: string | null;
};
export type ChatSnapshot = {
  usage?: UsageSummary;
  queue?: ChatQueue;
  settings?: ChatSettings;
  items: ChatItem[];
  requests: ChatRequest[];
  state: 'starting' | 'idle' | 'working' | 'stopping' | 'closed';
  error: string | null;
};

export type ChatSettings = {
  mode?: 'default' | 'plan';
  model: string | null;
  effort: string | null;
  permissions: 'read-only' | 'workspace-write' | 'danger-full-access';
  networkAccess?: boolean;
  approvalPolicy?: 'on-request' | 'untrusted' | 'never';
};
export type ProviderModel = {
  providerId?: string;
  providerName?: string;
  id: string;
  model: string;
  displayName: string;
  description: string;
  isDefault: boolean;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: { reasoningEffort: string; description: string }[];
};
