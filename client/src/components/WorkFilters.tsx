import { useSearchParams } from 'react-router';
import { ChevronDown, Folder, Search, X } from 'lucide-react';
import type { Project } from '../lib/projects';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

const statusLabels: Record<string, string> = {
  running: 'Running',
  queued: 'Queued',
  stopping: 'Stopping',
  exited: 'Ended',
  interrupted: 'Interrupted',
  succeeded: 'Succeeded',
  failed: 'Failed',
  cancelled: 'Cancelled',
  timed_out: 'Timed out',
  skipped: 'Skipped',
  enabled: 'Active',
  paused: 'Paused',
  completed: 'Completed',
};

export default function WorkFilters({
  projects,
  paths = [],
  statuses,
  grouping = false,
}: {
  projects: Project[];
  paths?: string[];
  statuses: string[];
  grouping?: boolean;
}) {
  const [query, setQuery] = useSearchParams();
  const change = (key: string, value: string) => {
    const next = new URLSearchParams(query);
    if (value) next.set(key, value);
    else next.delete(key);
    void setQuery(next, { replace: true, preventScrollReset: true });
  };
  const filtered = ['q', 'projectId', 'folder', 'status'].some((key) =>
    query.get(key),
  );
  const folder = query.get('folder');
  const reset = () => {
    const next = new URLSearchParams(query);
    for (const key of ['q', 'projectId', 'folder', 'status']) next.delete(key);
    void setQuery(next, { replace: true, preventScrollReset: true });
  };
  const chip = (key: string, value: string, label: string, project = false) => {
    const selected = (query.get(key) ?? '') === value;
    return (
      <Button
        key={value}
        type="button"
        size="sm"
        variant={selected ? (project ? 'default' : 'secondary') : 'ghost'}
        title={label}
        aria-pressed={selected}
        onClick={() => change(key, value)}
        className={cn(
          'h-8 max-w-full rounded-full px-3',
          !selected && 'text-muted-foreground',
        )}
      >
        <span className="truncate">{label}</span>
      </Button>
    );
  };
  return (
    <div className="mb-5 space-y-4">
      <div
        role="group"
        aria-label="Filter by project"
        className="flex flex-wrap gap-1.5 border-b pb-4"
      >
        {chip('projectId', '', 'All', true)}
        {projects.map((project) =>
          chip('projectId', String(project.id), project.name, true),
        )}
        {chip('projectId', 'none', 'No project', true)}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-40 flex-1 sm:max-w-sm">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground"
          />
          <Input
            type="search"
            aria-label="Search work"
            placeholder="Search by name or folder…"
            value={query.get('q') ?? ''}
            onChange={(event) => change('q', event.target.value)}
            className="h-9 rounded-xl border-border bg-muted/20 pl-9"
          />
        </div>
        {filtered && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={reset}
            className="text-muted-foreground"
          >
            <X />
            Clear filters
          </Button>
        )}
        {grouping && (
          <div
            role="group"
            aria-label="Group sessions"
            className="flex max-w-full flex-wrap gap-1 rounded-xl border p-1 sm:ml-auto"
          >
            {chip('group', '', 'Recent')}
            {chip('group', 'project', 'By project')}
            {chip('group', 'folder', 'By folder')}
          </div>
        )}
      </div>
      <div
        role="group"
        aria-label="Filter by status"
        className="flex flex-wrap items-center gap-1"
      >
        <span className="mr-2 text-xs font-medium text-muted-foreground">
          Status
        </span>
        {chip('status', '', 'All')}
        {statuses.map((status) =>
          chip('status', status, statusLabels[status] ?? status),
        )}
      </div>
      {paths.length > 0 && (
        <Collapsible defaultOpen={Boolean(folder)} className="space-y-2">
          <div className="flex min-w-0 items-center gap-2">
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="group rounded-full text-muted-foreground"
              >
                <Folder />
                Folders
                <ChevronDown className="transition-transform group-data-[state=open]:rotate-180" />
              </Button>
            </CollapsibleTrigger>
            {folder && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="min-w-0 max-w-full rounded-full"
                onClick={() => change('folder', '')}
                title={`Clear folder filter: ${folder}`}
                aria-label={`Clear folder filter: ${folder}`}
              >
                <span className="truncate font-mono text-xs">{folder}</span>
                <X />
              </Button>
            )}
          </div>
          <CollapsibleContent>
            <div
              role="group"
              aria-label="Filter by folder"
              className="flex flex-wrap gap-1.5 rounded-xl border bg-muted/10 p-2"
            >
              {chip('folder', '', 'All folders')}
              {paths.map((path) => (
                <Button
                  key={path}
                  type="button"
                  variant={folder === path ? 'secondary' : 'ghost'}
                  size="sm"
                  aria-pressed={folder === path}
                  onClick={() => change('folder', path)}
                  title={path}
                  className="h-auto min-h-8 max-w-full rounded-lg px-3 py-1.5 text-left font-mono text-xs"
                >
                  <span className="break-all whitespace-normal">{path}</span>
                </Button>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
