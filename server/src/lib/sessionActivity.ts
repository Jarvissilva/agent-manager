import type { SessionInfo } from '../repositories/sessions.js';

export type SessionActivity =
  'ready' | 'running' | 'needs_input' | 'error' | 'queued';

type ChatActivity = {
  state: 'starting' | 'idle' | 'working' | 'stopping' | 'closed';
  error: string | null;
  requests: { size: number };
};

export function sessionActivity(
  info: SessionInfo,
  chat?: ChatActivity,
): SessionActivity | null {
  if (info.status === 'queued') return 'queued';
  if (chat && chat.state !== 'closed') {
    if (chat.requests.size) return 'needs_input';
    if (chat.state === 'working' || chat.state === 'stopping') return 'running';
    return chat.error ? 'error' : 'ready';
  }
  if (info.mode === 'exec' && ['running', 'stopping'].includes(info.status))
    return 'running';
  if (info.outcome === 'cancelled' || info.outcome === 'skipped')
    return 'ready';
  if (
    info.status === 'interrupted' ||
    ['failed', 'timed_out', 'interrupted'].includes(info.outcome ?? '') ||
    info.error ||
    (info.exitCode !== null && info.exitCode !== 0)
  )
    return 'error';
  return 'ready';
}
