export type ScheduleStep = {
  name: string;
  workingDirectory: string;
  agentId: number | null;
  agentName: string | null;
  provider: 'codex' | 'antigravity' | 'opencode';
  prompt: string;
  settings: import('./chat').ChatSettings;
  timeoutMinutes: number;
};
export type Schedule = {
  id: number;
  projectId: number | null;
  projectName: string | null;
  steps: ScheduleStep[];
  name: string;
  kind: 'once' | 'cron';
  runAt: string | null;
  cron: string | null;
  timezone: string;
  enabled: boolean;
  completed: boolean;
  nextRunAt: string | null;
  lastTriggeredAt: string | null;
  createdAt: string;
  updatedAt: string;
};
