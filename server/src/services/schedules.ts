import { database } from '../lib/database.js';
import { cronDates } from '../lib/scheduling/cron.js';
import { advanceSchedule, dueSchedules } from '../repositories/schedules.js';
import {
  dispatchScheduledSessions,
  initializeScheduledSessions,
  enqueueSchedule,
  stopScheduledSessions,
} from './scheduledSessions.js';

export function tickSchedules(now = new Date()) {
  for (const schedule of dueSchedules(now.toISOString())) {
    const next =
      schedule.kind === 'cron'
        ? cronDates(schedule.cron!, schedule.timezone, now, 1)[0]
        : null;
    database.exec('BEGIN');
    try {
      enqueueSchedule(schedule);
      advanceSchedule(schedule.id, next, now.toISOString());
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
}
let timer: ReturnType<typeof setInterval> | undefined;
export function startScheduler() {
  if (timer) return;
  initializeScheduledSessions();
  const tick = () => {
    try {
      tickSchedules();
    } catch (error) {
      console.error('Scheduler tick failed:', error);
    }
    void dispatchScheduledSessions().catch((error) =>
      console.error('Queue dispatch failed:', error),
    );
  };
  tick();
  timer = setInterval(tick, 1000);
  timer.unref();
}
export function stopScheduler() {
  clearInterval(timer);
  timer = undefined;
  stopScheduledSessions();
}
