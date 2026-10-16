import ScheduleTaskFields from '../components/ScheduleTaskFields';
import SessionList from '../components/SessionList';
import { loadProjects, type Project } from '../lib/projects';
import type { Agent } from '../types/agent';
import type { Session } from '../types/session';
import type { ProviderModel } from '../types/chat';
import useLiveRefresh from '../hooks/useLiveRefresh';
import DeleteButton from '../components/DeleteButton';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useState } from 'react';
import {
  Form,
  Link,
  redirect,
  useLoaderData,
  useActionData,
  useNavigation,
  useFetcher,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from 'react-router';
import { api } from '../lib/api';
import type { Schedule } from '../types/schedule';
export async function scheduleLoader({ request, params }: LoaderFunctionArgs) {
  const query = new URL(request.url).searchParams;
  const [schedule, projects, agents, sessions] = await Promise.all([
    params.scheduleId
      ? api<Schedule>(`/schedules/${params.scheduleId}`, request.signal)
      : Promise.resolve(null),
    loadProjects(request.signal),
    api<Agent[]>('/agents', request.signal),
    params.scheduleId
      ? api<Session[]>(
          `/schedules/${params.scheduleId}/sessions`,
          request.signal,
        )
      : Promise.resolve([]),
  ]);
  const id = schedule
    ? schedule.projectId
    : query.get('projectId')
      ? Number(query.get('projectId'))
      : null;
  const project = projects.find((project) => project.id === id) ?? null;
  if (id !== null && !project)
    throw new Response('Project not found.', { status: 404 });
  const projectId = project ? String(project.id) : '';
  const directory =
    query.get('workingDirectory') ??
    schedule?.steps[0]?.workingDirectory ??
    project?.paths[0] ??
    '';
  const provider =
    query.get('provider') ?? schedule?.steps[0]?.provider ?? 'codex';
  const catalog =
    query.has('catalog') && directory
      ? await api<ProviderModel[]>(
          `/providers/${provider}/models?workingDirectory=${encodeURIComponent(directory)}`,
          request.signal,
        )
          .then((models) => ({ models, modelError: null }))
          .catch((error: unknown) => {
            if (request.signal.aborted) throw error;
            return {
              models: [] as ProviderModel[],
              modelError:
                error instanceof Error
                  ? error.message
                  : 'Could not load models. Use provider defaults.',
            };
          })
      : { models: [] as ProviderModel[], modelError: null };
  return {
    schedule,
    project,
    projects,
    agents,
    projectId,
    sessions,
    catalogProvider: provider,
    workingDirectory: directory,
    ...catalog,
  };
}

export async function scheduleAction({ request, params }: ActionFunctionArgs) {
  const existing = params.scheduleId
    ? await api<Schedule>(`/schedules/${params.scheduleId}`, request.signal)
    : null;
  const form = await request.formData();
  const intent = form.get('intent');
  try {
    if (intent === 'delete' && params.scheduleId) {
      await api(`/schedules/${params.scheduleId}`, request.signal, 'DELETE');
      return redirect('/schedules');
    }
    if (intent === 'toggle' && existing) {
      await api(`/schedules/${existing.id}`, request.signal, 'PUT', {
        ...existing,
        enabled: !existing.enabled,
      });
      return null;
    }
    if (intent !== 'save' && intent !== 'preview')
      return { error: 'Invalid automation action.' };
    const kind = form.get('kind');
    let runAt: string | null = null;
    if (kind === 'once') {
      const value = String(form.get('runAt'));
      const date = new Date(value);
      if (!Number.isFinite(date.getTime()))
        return { error: 'Choose a valid date and time.' };
      runAt = date.toISOString();
    }
    const body = {
      name: form.get('name'),
      projectId: form.get('projectId') ? Number(form.get('projectId')) : null,
      steps: JSON.parse(String(form.get('steps'))),
      kind,
      runAt,
      cron: kind === 'cron' ? form.get('cron') : null,
      timezone: form.get('timezone'),
      enabled: form.has('enabled'),
    };
    if (intent === 'preview')
      return await api<{
        dates: string[];
      }>('/schedules/preview', request.signal, 'POST', body);
    const result = await api<Schedule>(
      params.scheduleId ? `/schedules/${params.scheduleId}` : '/schedules',
      request.signal,
      params.scheduleId ? 'PUT' : 'POST',
      body,
    );
    return redirect(`/schedules/${result.id}`);
  } catch (error) {
    if (request.signal.aborted) throw error;
    return {
      error:
        error instanceof Error ? error.message : 'Could not save automation.',
    };
  }
}
function localDate(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
function ScheduleEditor({
  schedule,
  projects,
  agents,
  projectId,
  busy,
}: {
  schedule: Schedule | null;
  projects: Project[];
  agents: Agent[];
  projectId: string;
  busy: boolean;
}) {
  const [kind, setKind] = useState(schedule?.kind ?? 'cron');
  const preview = useFetcher<typeof scheduleAction>();
  const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <Form method="post" className="grid gap-3 [&>label:not(:first-child)]:mt-3">
      <Label htmlFor="schedule-name" className="grid gap-2 text-sm font-medium">
        Name
      </Label>
      <Input
        id="schedule-name"
        name="name"
        required
        maxLength={100}
        defaultValue={schedule?.name}
        disabled={busy}
        className="h-10"
      />
      <Label htmlFor="schedule-kind" className="grid gap-2 text-sm font-medium">
        Schedule type
      </Label>
      <NativeSelect
        id="schedule-kind"
        name="kind"
        value={kind}
        onChange={(e) => {
          if (e.target.value === 'once' || e.target.value === 'cron')
            setKind(e.target.value);
        }}
        disabled={busy}
        className="w-full [&>select]:h-10"
      >
        <option value="cron">Recurring (cron)</option>
        <option value="once">One time</option>
      </NativeSelect>
      {kind === 'once' ? (
        <>
          <Label
            htmlFor="schedule-date"
            className="grid gap-2 text-sm font-medium"
          >
            Date and time ({browserTimezone})
          </Label>
          <Input
            id="schedule-date"
            name="runAt"
            type="datetime-local"
            required
            defaultValue={localDate(schedule?.runAt)}
            disabled={busy}
            className="h-10"
          />
          <input
            type="hidden"
            name="timezone"
            value={browserTimezone}
            className="h-10"
          />
        </>
      ) : (
        <>
          <Label
            htmlFor="schedule-cron"
            className="grid gap-2 text-sm font-medium"
          >
            Cron expression
          </Label>
          <Input
            id="schedule-cron"
            name="cron"
            required
            maxLength={200}
            defaultValue={schedule?.cron ?? '0 9 * * 1-5'}
            disabled={busy}
            className="h-10"
          />
          <p className="text-xs leading-5 text-muted-foreground">
            Five fields: minute hour day-of-month month day-of-week. Example: 0
            9 * * 1-5 runs at 09:00 on weekdays.
          </p>
          <Label
            htmlFor="schedule-timezone"
            className="grid gap-2 text-sm font-medium"
          >
            Timezone
          </Label>
          <Input
            id="schedule-timezone"
            name="timezone"
            required
            defaultValue={schedule?.timezone ?? browserTimezone}
            disabled={busy}
            className="h-10"
          />
        </>
      )}
      <Label className="font-medium flex items-center gap-3 py-1 text-sm">
        <Checkbox
          name="enabled"
          defaultChecked={schedule?.enabled ?? true}
          disabled={busy || schedule?.completed}
          className="size-4"
        />
        Enabled
      </Label>
      <ScheduleTaskFields
        schedule={schedule}
        projects={projects}
        agents={agents}
        projectId={projectId}
        busy={busy}
      />
      <p className="text-xs leading-5 text-muted-foreground">
        After downtime, one missed occurrence is queued per automation. Busy
        projects queue tasks until free. Pausing does not cancel existing queued
        sessions.
      </p>
      <Button
        type="button"
        disabled={busy || preview.state !== 'idle'}
        onClick={(e) => {
          const form = e.currentTarget.form;
          if (form && form.reportValidity()) {
            const data = new FormData(form);
            data.set('intent', 'preview');
            void preview.submit(data, { method: 'post' });
          }
        }}
      >
        {preview.state !== 'idle' ? 'Checking…' : 'Preview upcoming times'}
      </Button>
      {preview.data && 'error' in preview.data && (
        <p
          className="rounded-xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm leading-6 text-destructive break-words"
          role="alert"
        >
          {preview.data.error}
        </p>
      )}
      {preview.data && 'dates' in preview.data && (
        <ul>
          {preview.data.dates.map((date) => (
            <li key={date}>
              {new Date(date).toLocaleString()} (your local time)
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-3 pt-3 [&>a]:text-sm [&>a]:text-muted-foreground [&>a:hover]:text-foreground">
        <Button name="intent" value="save" disabled={busy}>
          {busy ? 'Saving…' : schedule ? 'Save changes' : 'Create automation'}
        </Button>
        <Link to="/schedules">Cancel</Link>
      </div>
    </Form>
  );
}
export default function SchedulePage() {
  const { schedule, project, projects, agents, projectId, sessions } =
    useLoaderData<typeof scheduleLoader>();
  const data = useActionData<typeof scheduleAction>();
  const busy = useNavigation().state !== 'idle';
  useLiveRefresh(Boolean(schedule));
  const occurrences = new Map<string, Session[]>();
  for (const session of sessions) {
    const id = session.occurrenceId ?? session.id;
    const group = occurrences.get(id) ?? [];
    group.push(session);
    occurrences.set(id, group);
  }
  return (
    <main className="mx-auto min-h-0 w-full max-w-3xl flex-1 px-3 py-5 sm:px-4 lg:py-6">
      <header className="mb-8 space-y-3">
        <Link
          to={project ? `/schedules?projectId=${project.id}` : '/schedules'}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          {project ? `${project.name} / Automations` : 'Automations'}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          {schedule ? `Edit ${schedule.name}` : 'New automation'}
        </h1>
        <p className="text-sm leading-6 text-muted-foreground">
          The local server must be running to start automations.
        </p>
        {schedule && (
          <p className="text-xs leading-5 text-muted-foreground">
            {schedule.completed
              ? 'Completed'
              : schedule.enabled
                ? 'Enabled'
                : 'Paused'}{' '}
            · Next:{' '}
            {schedule.nextRunAt
              ? new Date(schedule.nextRunAt).toLocaleString()
              : 'None'}
          </p>
        )}
      </header>
      {data && 'error' in data && (
        <p
          className="rounded-xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm leading-6 text-destructive break-words"
          role="alert"
        >
          {data.error}
        </p>
      )}
      <Card className="mb-6 space-y-5 rounded-2xl border bg-card/40 p-4">
        <ScheduleEditor
          key={schedule?.id ?? `new-${projectId}`}
          schedule={schedule}
          projects={projects}
          agents={agents}
          projectId={projectId}
          busy={busy}
        />
      </Card>
      {schedule && (
        <Card className="mb-6 space-y-5 rounded-2xl border bg-card/40 p-4">
          <h2 className="text-base font-semibold">Manage automation</h2>
          {schedule.completed && (
            <p className="text-sm leading-6 text-muted-foreground">
              Choose a future date to schedule this task again.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <Form method="post">
              <Button
                name="intent"
                value="toggle"
                disabled={busy || schedule.completed}
                variant="outline"
              >
                {schedule.enabled ? 'Pause automation' : 'Enable automation'}
              </Button>
            </Form>
            <DeleteButton
              name={schedule.name}
              label="Delete automation"
              description="Queued sessions will be cancelled. Active sessions finish, and all history is kept."
              busy={busy}
            />
          </div>
        </Card>
      )}
      {schedule && (
        <section className="space-y-4">
          <h2 className="text-base font-semibold">History</h2>
          {sessions.length ? (
            [...occurrences].map(([id, group]) => (
              <div key={id} className="space-y-3 rounded-2xl border p-4">
                <h3 className="text-sm font-medium">
                  {new Date(
                    group[0].scheduledFor ?? group[0].startedAt,
                  ).toLocaleString()}
                </h3>
                <SessionList
                  sessions={[...group].sort(
                    (a, b) => (a.stepIndex ?? 0) - (b.stepIndex ?? 0),
                  )}
                  projects={projects}
                />
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No sessions yet.</p>
          )}
        </section>
      )}
    </main>
  );
}
