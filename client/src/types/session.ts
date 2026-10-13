import type { ChatSettings } from './chat';
export type Session = {
  id: string;
  name: string | null;
  projectId: number | null;
  workingDirectory: string;
  transport?: 'chat' | 'terminal';
  mode: 'interactive' | 'exec';
  source: 'manual' | 'schedule';
  occurrenceId: string | null;
  stepIndex: number | null;
  stepName: string | null;
  scheduleId: number | null;
  scheduleName: string | null;
  scheduledFor: string | null;
  outcome:
    | 'succeeded'
    | 'failed'
    | 'cancelled'
    | 'timed_out'
    | 'interrupted'
    | 'skipped'
    | null;
  error: string | null;
  result: string | null;
  provider: 'codex' | 'antigravity' | 'opencode';
  status: 'queued' | 'running' | 'stopping' | 'exited' | 'interrupted';
  activity: 'ready' | 'running' | 'needs_input' | 'error' | 'queued' | null;
  startedAt: string;
  lastResumedAt: string | null;
  providerConversationId?: string | null;
  codexConversationId: string | null;
  agentName: string | null;
  chatSettings?: ChatSettings;
};
