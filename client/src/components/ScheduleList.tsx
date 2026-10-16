import { Link } from 'react-router';
import type { Schedule } from '../types/schedule';
import StatusBadge from './StatusBadge';
export default function ScheduleList({ schedules }: { schedules: Schedule[] }) {
  return schedules.length ? (
    <ul className="space-y-3">
      {schedules.map((schedule) => (
        <li
          key={schedule.id}
          className="space-y-3 rounded-2xl border bg-card/40 p-4"
        >
          <div className="flex items-center justify-between gap-3">
            <Link
              to={`/schedules/${schedule.id}`}
              className="font-medium hover:underline"
            >
              {schedule.name}
            </Link>
            <StatusBadge
              status={
                schedule.completed
                  ? 'completed'
                  : schedule.enabled
                    ? 'enabled'
                    : 'paused'
              }
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {schedule.projectName ?? 'No project'} ·{' '}
            {schedule.kind === 'cron'
              ? `${schedule.cron} · ${schedule.timezone}`
              : 'One time'}{' '}
            · Next:{' '}
            {schedule.nextRunAt
              ? new Date(schedule.nextRunAt).toLocaleString()
              : 'None'}
          </p>
          <p className="line-clamp-2 text-sm text-muted-foreground">
            {schedule.steps.map((step) => step.name).join(' → ')}
          </p>
          <p
            className="truncate font-mono text-xs text-muted-foreground"
            title={schedule.steps
              .map((step) => step.workingDirectory)
              .join('\n')}
          >
            {[
              ...new Set(schedule.steps.map((step) => step.workingDirectory)),
            ].join(' · ')}
          </p>
        </li>
      ))}
    </ul>
  ) : (
    <p className="py-10 text-center text-sm text-muted-foreground">
      No automations found.
    </p>
  );
}
