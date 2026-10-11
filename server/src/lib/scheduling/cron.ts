import { CronExpressionParser } from 'cron-parser';
export function validTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}
export function cronDates(
  cron: string,
  timezone: string,
  now: Date,
  count = 5,
) {
  if (cron.trim().split(/\s+/).length !== 5 || cron.includes('H'))
    throw new Error('Enter a five-field cron expression, such as 0 9 * * 1-5.');
  if (!validTimezone(timezone))
    throw new Error('Choose a valid IANA timezone.');
  const expression = CronExpressionParser.parse(cron, {
    tz: timezone,
    currentDate: now,
  });
  return Array.from({ length: count }, () =>
    expression.next().toDate().toISOString(),
  );
}
