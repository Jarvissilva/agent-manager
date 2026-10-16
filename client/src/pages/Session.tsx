import { readBrowserStorage, writeBrowserStorage } from '../lib/sessionTabs';
import RenameSessionDialog from '../components/RenameSessionDialog';
import DeleteSessionDialog from '../components/DeleteSessionDialog';
import WorkingDirectoryField from '../components/WorkingDirectoryField';
import { loadProjects } from '../lib/projects';
import { NativeSelect } from '@/components/ui/native-select';
import { Label } from '@/components/ui/label';
import { useEffect, useState } from 'react';
import {
  Link,
  redirect,
  useFetcher,
  useLoaderData,
  useSearchParams,
  useParams,
  useNavigate,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from 'react-router';
import { api } from '../lib/api';
import type { Agent } from '../types/agent';
import type { Session as SessionInfo } from '../types/session';
import type { ProviderModel } from '../types/chat';
import SessionChat from '../components/SessionChat';
import ChatComposer from '../components/ChatComposer';
import Icon from '../components/Icon';
import StatusBadge from '../components/StatusBadge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { ChevronDown, SquarePen, Trash2 } from 'lucide-react';
import useLiveRefresh from '../hooks/useLiveRefresh';

export async function sessionLoader({ params, request }: LoaderFunctionArgs) {
  const query = new URL(request.url).searchParams;
  const [projects, history, agents, selected] = await Promise.all([
    loadProjects(request.signal),
    api<SessionInfo[]>('/sessions', request.signal),
    api<Agent[]>('/agents', request.signal),
    params.sessionId
      ? api<SessionInfo>(`/sessions/${params.sessionId}`, request.signal)
      : Promise.resolve(null),
  ]);
  if (selected && selected.id !== params.sessionId)
    throw redirect(`/sessions/${selected.id}`);
  const projectId = selected
    ? selected.projectId
    : query.has('projectId') && query.get('projectId') !== ''
      ? Number(query.get('projectId'))
      : null;
  const project = projects.find((project) => project.id === projectId) ?? null;
  if (projectId !== null && !project)
    throw new Response('Project not found.', { status: 404 });
  const current = selected;
  const provider =
    current?.provider ??
    (new URL(request.url).searchParams.get('provider') === 'opencode'
      ? 'opencode'
      : new URL(request.url).searchParams.get('provider') === 'antigravity'
        ? 'antigravity'
        : 'codex');
  const workingDirectory =
    current?.workingDirectory ??
    new URL(request.url).searchParams.get('workingDirectory') ??
    (project
      ? history.find((session) => session.projectId === project.id)
      : history[0]
    )?.workingDirectory ??
    project?.paths[0] ??
    '';
  const catalog = workingDirectory
    ? await api<ProviderModel[]>(
        `/providers/${provider}/models?workingDirectory=${encodeURIComponent(workingDirectory)}`,
        request.signal,
      )
        .then((models) => ({
          models,
          error:
            provider === 'opencode' && !models.length
              ? 'Connect a model provider in OpenCode, then refresh to load its models.'
              : null,
        }))
        .catch((error: unknown) => {
          if (request.signal.aborted) throw error;
          return {
            models: [] as ProviderModel[],
            error:
              error instanceof Error ? error.message : 'Could not load models.',
          };
        })
    : { models: [] as ProviderModel[], error: null };
  return {
    project,
    projects,
    session: selected,
    sessions: history,
    agents,
    provider,
    workingDirectory,
    ...catalog,
  };
}

export async function sessionAction({ params, request }: ActionFunctionArgs) {
  const form = await request.formData();
  const intent = form.get('intent');
  let sessionId = String(params.sessionId ?? form.get('sessionId') ?? '');
  try {
    if (intent === 'queue') {
      await api(`/sessions/${sessionId}/queue`, request.signal, 'PATCH', {
        action: form.get('queueAction'),
        id: form.get('entryId'),
        prompt: form.get('prompt'),
      });
      return { queueUpdated: true };
    }
    if (intent === 'rename') {
      await api(`/sessions/${sessionId}`, request.signal, 'PATCH', {
        name: form.get('name'),
      });
      return { renamed: true };
    }
    if (intent === 'cancel' || intent === 'stop') {
      await api(`/sessions/${sessionId}/cancel`, request.signal, 'POST', {});
      return { sent: false };
    }
    if (
      ![
        'message',
        'new-message',
        'continue',
        'interrupt',
        'answer',
        'resume',
      ].includes(String(intent))
    )
      return { error: 'Invalid session action.' };
    const saved = sessionId
      ? await api<SessionInfo>(`/sessions/${sessionId}`, request.signal)
      : null;
    if (intent !== 'new-message' && !saved)
      return { error: 'Session not found.' };
    const settings = form.has('settings')
      ? JSON.parse(String(form.get('settings')))
      : undefined;
    if (
      (intent === 'new-message' && !sessionId) ||
      intent === 'resume' ||
      (intent === 'continue' && saved?.status !== 'running')
    ) {
      const created = await api<{ session: SessionInfo }>(
        intent === 'new-message'
          ? '/sessions'
          : `/sessions/${sessionId}/resume`,
        request.signal,
        'POST',
        {
          transport: 'chat',
          ...(intent === 'new-message'
            ? {
                provider: form.get('provider') ?? 'codex',
                workingDirectory: form.get('workingDirectory'),
                projectId: form.get('projectId')
                  ? Number(form.get('projectId'))
                  : null,
              }
            : {}),
          settings,
          ...(intent === 'new-message'
            ? form.get('agentId')
              ? { agentId: Number(form.get('agentId')) }
              : {}
            : { resumeSessionId: sessionId }),
        },
      );
      sessionId = created.session.id;
    } else if (intent === 'new-message' && !saved)
      return { error: 'Session not found.' };
    if (intent === 'resume') return redirect(`/sessions/${sessionId}`);
    if (intent === 'interrupt')
      await api(`/sessions/${sessionId}/interrupt`, request.signal, 'POST', {});
    else if (intent === 'answer')
      await api(
        `/sessions/${sessionId}/requests/${encodeURIComponent(String(form.get('requestId')))}`,
        request.signal,
        'POST',
        {
          decision: form.get('decision'),
          answers: Object.fromEntries(
            [...form.entries()]
              .filter(([key]) => key.startsWith('answer:'))
              .map(([key, value]) => [key.slice(7), value]),
          ),
        },
      );
    else {
      await api(`/sessions/${sessionId}/messages`, request.signal, 'POST', {
        prompt: form.get('prompt'),
        settings,
        attachments: form.get('attachments')
          ? JSON.parse(String(form.get('attachments')))
          : [],
        ...(form.get('delivery') === 'queue' ? { delivery: 'queue' } : {}),
      });
      if (intent !== 'message')
        return redirect(
          `/sessions/${sessionId}${intent === 'new-message' && form.get('draftId') ? `?replaceDraft=${encodeURIComponent(String(form.get('draftId')))}` : ''}`,
        );
    }
    return { sent: intent === 'message' };
  } catch (error) {
    if (request.signal.aborted) throw error;
    return {
      error:
        error instanceof Error
          ? error.message
          : 'Could not update the conversation.',
      ...(sessionId ? { sessionId } : {}),
    };
  }
}

export default function Session() {
  const data = useLoaderData<typeof sessionLoader>();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const { sessionId } = useParams();
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const control = useFetcher<{ error?: string }>();
  const draftId = search.get('draft') ?? undefined;
  const initialDirectory =
    (!sessionId && draftId
      ? readBrowserStorage(`agent-manager:folder:${draftId}`)
      : null) ?? data.workingDirectory;
  const [directory, setDirectory] = useState(initialDirectory);
  useEffect(() => {
    if (!sessionId && draftId)
      writeBrowserStorage(`agent-manager:folder:${draftId}`, directory);
  }, [sessionId, draftId, directory]);
  const catalog = useFetcher<typeof sessionLoader>();
  const load = catalog.load;
  const requestedDirectory = `${data.project?.id ?? 'none'}:${sessionId ?? 'new'}:${search.get('workingDirectory') ?? ''}:${draftId ?? ''}`;
  const [previousDirectory, setPreviousDirectory] =
    useState(requestedDirectory);
  if (previousDirectory !== requestedDirectory) {
    setPreviousDirectory(requestedDirectory);
    setDirectory(initialDirectory);
  }
  useEffect(() => {
    if (!directory.trim() || sessionId) return;
    const timer = setTimeout(
      () =>
        void load(
          `/sessions/new?provider=${data.provider}&workingDirectory=${encodeURIComponent(directory)}${data.project ? `&projectId=${data.project.id}` : ''}`,
        ),
      300,
    );
    return () => clearTimeout(timer);
  }, [
    directory,
    data.project,
    data.provider,
    data.session,
    sessionId,
    search,
    load,
  ]);
  useLiveRefresh(true);
  const providerName =
    data.provider === 'opencode'
      ? 'OpenCode'
      : data.provider === 'antigravity'
        ? 'Antigravity'
        : 'Codex';
  const selected = data.session;
  const active = selected?.status === 'running';
  const blocked =
    selected?.status === 'queued' || selected?.status === 'stopping';
  const canContinue = Boolean(
    (selected?.providerConversationId ?? selected?.codexConversationId) &&
    ['exited', 'interrupted'].includes(selected.status) &&
    !blocked,
  );
  const history = data.sessions.filter(
    (session) => session.mode === 'interactive',
  );
  const workingDirectory = selected?.workingDirectory ?? directory;
  const folderName = workingDirectory
    ? (workingDirectory.split('/').filter(Boolean).at(-1) ?? workingDirectory)
    : 'Choose a working folder';
  return (
    <main className="session-page flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <header className="flex h-16 shrink-0 items-center justify-between gap-2 px-3 md:px-4">
        <div className="session-page-title flex min-w-0 items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="h-10 min-w-0 gap-2 px-2 text-base font-medium"
                title={workingDirectory || 'Choose a working folder'}
                aria-label={`Session details: ${folderName}`}
              >
                <span className="truncate">{folderName}</span>
                <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              className="w-80 max-w-[calc(100vw-1.5rem)]"
              align="start"
            >
              <DropdownMenuLabel>Session details</DropdownMenuLabel>
              <dl className="space-y-3 px-2 py-2 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Session</dt>
                  <dd className="mt-1 break-words">
                    {selected?.name ?? selected?.stepName ?? 'New session'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Project</dt>
                  <dd className="mt-1 break-words">
                    {data.project?.name ?? 'No project'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    Working folder
                  </dt>
                  <dd className="mt-1 break-all font-mono text-xs leading-relaxed">
                    {workingDirectory || 'Choose a working folder'}
                  </dd>
                </div>
                {selected && (
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      Token usage
                    </dt>
                    <dd className="mt-1">
                      <Link
                        className="underline"
                        to={`/usage?sessionId=${selected.id}`}
                      >
                        {selected.usage?.total == null
                          ? 'Unavailable'
                          : `${selected.usage.total.toLocaleString()} tokens${selected.usage.coverage === 'partial' ? ' · partial' : ''}`}
                      </Link>
                    </dd>
                  </div>
                )}
              </dl>
            </DropdownMenuContent>
          </DropdownMenu>
          <span className="hidden truncate text-xs text-muted-foreground sm:block">
            {selected?.agentName ?? providerName}
          </span>
          {selected && <StatusBadge status={selected.activity ?? 'ready'} />}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Session history"
                title="Session history"
              >
                <Icon name="history" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-80 w-72">
              <DropdownMenuLabel>Recent chats</DropdownMenuLabel>
              {history.length ? (
                history.map((session) => (
                  <DropdownMenuItem asChild key={session.id}>
                    <Link to={`/sessions/${session.id}`} className="flex gap-3">
                      <Icon name="chat" />
                      <div className="min-w-0">
                        <p className="truncate">
                          {session.name ?? session.stepName ?? 'New session'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(
                            session.lastResumedAt ?? session.startedAt,
                          ).toLocaleString()}
                        </p>
                      </div>
                    </Link>
                  </DropdownMenuItem>
                ))
              ) : (
                <p className="px-2 py-3 text-sm text-muted-foreground">
                  Your chats will appear here.
                </p>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button asChild variant="ghost" size="icon" title="New chat">
            <Link
              to={`/sessions/new${data.project ? `?projectId=${data.project.id}` : ''}`}
              aria-label="New chat"
            >
              <SquarePen />
            </Link>
          </Button>
          {selected && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Session options"
                >
                  <Icon name="more" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onSelect={() => setRenaming(true)}>
                  <SquarePen className="size-4" />
                  Rename session
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => setDeleting(true)}
                >
                  <Trash2 className="size-4" />
                  Delete session
                </DropdownMenuItem>
                {active && (
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={
                      control.state !== 'idle' || selected.status === 'stopping'
                    }
                    onSelect={() =>
                      void control.submit(
                        { intent: 'stop' },
                        { method: 'post' },
                      )
                    }
                  >
                    <Icon name="stop" />
                    End session
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </header>
      {selected && renaming && (
        <RenameSessionDialog
          key={selected.id}
          session={selected}
          onClose={() => setRenaming(false)}
        />
      )}
      {selected && deleting && (
        <DeleteSessionDialog
          session={selected}
          redirectToList
          onClose={() => setDeleting(false)}
        />
      )}
      {control.data?.error && (
        <p
          className="mx-auto w-full max-w-3xl px-3 py-2 sm:px-4 text-sm text-amber-300"
          role="status"
        >
          {control.data.error}
        </p>
      )}
      {selected?.source === 'schedule' && (
        <div
          className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-3 px-3 py-2 sm:px-4 text-xs text-muted-foreground"
          role="status"
        >
          <span>
            {selected.scheduleName ?? 'Deleted automation'}
            {selected.stepName
              ? ` · ${(selected.stepIndex ?? 0) + 1}. ${selected.stepName}`
              : ''}{' '}
            ·{' '}
            {selected.outcome
              ? selected.outcome.replaceAll('_', ' ')
              : 'Automation session'}
            {selected.scheduledFor
              ? ` · ${new Date(selected.scheduledFor).toLocaleString()}`
              : ''}
          </span>
          {selected.status === 'queued' && (
            <control.Form method="post">
              <input type="hidden" name="sessionId" value={selected.id} />
              <Button
                size="sm"
                variant="ghost"
                name="intent"
                value="cancel"
                disabled={control.state !== 'idle'}
              >
                Cancel queued session
              </Button>
            </control.Form>
          )}
          {selected.error && (
            <span className="w-full text-destructive">{selected.error}</span>
          )}
        </div>
      )}
      {selected &&
        !active &&
        selected.status !== 'queued' &&
        !selected.providerConversationId &&
        !selected.codexConversationId && (
          <p className="mx-auto w-full max-w-3xl px-3 py-2 sm:px-4 text-xs text-muted-foreground">
            Saved history only. No provider conversation is available to
            continue.
          </p>
        )}
      {search.get('defaultsNotice') && (
        <p
          role="status"
          className="mx-auto w-full max-w-3xl px-4 text-xs text-muted-foreground"
        >
          {search.get('defaultsNotice')}
        </p>
      )}
      {data.error && (
        <p
          className="mx-auto w-full max-w-3xl px-3 py-2 sm:px-4 text-xs text-muted-foreground"
          role="status"
        >
          {data.error}
        </p>
      )}
      {selected ? (
        <SessionChat
          key={`${selected.id}:${selected.lastResumedAt ?? selected.startedAt}`}
          sessionId={selected.id}
          active={Boolean(active)}
          provider={data.provider}
          models={data.models}
          settings={selected.chatSettings}
          savedQueue={selected.queue}
          queueEnabled={
            selected.source !== 'schedule' || Boolean(selected.lastResumedAt)
          }
          canContinue={canContinue}
          blocked={blocked}
        />
      ) : (
        <div className="session-chat flex min-h-0 flex-1 flex-col">
          <div className="chat-transcript flex min-h-0 flex-1 flex-col items-center justify-center px-3 pb-6 sm:px-4 text-center">
            <div className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-muted/50">
              <Icon name="spark" className="size-7" />
            </div>
            <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">
              What are we working on?
            </h1>
            <p className="mt-3 max-w-sm text-sm leading-6 text-muted-foreground">
              Plan, build, and explore with your agents.
              <br />
              Ready when you are.
            </p>
          </div>
          <div className="mx-auto w-full max-w-3xl shrink-0 space-y-3 px-3 sm:px-4">
            <div className="grid gap-2">
              <Label htmlFor="new-session-project">Project (optional)</Label>
              <NativeSelect
                id="new-session-project"
                value={data.project?.id ?? ''}
                onChange={(event) => {
                  const query = new URLSearchParams(search);
                  query.set('workingDirectory', directory);
                  if (event.target.value)
                    query.set('projectId', event.target.value);
                  else query.delete('projectId');
                  void navigate(`/sessions/new?${query}`, { replace: true });
                }}
              >
                <option value="">No project</option>
                {data.projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <WorkingDirectoryField
              value={directory}
              onChange={setDirectory}
              suggestions={
                data.project?.paths ?? [
                  ...new Set(
                    data.sessions.map((session) => session.workingDirectory),
                  ),
                ]
              }
              disabled={blocked}
            />
            {catalog.data?.workingDirectory === directory &&
              catalog.data.error && (
                <p role="alert" className="mt-2 text-xs text-destructive">
                  {catalog.data.error}
                </p>
              )}
          </div>
          <ChatComposer
            key={`new-session:${draftId ?? 'default'}`}
            draftId={draftId}
            workingDirectory={directory}
            projectId={data.project?.id ?? null}
            intent="new-message"
            provider={data.provider}
            onProviderChange={(provider) => {
              const query = new URLSearchParams(search);
              query.set('provider', provider);
              query.set('workingDirectory', directory);
              void navigate(`/sessions/new?${query}`);
            }}
            models={
              catalog.data?.workingDirectory === directory &&
              catalog.data.provider === data.provider
                ? catalog.data.models
                : directory === data.workingDirectory
                  ? data.models
                  : []
            }
            agents={data.agents}
            disabled={blocked}
          />
        </div>
      )}
    </main>
  );
}
