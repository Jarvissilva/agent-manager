import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
export default function StatusBadge({ status }: { status: string }) {
  const success = [
    'available',
    'enabled',
    'succeeded',
    'completed',
    'connected',
  ].includes(status);
  const error = [
    'error',
    'failed',
    'timed_out',
    'not found',
    'disconnected',
  ].includes(status);
  const working = ['running', 'cancelling', 'queued', 'starting'].includes(
    status,
  );
  return (
    <Badge
      variant="secondary"
      className={cn(
        'gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-normal',
        success && 'bg-emerald-400/10 text-emerald-300',
        error && 'bg-destructive/10 text-destructive',
        working && 'bg-amber-300/10 text-amber-200',
        status === 'needs_input' &&
          'bg-amber-500/15 text-amber-700 dark:text-amber-300',
      )}
    >
      <span
        className={cn(
          'size-1.5 rounded-full bg-current',
          status === 'running' && 'animate-pulse motion-reduce:animate-none',
        )}
      />
      {(
        {
          ready: 'Ready',
          running: 'Running',
          needs_input: 'Needs input',
          error: 'Error',
          queued: 'Queued',
        } as Record<string, string>
      )[status] ?? status.replaceAll('_', ' ')}
    </Badge>
  );
}
