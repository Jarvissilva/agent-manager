import { useState } from 'react';
import {
  Link,
  useFetcher,
  useLoaderData,
  useRouteLoaderData,
  type LoaderFunctionArgs,
} from 'react-router';
import type { projectsLoader } from '../layouts/AppLayout';
import type { homeAction } from '../actions/homeAction';
import { api } from '../lib/api';
import type { Session } from '../types/session';
import SessionList from '../components/SessionList';
import WorkingDirectoryField from '../components/WorkingDirectoryField';
import useLiveRefresh from '../hooks/useLiveRefresh';
import Icon from '../components/Icon';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/native-select';

export async function homeLoader({ request }: LoaderFunctionArgs) {
  return api<Session[]>('/sessions', request.signal);
}

export default function Home() {
  const sessions = useLoaderData<typeof homeLoader>();
  const projects = useRouteLoaderData<typeof projectsLoader>('app') ?? [];
  const start = useFetcher<typeof homeAction>();
  const [projectId, setProjectId] = useState('');
  const [directory, setDirectory] = useState(
    sessions[0]?.workingDirectory ?? '',
  );
  useLiveRefresh(true);
  const project = projects.find((project) => String(project.id) === projectId);
  const active = sessions.filter((session) => session.activity === 'running');
  const needsInput = sessions.filter(
    (session) => session.activity === 'needs_input',
  );
  const projectSession = project
    ? sessions.find(
        (session) =>
          session.projectId === project.id &&
          ['running', 'stopping'].includes(session.status),
      )
    : undefined;
  const queued =
    project &&
    sessions.some(
      (session) =>
        session.projectId === project.id && session.status === 'queued',
    );
  const busy = start.state !== 'idle';
  const blocked = Boolean(projectSession || queued);
  const suggestions = [
    ...new Set([
      ...(project?.paths ?? []),
      ...sessions.map((session) => session.workingDirectory),
    ]),
  ];
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-3 py-5 sm:px-4 lg:py-6">
      <header className="mb-6 space-y-2">
        <h1 className="text-2xl font-semibold">What are we working on?</h1>
        <p className="text-sm text-muted-foreground">
          Start a new chat or continue a conversation.
        </p>
      </header>
      <section
        aria-labelledby="start-chat-title"
        className="rounded-2xl border bg-card/40 p-4 sm:p-5"
      >
        <h2
          id="start-chat-title"
          className="mb-5 flex items-center gap-2 text-base font-medium"
        >
          <Icon name="chat" />
          New chat
        </h2>
        <start.Form method="post" action="/?index" className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="home-project">Project (optional)</Label>
              <NativeSelect
                id="home-project"
                name="projectId"
                value={projectId}
                disabled={busy}
                onChange={(event) => {
                  setProjectId(event.target.value);
                  if (!directory.trim())
                    setDirectory(
                      projects.find(
                        (project) => String(project.id) === event.target.value,
                      )?.paths[0] ?? '',
                    );
                }}
              >
                <option value="">No project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <div className="space-y-2">
              <Label htmlFor="home-provider">Provider</Label>
              <NativeSelect
                id="home-provider"
                name="provider"
                defaultValue="codex"
                disabled={busy}
              >
                <option value="codex">Codex</option>
                <option value="antigravity">Antigravity</option>
                <option value="opencode">OpenCode</option>
              </NativeSelect>
            </div>
          </div>
          <WorkingDirectoryField
            value={directory}
            onChange={setDirectory}
            suggestions={suggestions}
            disabled={busy}
          />
          <input type="hidden" name="workingDirectory" value={directory} />
          {start.data?.error && (
            <p role="alert" className="text-sm text-destructive">
              {start.data.error}
            </p>
          )}
          {blocked && (
            <p role="status" className="text-sm text-muted-foreground">
              {projectSession ? (
                <>
                  This project already has an active session.{' '}
                  <Link
                    to={`/sessions/${projectSession.id}`}
                    className="text-foreground underline underline-offset-4"
                  >
                    Open session
                  </Link>
                </>
              ) : (
                'This project has queued sessions. Wait for them to finish, or choose another project.'
              )}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <p className="text-xs text-muted-foreground">
              Model and reasoning settings are available in chat.
            </p>
            <Button
              type="submit"
              disabled={busy || blocked || !directory.trim()}
              className="rounded-full"
            >
              <Icon name="plus" />
              {busy ? 'Starting…' : 'Start chat'}
            </Button>
          </div>
        </start.Form>
      </section>
      <section
        aria-labelledby="active-sessions-title"
        className="mt-8 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2
            id="active-sessions-title"
            className="flex items-center gap-2 text-base font-medium"
          >
            <Icon name="activity" />
            Running sessions
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {active.length}
            </span>
          </h2>
          <Button asChild variant="ghost" size="sm">
            <Link to="/sessions">
              All sessions
              <Icon name="arrow" />
            </Link>
          </Button>
        </div>
        {active.length ? (
          <SessionList sessions={active} projects={projects} />
        ) : (
          <p className="rounded-2xl border border-dashed py-8 text-center text-sm text-muted-foreground">
            No sessions are running. Start a chat above to get going.
          </p>
        )}
      </section>
      {needsInput.length > 0 && (
        <section aria-labelledby="needs-input-title" className="mt-8 space-y-4">
          <h2
            id="needs-input-title"
            className="flex items-center gap-2 text-base font-medium"
          >
            Needs input
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {needsInput.length}
            </span>
          </h2>
          <SessionList sessions={needsInput} projects={projects} />
        </section>
      )}
    </main>
  );
}
