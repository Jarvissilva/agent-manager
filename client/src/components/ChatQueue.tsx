import { useState } from 'react';
import { useFetcher } from 'react-router';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { ChatQueue as Queue } from '../types/chat';

function QueueEntry({
  entry,
  sessionId,
  index,
}: {
  entry: Queue['entries'][number];
  sessionId: string;
  index: number;
}) {
  const fetcher = useFetcher<{ error?: string }>();
  const [editing, setEditing] = useState(false);
  const busy = fetcher.state !== 'idle' || entry.status === 'sending';
  return (
    <li className="space-y-2 border-t py-3">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-xs text-muted-foreground">
          {index + 1}.{' '}
          {entry.status === 'sending'
            ? 'Sending'
            : entry.status === 'failed'
              ? 'Needs review'
              : 'Queued'}{' '}
          · {entry.settings.model ?? 'Provider default'}
          {entry.settings.mode === 'plan' ? ' · Plan' : ''}
        </p>
        <div className="flex shrink-0 gap-1">
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => setEditing(!editing)}
          >
            {editing ? 'Cancel' : 'Edit'}
          </Button>
          {entry.status === 'failed' && (
            <fetcher.Form method="post">
              <input type="hidden" name="intent" value="queue" />
              <input type="hidden" name="sessionId" value={sessionId} />
              <input type="hidden" name="entryId" value={entry.id} />
              <Button
                size="sm"
                variant="ghost"
                name="queueAction"
                value="retry"
                disabled={busy}
              >
                Requeue
              </Button>
            </fetcher.Form>
          )}
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="queue" />
            <input type="hidden" name="sessionId" value={sessionId} />
            <input type="hidden" name="entryId" value={entry.id} />
            <Button
              size="sm"
              variant="ghost"
              name="queueAction"
              value="remove"
              disabled={busy}
            >
              Remove
            </Button>
          </fetcher.Form>
        </div>
      </div>
      {editing ? (
        <fetcher.Form
          method="post"
          className="space-y-2"
          onSubmit={() => setEditing(false)}
        >
          <input type="hidden" name="intent" value="queue" />
          <input type="hidden" name="sessionId" value={sessionId} />
          <input type="hidden" name="entryId" value={entry.id} />
          <Textarea
            name="prompt"
            aria-label={`Edit queued prompt ${index + 1}`}
            defaultValue={entry.prompt}
            maxLength={100000}
            required
          />
          <Button size="sm" name="queueAction" value="edit" disabled={busy}>
            Save prompt
          </Button>
        </fetcher.Form>
      ) : (
        <p className="line-clamp-3 whitespace-pre-wrap break-words text-sm">
          {entry.prompt}
        </p>
      )}
      {entry.attachments?.length ? (
        <p className="text-xs text-muted-foreground">
          Files: {entry.attachments.map((file) => file.name).join(', ')}
        </p>
      ) : null}
      {entry.error && <p className="text-xs text-destructive">{entry.error}</p>}
      {fetcher.data?.error && (
        <p role="alert" className="text-xs text-destructive">
          {fetcher.data.error}
        </p>
      )}
    </li>
  );
}
export default function ChatQueue({
  queue,
  sessionId,
  active,
  canContinue,
}: {
  queue: Queue;
  sessionId: string;
  active: boolean;
  canContinue: boolean;
}) {
  const fetcher = useFetcher<{ error?: string }>();
  if (!queue.entries.length) return null;
  return (
    <section
      aria-label="Queued prompts"
      className="mx-auto w-full max-w-3xl shrink-0 px-4 pt-2"
    >
      <details className="rounded-xl border px-3">
        <summary className="cursor-pointer py-2 text-sm">
          {queue.entries.length} queued{' '}
          {queue.entries.length === 1 ? 'prompt' : 'prompts'}
          {queue.paused ? ' · paused' : ''}
        </summary>
        <div className="max-h-56 overflow-y-auto">
          <p className="mb-2 text-xs text-muted-foreground">
            {queue.reason ??
              'Prompts run in order after successful replies. Each keeps the settings chosen when queued.'}
          </p>
          <fetcher.Form method="post" className="pb-2">
            <input type="hidden" name="intent" value="queue" />
            <input type="hidden" name="sessionId" value={sessionId} />
            <Button
              size="sm"
              variant="outline"
              name="queueAction"
              value={queue.paused ? 'resume' : 'pause'}
              disabled={fetcher.state !== 'idle' || (queue.paused && !active)}
            >
              {queue.paused ? 'Resume queue' : 'Pause queue'}
            </Button>
          </fetcher.Form>
          {!active && canContinue && (
            <fetcher.Form method="post" className="pb-2">
              <input type="hidden" name="intent" value="resume" />
              <input type="hidden" name="sessionId" value={sessionId} />
              <Button
                size="sm"
                variant="outline"
                disabled={fetcher.state !== 'idle'}
              >
                Resume session
              </Button>
            </fetcher.Form>
          )}
          {!active && (
            <p className="pb-2 text-xs text-muted-foreground">
              {canContinue
                ? 'Resume this session to continue its queue.'
                : 'This session cannot be resumed. Copy pending prompts into a new chat.'}
            </p>
          )}
          {fetcher.data?.error && (
            <p role="alert" className="text-xs text-destructive">
              {fetcher.data.error}
            </p>
          )}
          <ol>
            {queue.entries.map((entry, index) => (
              <QueueEntry
                key={`${entry.id}:${entry.prompt}`}
                entry={entry}
                index={index}
                sessionId={sessionId}
              />
            ))}
          </ol>
        </div>
      </details>
    </section>
  );
}
