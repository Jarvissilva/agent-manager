import { useState } from 'react';
import useLiveRefresh from '../hooks/useLiveRefresh';
import { useFetcher } from 'react-router';
import { Trash2 } from 'lucide-react';
import type { Project } from '../lib/projects';
import type { projectsAction } from '../actions/projectAction';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';

export default function DeleteProjectButton({ project }: { project: Project }) {
  const fetcher = useFetcher<typeof projectsAction>();
  const [open, setOpen] = useState(false);
  const busy = fetcher.state !== 'idle';
  useLiveRefresh(open && !busy);
  const hasSessions = project.sessionCount > 0;
  return (
    <AlertDialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) setOpen(value);
      }}
    >
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          aria-label={`Delete ${project.name}`}
        >
          <Trash2 />
          Delete
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <fetcher.Form method="post" action="/projects" className="space-y-4">
          <input type="hidden" name="intent" value="delete" />
          <input type="hidden" name="projectId" value={project.id} />
          <AlertDialogHeader>
            <AlertDialogTitle className="break-words">
              Delete {project.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {hasSessions
                ? `This project has ${project.sessionCount} ${project.sessionCount === 1 ? 'session' : 'sessions'}. Keep them under No project, or permanently delete their records and messages from Agent OS.`
                : 'This project has no sessions. Only the project will be deleted.'}
              {project.scheduleCount > 0 &&
                ` Its ${project.scheduleCount} ${project.scheduleCount === 1 ? 'automation will' : 'automations will'} be kept under No project.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {project.activeSessionCount > 0 && (
            <p className="text-sm text-muted-foreground">
              End running sessions before deleting their records. You can keep
              them under No project while they continue running.
            </p>
          )}
          {fetcher.data?.error && (
            <p role="alert" className="text-sm text-destructive">
              {fetcher.data.error}
            </p>
          )}
          <AlertDialogFooter className="flex-col sm:flex-col">
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            {hasSessions ? (
              <>
                <Button
                  type="submit"
                  name="sessionDisposition"
                  value="keep"
                  disabled={busy}
                >
                  {busy ? 'Deleting…' : 'Delete project, keep sessions'}
                </Button>
                <Button
                  type="submit"
                  name="sessionDisposition"
                  value="delete"
                  variant="destructive"
                  disabled={busy || project.activeSessionCount > 0}
                >
                  Delete project and sessions
                </Button>
              </>
            ) : (
              <Button
                type="submit"
                name="sessionDisposition"
                value="empty"
                variant="destructive"
                disabled={busy}
              >
                {busy ? 'Deleting…' : 'Delete project'}
              </Button>
            )}
          </AlertDialogFooter>
        </fetcher.Form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
