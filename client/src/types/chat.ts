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
  kind: 'approval' | 'question';
  title: string;
  detail: string;
  questions: {
    id: string;
    question: string;
    secret: boolean;
    inputType?: string;
    required?: boolean;
    options: { label: string; description: string }[];
  }[];
};
export type ChatSnapshot = {
  settings?: ChatSettings;
  items: ChatItem[];
  requests: ChatRequest[];
  state: 'starting' | 'idle' | 'working' | 'stopping' | 'closed';
  error: string | null;
};

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
