import { useEffect, useId } from 'react';
import { useFetcher } from 'react-router';
import type { Session } from '../types/session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';

export default function RenameSessionDialog({
  session,
  onClose,
}: {
  session: Session;
  onClose: () => void;
}) {
  const fetcher = useFetcher<{ renamed?: boolean; error?: string }>();
  const inputId = useId();
  const busy = fetcher.state !== 'idle';
  useEffect(() => {
    if (fetcher.state === 'idle' && fetcher.data?.renamed) onClose();
  }, [fetcher.state, fetcher.data, onClose]);
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialogContent>
        <fetcher.Form
          method="post"
          action={`/sessions/${session.id}`}
          className="space-y-4"
        >
          <input type="hidden" name="intent" value="rename" />
          <AlertDialogHeader>
            <AlertDialogTitle>Rename session</AlertDialogTitle>
            <AlertDialogDescription>
              Choose a name that makes this session easy to find.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor={inputId}>Session name</Label>
            <Input
              id={inputId}
              name="name"
              defaultValue={session.name ?? session.stepName ?? ''}
              maxLength={100}
              required
              autoFocus
              disabled={busy}
            />
          </div>
          {fetcher.data?.error && (
            <p role="alert" className="text-sm text-destructive">
              {fetcher.data.error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
          </AlertDialogFooter>
        </fetcher.Form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
