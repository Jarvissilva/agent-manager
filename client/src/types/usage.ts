export type TokenCounters = {
  input: number | null;
  output: number | null;
  total: number | null;
  cached: number | null;
  cacheWrite: number | null;
  reasoning: number | null;
};
export type UsageSummary = TokenCounters & {
  coverage: 'unavailable' | 'partial' | 'reported';
};
export type UsageReport = UsageSummary & {
  timezone: string;
  from: string;
  to: string;
  missingTurns: number;
  partialTurns: number;
  unavailableSessions: number;
  daily: (TokenCounters & { day: string })[];
  breakdown: (TokenCounters & {
    provider: string;
    agentId: number | null;
    agentName: string | null;
    model: string | null;
    sessions: number;
  })[];
  agents: { id: number; name: string }[];
  models: string[];
};
