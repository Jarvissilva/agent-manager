import { Card } from '@/components/ui/card';
import { Link, useLoaderData, type LoaderFunctionArgs } from 'react-router';
import type { Skill } from '../types/skill';
export async function skillsLoader({ request }: LoaderFunctionArgs) {
  const response = await fetch('/api/skills', { signal: request.signal });
  if (!response.ok) throw new Error('Could not load skills. Please try again.');
  return (await response.json()) as Skill[];
}
export default function Skills() {
  const skills = useLoaderData<typeof skillsLoader>();
  return (
    <main className="mx-auto min-h-0 w-full max-w-5xl flex-1 px-3 py-5 sm:px-4 lg:py-6">
      <header className="mb-8 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Skills
          </h1>
          <Link
            to="/skills/new"
            className="inline-flex h-9 items-center justify-center gap-2 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80"
          >
            New skill
          </Link>
        </div>
        <p className="text-sm leading-6 text-muted-foreground">
          Native workflows available across your local providers. Agent
          assignments suggest relevant skills.
        </p>
      </header>
      {skills.length ? (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {skills.map((skill) => (
            <li
              key={skill.id}
              className="relative flex min-w-0 flex-col gap-4 rounded-2xl border bg-card/50 p-4 transition-colors hover:bg-card"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-base font-semibold">
                  <Link to={`/skills/${skill.id}`}>{skill.name}</Link>
                </h2>
              </div>
              <p className="line-clamp-3 text-sm leading-6 text-muted-foreground whitespace-pre-wrap break-words">
                {skill.description}
              </p>
              <p className="text-xs text-muted-foreground">
                {skill.nativeName} · {skill.source}
              </p>
              {(skill.error ||
                skill.publications.some((item) => item.error)) && (
                <p role="alert" className="text-xs text-destructive">
                  {skill.error ??
                    'Some providers could not discover this skill. Open for details.'}
                </p>
              )}
              <Link
                to={`/skills/${skill.id}`}
                className="mt-auto inline-flex items-center gap-2 text-xs font-medium text-foreground underline-offset-4 hover:underline"
              >
                View skill
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <Card className="mb-6 space-y-5 rounded-2xl border bg-card/40 p-4">
          <h2 className="text-base font-semibold">No skills yet</h2>
          <p className="text-sm leading-6 text-muted-foreground">
            Create a skill, then attach it to an agent for sessions in a
            project.
          </p>
          <Link to="/skills/new">Create your first skill</Link>
        </Card>
      )}
    </main>
  );
}
