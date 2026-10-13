import { useEffect } from 'react';
import { useFetcher } from 'react-router';
import type { Session } from '../types/session';
import type { sessionListAction } from '../actions/sessionListAction';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';

export default function DeleteSessionDialog({
  session,
  onClose,
  redirectToList = false,
}: {
  session: Session;
  onClose: () => void;
  redirectToList?: boolean;
}) {
  const fetcher = useFetcher<typeof sessionListAction>();
  const busy = fetcher.state !== 'idle';
  const ended = ['exited', 'interrupted'].includes(session.status);
  useEffect(() => {
    if (fetcher.state === 'idle' && fetcher.data?.deleted) onClose();
  }, [fetcher.state, fetcher.data, onClose]);
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <AlertDialogContent>
        <fetcher.Form method="post" action="/sessions" className="space-y-4">
          <input type="hidden" name="intent" value="delete" />
          <input type="hidden" name="sessionId" value={session.id} />
          <input
            type="hidden"
            name="redirectToList"
            value={String(redirectToList)}
          />
          <AlertDialogHeader>
            <AlertDialogTitle className="break-words">
              Delete {session.name ?? session.stepName ?? 'session'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Permanently delete this session and its messages from Agent
              Manager. Project files and the provider’s native conversation will
              be kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {!ended && (
            <p className="text-sm text-muted-foreground">
              End this session or cancel it if queued before deleting its
              history.
            </p>
          )}
          {fetcher.data?.error && (
            <p role="alert" className="text-sm text-destructive">
              {fetcher.data.error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button
              type="submit"
              variant="destructive"
              disabled={busy || !ended}
            >
              {busy ? 'Deleting…' : 'Delete session'}
            </Button>
          </AlertDialogFooter>
        </fetcher.Form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
