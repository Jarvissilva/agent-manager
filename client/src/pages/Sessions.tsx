import {
  Link,
  useLoaderData,
  useSearchParams,
  type LoaderFunctionArgs,
} from 'react-router';
import { api } from '../lib/api';
import { loadProjects } from '../lib/projects';
import type { Session } from '../types/session';
import SessionList from '../components/SessionList';
import WorkFilters from '../components/WorkFilters';
import Icon from '../components/Icon';
import { Button } from '@/components/ui/button';
import useLiveRefresh from '../hooks/useLiveRefresh';
export async function sessionsLoader({ request }: LoaderFunctionArgs) {
  const [sessions, projects] = await Promise.all([
    api<Session[]>('/sessions', request.signal),
    loadProjects(request.signal),
  ]);
  return { sessions, projects };
}
export default function Sessions() {
  const { sessions, projects } = useLoaderData<typeof sessionsLoader>();
  const [query] = useSearchParams();
  useLiveRefresh(true);
  const search = (query.get('q') ?? '').toLowerCase();
  const projectId = query.get('projectId');
  const visible = sessions.filter((session) => {
    const project = projects.find(
      (project) => project.id === session.projectId,
    );
    return (
      (!projectId ||
        (projectId === 'none'
          ? session.projectId === null
          : String(session.projectId) === projectId)) &&
      (!query.get('folder') ||
        session.workingDirectory === query.get('folder')) &&
      (!query.get('status') || session.activity === query.get('status')) &&
      `${project?.name ?? 'No project'} ${session.workingDirectory} ${session.provider} ${session.name ?? ''} ${session.agentName ?? ''} ${session.scheduleName ?? ''} ${session.stepName ?? ''}`
        .toLowerCase()
        .includes(search)
    );
  });
  const grouping = query.get('group');
  const groups = new Map<string, Session[]>();
  for (const session of visible) {
    const key =
      grouping === 'folder'
        ? session.workingDirectory
        : String(session.projectId ?? 'none');
    groups.set(key, [...(groups.get(key) ?? []), session]);
  }
  const newQuery = new URLSearchParams();
  if (projectId && projectId !== 'none') newQuery.set('projectId', projectId);
  if (query.get('folder'))
    newQuery.set('workingDirectory', query.get('folder')!);
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-3 py-5 sm:px-4 lg:py-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Sessions</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            All your conversations, with or without a project.
          </p>
        </div>
        <Button asChild className="rounded-full">
          <Link to={`/sessions/new?${newQuery}`}>
            <Icon name="plus" />
            New session
          </Link>
        </Button>
      </header>
      <WorkFilters
        projects={projects}
        paths={[
          ...new Set(sessions.map((session) => session.workingDirectory)),
        ]}
        statuses={['running', 'needs_input', 'ready', 'error', 'queued']}
        grouping
      />
      <p className="mb-4 text-xs text-muted-foreground" role="status">
        {visible.length} {visible.length === 1 ? 'session' : 'sessions'}
      </p>
      {visible.length === 0 ? (
        <p className="rounded-2xl border border-dashed py-10 text-center text-sm text-muted-foreground">
          {sessions.length
            ? 'No matching sessions.'
            : 'Start your first session. No project required.'}
        </p>
      ) : grouping === 'folder' || grouping === 'project' ? (
        <div className="space-y-7">
          {[...groups].map(([key, group]) => (
            <section key={key} className="space-y-3">
              <h2 className="truncate text-sm font-medium" title={key}>
                {grouping === 'folder'
                  ? key
                  : (projects.find((project) => String(project.id) === key)
                      ?.name ?? 'No project')}{' '}
                <span className="ml-2 text-muted-foreground">
                  {group.length}
                </span>
              </h2>
              <SessionList sessions={group} projects={projects} />
            </section>
          ))}
        </div>
      ) : (
        <SessionList sessions={visible} projects={projects} />
      )}
    </main>
  );
}
