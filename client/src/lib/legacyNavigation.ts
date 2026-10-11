import { redirect, type LoaderFunctionArgs } from 'react-router';
import { api } from './api';
import { resolveProject } from './projects';
import type { Session } from '../types/session';
export async function legacyRunLoader({ params, request }: LoaderFunctionArgs) {
  const session = await api<Session>(
    `/legacy/runs/${params.runId}`,
    request.signal,
  );
  return redirect(`/sessions/${session.id}`);
}

export function legacyJobsLoader({ request }: LoaderFunctionArgs) {
  const id = new URL(request.url).searchParams.get('run');
  return redirect(id ? `/runs/${encodeURIComponent(id)}` : '/schedules');
}

export async function legacyProjectWorkLoader({
  params,
  request,
}: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const project = await resolveProject(params.projectSlug, request);
  if (params.sessionId) {
    const session = await api<Session>(
      `/sessions/${params.sessionId}`,
      request.signal,
    );
    if (session.projectId !== project.id)
      throw new Response('Session not found in this project.', { status: 404 });
    return redirect(`/sessions/${session.id}`);
  }
  if (params.scheduleId) {
    const schedule = await api<{ projectId: number | null }>(
      `/schedules/${params.scheduleId}`,
      request.signal,
    );
    if (schedule.projectId !== project.id)
      throw new Response('Schedule not found in this project.', {
        status: 404,
      });
    return redirect(`/schedules/${params.scheduleId}`);
  }
  url.searchParams.delete('new');
  url.searchParams.set('projectId', String(project.id));
  return redirect(
    `${url.pathname.endsWith('/chat') ? '/sessions/new' : '/schedules/new'}?${url.searchParams}`,
  );
}
