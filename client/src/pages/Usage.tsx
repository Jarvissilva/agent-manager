import {
  Form,
  Link,
  useLoaderData,
  useSearchParams,
  type LoaderFunctionArgs,
} from 'react-router';
import { api } from '../lib/api';
import type { UsageReport } from '../types/usage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Label } from '@/components/ui/label';
import useLiveRefresh from '../hooks/useLiveRefresh';

export async function usageLoader({ request }: LoaderFunctionArgs) {
  return api<UsageReport>(
    '/usage' + new URL(request.url).search,
    request.signal,
  );
}
const number = (n: number | null) =>
  n === null ? 'Unavailable' : n.toLocaleString();
export default function Usage() {
  const report = useLoaderData<typeof usageLoader>();
  const [query] = useSearchParams();
  useLiveRefresh(true);
  const todayParts = new Intl.DateTimeFormat('en-US', {
    timeZone: report.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const today = ['year', 'month', 'day']
    .map((type) => todayParts.find((p) => p.type === type)!.value)
    .join('-');
  const range = (days: number) => {
    const start = new Date(`${today}T00:00:00Z`);
    start.setUTCDate(start.getUTCDate() - days + 1);
    const next = new URLSearchParams(query);
    next.set('from', start.toISOString().slice(0, 10));
    next.set('to', today);
    return `/usage?${next}`;
  };
  const maximum = Math.max(1, ...report.daily.map((day) => day.total ?? 0));
  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-3 py-5 sm:px-4">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Usage</h1>
        <p className="text-sm text-muted-foreground">
          Provider-reported tokens recorded by Agent Manager. Days use{' '}
          {report.timezone}.{' '}
          <Link className="underline" to="/settings">
            Change timezone
          </Link>
        </p>
        <p className="text-xs text-muted-foreground">
          Tracking starts when this feature is installed. Historical
          conversations and unreported usage are unavailable. Totals follow each
          provider’s accounting; cached and reasoning details are not added
          again.
        </p>
      </header>
      <div className="flex gap-2">
        {[
          [1, 'Today'],
          [7, '7 days'],
          [30, '30 days'],
        ].map(([days, label]) => (
          <Button key={days} asChild variant="outline" size="sm">
            <Link to={range(Number(days))}>{label}</Link>
          </Button>
        ))}
      </div>
      <Form
        key={query.toString()}
        method="get"
        className="grid gap-3 rounded-2xl border p-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        <div className="space-y-2">
          <Label htmlFor="usage-from">From</Label>
          <Input
            id="usage-from"
            type="date"
            name="from"
            defaultValue={report.from}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="usage-to">To</Label>
          <Input
            id="usage-to"
            type="date"
            name="to"
            defaultValue={report.to}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="usage-agent">Agent</Label>
          <NativeSelect
            id="usage-agent"
            name="agentId"
            defaultValue={query.get('agentId') ?? ''}
          >
            <option value="">All agents</option>
            <option value="none">No agent</option>
            {query.get('agentId') &&
              query.get('agentId') !== 'none' &&
              !report.agents.some(
                (a) => String(a.id) === query.get('agentId'),
              ) && (
                <option value={query.get('agentId')!}>Selected agent</option>
              )}
            {report.agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-2">
          <Label htmlFor="usage-provider">Provider</Label>
          <NativeSelect
            id="usage-provider"
            name="provider"
            defaultValue={query.get('provider') ?? ''}
          >
            <option value="">All providers</option>
            <option value="codex">Codex</option>
            <option value="antigravity">Antigravity</option>
            <option value="opencode">OpenCode</option>
          </NativeSelect>
        </div>
        <div className="space-y-2">
          <Label htmlFor="usage-model">Model</Label>
          <NativeSelect
            id="usage-model"
            name="model"
            defaultValue={query.get('model') ?? ''}
          >
            <option value="">All models</option>
            {report.models.map((model) => (
              <option key={model}>{model}</option>
            ))}
          </NativeSelect>
        </div>
        {query.get('sessionId') && (
          <input
            type="hidden"
            name="sessionId"
            value={query.get('sessionId')!}
          />
        )}
        <Button className="self-end">Apply filters</Button>
      </Form>
      <section aria-label="Token totals" className="grid gap-3 sm:grid-cols-3">
        {(['input', 'output', 'total'] as const).map((key) => (
          <div key={key} className="rounded-2xl border p-4">
            <p className="text-sm capitalize text-muted-foreground">
              {key} tokens
            </p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">
              {number(report[key])}
            </p>
          </div>
        ))}
      </section>
      <p role="status" className="text-sm text-muted-foreground">
        {report.coverage === 'reported'
          ? 'Reported usage'
          : report.coverage === 'partial'
            ? 'Partial coverage — totals include only reported consumption.'
            : 'Usage unavailable for this selection.'}{' '}
        {report.missingTurns > 0 &&
          `${report.missingTurns} turns without usage. `}
        {report.partialTurns > 0 &&
          `${report.partialTurns} turns with partial reporting. `}
        {report.unavailableSessions > 0 &&
          `${report.unavailableSessions} sessions without tracking.`}
      </p>
      <section className="space-y-3 rounded-2xl border p-4">
        <h2 className="text-lg font-medium">Daily tokens</h2>
        <div className="overflow-x-auto">
          <div
            role="img"
            aria-label={`Daily total tokens from ${report.from} to ${report.to}; each bar has its date and total.`}
            className="flex h-48 items-end gap-1 border-b pb-1"
            style={{ minWidth: Math.max(280, report.daily.length * 12) }}
          >
            {report.daily.map((day) => (
              <div
                key={day.day}
                className="flex h-full min-w-2 flex-1 items-end"
                title={`${day.day}: ${number(day.total)} tokens`}
              >
                <div
                  className={
                    day.total === null
                      ? 'w-full border-b border-dashed border-muted-foreground'
                      : 'w-full rounded-t bg-primary/70'
                  }
                  style={{
                    height:
                      day.total === null
                        ? '1px'
                        : `${Math.max(day.total > 0 ? 1 : 0, (day.total / maximum) * 100)}%`,
                  }}
                />
              </div>
            ))}
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{report.from}</span>
            <span>{report.to}</span>
          </div>
          <details>
            <summary className="cursor-pointer text-sm">Daily values</summary>
            <ul className="mt-3 max-h-64 overflow-auto text-sm">
              {report.daily.map((day) => (
                <li key={day.day} className="flex justify-between gap-4 py-1">
                  <span>{day.day}</span>
                  <span>{number(day.total)}</span>
                </li>
              ))}
            </ul>
          </details>
        </div>
      </section>
      <section className="space-y-3">
        <h2 className="text-lg font-medium">By agent, provider, and model</h2>
        <div className="overflow-x-auto rounded-2xl border">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b">
                {[
                  'Agent',
                  'Provider / model',
                  'Sessions',
                  'Input',
                  'Output',
                  'Total',
                  'Cached read',
                  'Cache write',
                  'Reasoning',
                ].map((label) => (
                  <th
                    key={label}
                    scope="col"
                    className="whitespace-nowrap p-3 font-medium"
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.breakdown.map((row, index) => (
                <tr key={index} className="border-b last:border-0">
                  <td className="p-3">{row.agentName ?? 'No agent'}</td>
                  <td className="p-3">
                    {row.provider}
                    <br />
                    <span className="text-xs text-muted-foreground">
                      {row.model ?? 'Unknown model'}
                    </span>
                  </td>
                  <td className="p-3">{row.sessions}</td>
                  {(
                    [
                      'input',
                      'output',
                      'total',
                      'cached',
                      'cacheWrite',
                      'reasoning',
                    ] as const
                  ).map((key) => (
                    <td key={key} className="p-3 tabular-nums">
                      {number(row[key])}
                    </td>
                  ))}
                </tr>
              ))}
              {!report.breakdown.length && (
                <tr>
                  <td colSpan={9} className="p-6 text-muted-foreground">
                    No reported usage in this range.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
