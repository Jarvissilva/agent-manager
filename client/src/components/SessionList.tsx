import { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import RenameSessionDialog from './RenameSessionDialog';
import DeleteSessionDialog from './DeleteSessionDialog';
import { Link } from 'react-router';
import type { Session } from '../types/session';
import type { Project } from '../lib/projects';
import StatusBadge from './StatusBadge';
import Icon from './Icon';
export default function SessionList({
  sessions,
  projects,
}: {
  sessions: Session[];
  projects: Project[];
}) {
  const [renaming, setRenaming] = useState<Session | null>(null);
  const [deleting, setDeleting] = useState<Session | null>(null);
  return sessions.length ? (
    <>
      <ul className="space-y-3">
        {sessions.map((session) => {
          const project = projects.find((p) => p.id === session.projectId);
          return (
            <li
              key={session.id}
              className="flex items-center rounded-2xl border bg-card/40 pr-3"
            >
              <Link
                to={`/sessions/${session.id}`}
                className="flex min-w-0 flex-1 items-center gap-4 rounded-2xl p-4 hover:bg-muted/50"
              >
                <Icon name="chat" />
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-medium">
                    {session.name ?? session.stepName ?? 'New session'}
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {project?.name ?? 'No project'} ·{' '}
                    {session.source === 'schedule' ? 'Automations' : 'Chat'} ·{' '}
                    {new Date(
                      session.lastResumedAt ??
                        session.scheduledFor ??
                        session.startedAt,
                    ).toLocaleString()}
                  </p>
                  <p
                    className="mt-1 truncate font-mono text-xs text-muted-foreground"
                    title={session.workingDirectory}
                  >
                    {session.workingDirectory}
                  </p>
                  {session.error && (
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {session.error}
                    </p>
                  )}
                </div>
                <StatusBadge status={session.activity ?? 'ready'} />
                <Icon name="arrow" className="text-muted-foreground" />
              </Link>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Rename ${session.name ?? 'session'}`}
                title="Rename session"
                onClick={() => setRenaming(session)}
              >
                <Pencil className="size-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Delete ${session.name ?? 'session'}`}
                title="Delete session"
                className="text-destructive hover:text-destructive"
                onClick={() => setDeleting(session)}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          );
        })}
      </ul>
      {renaming && (
        <RenameSessionDialog
          session={renaming}
          onClose={() => setRenaming(null)}
        />
      )}
      {deleting && (
        <DeleteSessionDialog
          session={
            sessions.find((session) => session.id === deleting.id) ?? deleting
          }
          onClose={() => setDeleting(null)}
        />
      )}
    </>
  ) : (
    <p className="rounded-2xl border border-dashed px-5 py-10 text-center text-sm text-muted-foreground">
      No sessions yet.
    </p>
  );
}
