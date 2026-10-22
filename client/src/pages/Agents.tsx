import { Card } from '@/components/ui/card';
import Icon from '../components/Icon';
import { Link, useLoaderData, type LoaderFunctionArgs } from 'react-router';
import type { Agent } from '../types/agent';
export async function agentsLoader({ request }: LoaderFunctionArgs) {
  const response = await fetch('/api/agents', { signal: request.signal });
  if (!response.ok) throw new Error('Could not load agents. Please try again.');
  return (await response.json()) as Agent[];
}
export default function Agents() {
  const agents = useLoaderData<typeof agentsLoader>();
  return (
    <main className="mx-auto min-h-0 w-full max-w-5xl flex-1 px-3 py-5 sm:px-4 lg:py-6">
      <header className="mb-8 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Agents
          </h1>
          <Link
            to="/agents/new"
            className="inline-flex h-9 items-center justify-center gap-2 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80"
          >
            New agent
          </Link>
        </div>
        <p className="text-sm leading-6 text-muted-foreground">
          Reusable roles and instructions for sessions with any provider.
        </p>
      </header>
      {agents.length ? (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {agents.map((agent) => (
            <li
              key={agent.id}
              className="relative flex min-w-0 flex-col gap-4 rounded-2xl border bg-card/50 p-4 transition-colors hover:bg-card"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border bg-muted/50">
                    <Icon name="agent" />
                  </span>
                  <h2 className="text-base font-semibold">
                    <Link to={`/agents/${agent.id}`}>{agent.name}</Link>
                  </h2>
                </div>
              </div>
              <p className="line-clamp-3 text-sm leading-6 text-muted-foreground whitespace-pre-wrap break-words">
                {agent.instructions}
              </p>
              {agent.skills.length > 0 && (
                <p className="text-xs leading-5 text-muted-foreground">
                  Skills: {agent.skills.map((skill) => skill.name).join(', ')}
                </p>
              )}
              <div className="flex flex-wrap gap-4 border-t pt-4 text-xs text-muted-foreground [&>span]:flex [&>span]:items-center [&>span]:gap-1.5 [&_svg]:size-3.5">
                <span>
                  <Icon name="skills" />
                  {agent.skills.length} skills
                </span>
              </div>
              <Link
                to={`/agents/${agent.id}`}
                className="mt-auto inline-flex items-center gap-2 text-xs font-medium text-foreground underline-offset-4 hover:underline"
              >
                Edit agent
              </Link>
              <Link
                to={`/usage?agentId=${agent.id}`}
                className="text-xs font-medium underline-offset-4 hover:underline"
              >
                View usage
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <Card className="mb-6 space-y-5 rounded-2xl border bg-card/40 p-4">
          <h2 className="text-base font-semibold">No agents yet</h2>
          <p className="text-sm leading-6 text-muted-foreground">
            Create an agent, then select it when starting a session in a
            project.
          </p>
          <Link to="/agents/new">Create your first agent</Link>
        </Card>
      )}
    </main>
  );
}
