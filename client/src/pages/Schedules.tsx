import {
  Link,
  useLoaderData,
  useSearchParams,
  type LoaderFunctionArgs,
} from 'react-router';
import { api } from '../lib/api';
import { loadProjects } from '../lib/projects';
import type { Schedule } from '../types/schedule';
import ScheduleList from '../components/ScheduleList';
import WorkFilters from '../components/WorkFilters';
import Icon from '../components/Icon';
import { Button } from '@/components/ui/button';
import useLiveRefresh from '../hooks/useLiveRefresh';
export async function schedulesLoader({ request }: LoaderFunctionArgs) {
  const [schedules, projects] = await Promise.all([
    api<Schedule[]>('/schedules', request.signal),
    loadProjects(request.signal),
  ]);
  return { schedules, projects };
}
export default function Schedules() {
  const { schedules, projects } = useLoaderData<typeof schedulesLoader>();
  const [query] = useSearchParams();
  useLiveRefresh(true);
  const search = (query.get('q') ?? '').toLowerCase();
  const projectId = query.get('projectId');
  const visible = schedules.filter(
    (schedule) =>
      (!projectId ||
        (projectId === 'none'
          ? schedule.projectId === null
          : String(schedule.projectId) === projectId)) &&
      (!query.get('folder') ||
        schedule.steps.some(
          (step) => step.workingDirectory === query.get('folder'),
        )) &&
      (!query.get('status') ||
        (schedule.completed
          ? 'completed'
          : schedule.enabled
            ? 'enabled'
            : 'paused') === query.get('status')) &&
      `${schedule.name} ${schedule.projectName ?? 'No project'} ${schedule.steps.map((step) => `${step.name} ${step.workingDirectory}`).join(' ')}`
        .toLowerCase()
        .includes(search),
  );
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-3 py-5 sm:px-4 lg:py-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Automations</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Work that runs later or repeats. Projects are optional.
          </p>
        </div>
        <Button asChild className="rounded-full">
          <Link
            to={`/schedules/new${projectId && projectId !== 'none' ? `?projectId=${projectId}` : ''}`}
          >
            <Icon name="plus" />
            New automation
          </Link>
        </Button>
      </header>
      <WorkFilters
        projects={projects}
        paths={[
          ...new Set(
            schedules.flatMap((schedule) =>
              schedule.steps.map((step) => step.workingDirectory),
            ),
          ),
        ]}
        statuses={['enabled', 'paused', 'completed']}
      />
      <p className="mb-4 text-xs text-muted-foreground" role="status">
        {visible.length} {visible.length === 1 ? 'automation' : 'automations'}
      </p>
      <ScheduleList schedules={visible} />
    </main>
  );
}
