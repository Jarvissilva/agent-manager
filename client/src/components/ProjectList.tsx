import { useId, useState } from 'react';
import { Link, useFetcher } from 'react-router';
import { Pencil, Search } from 'lucide-react';
import type { Project } from '../lib/projects';
import Icon from './Icon';
import DeleteProjectButton from './DeleteProjectButton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function ProjectRow({ project }: { project: Project }) {
  const [editing, setEditing] = useState(false);
  const fetcher = useFetcher<{ saved?: boolean; error?: string }>();
  const inputId = useId();
  const busy = fetcher.state !== 'idle';
  const [previousResult, setPreviousResult] = useState(fetcher.data);
  if (fetcher.state === 'idle' && fetcher.data !== previousResult) {
    setPreviousResult(fetcher.data);
    if (fetcher.data?.saved) setEditing(false);
  }
  return (
    <li className="flex min-w-0 items-start gap-3 rounded-2xl border bg-card/40 p-4">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted/60">
        <Icon name="folder" />
      </div>
      {editing ? (
        <fetcher.Form
          method="post"
          action="/projects"
          className="min-w-0 flex-1 space-y-3"
        >
          <input type="hidden" name="intent" value="rename" />
          <input type="hidden" name="projectId" value={project.id} />
          <div className="space-y-2">
            <Label htmlFor={inputId}>Project name</Label>
            <Input
              id={inputId}
              name="name"
              defaultValue={project.name}
              required
              maxLength={100}
              disabled={busy}
              autoFocus
            />
          </div>
          {fetcher.data?.error && (
            <p role="alert" className="text-sm text-destructive">
              {fetcher.data.error}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
          </div>
        </fetcher.Form>
      ) : (
        <div className="min-w-0 flex-1">
          <h3 className="break-words text-sm font-medium">{project.name}</h3>
          <div className="mt-2 flex flex-wrap gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Edit ${project.name}`}
              onClick={() => setEditing(true)}
            >
              <Pencil />
              Edit
            </Button>
            <DeleteProjectButton project={project} />
          </div>
        </div>
      )}
    </li>
  );
}

export default function ProjectList({ projects }: { projects: Project[] }) {
  const [search, setSearch] = useState('');
  const visible = projects.filter((project) =>
    project.name.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {projects.length} {projects.length === 1 ? 'project' : 'projects'}
        </p>
        <Button asChild className="rounded-full">
          <Link to="/projects/new">
            <Icon name="plus" />
            Add project
          </Link>
        </Button>
      </div>
      {projects.length > 0 && (
        <div className="relative mb-5 sm:max-w-sm">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground"
          />
          <Input
            type="search"
            aria-label="Search projects"
            placeholder="Find a project…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-9 rounded-xl pl-9"
          />
        </div>
      )}
      {visible.length ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {visible.map((project) => (
            <ProjectRow key={project.id} project={project} />
          ))}
        </ul>
      ) : (
        <div className="rounded-2xl border border-dashed px-4 py-10 text-center">
          <Icon
            name={search ? 'search' : 'folder'}
            className="mx-auto mb-4 size-7 text-muted-foreground"
          />
          <h2 className="text-base font-medium">
            {search ? 'No matching projects' : 'No projects yet'}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {search
              ? 'Try another name.'
              : 'Add your first project to get started.'}
          </p>
        </div>
      )}
    </>
  );
}
