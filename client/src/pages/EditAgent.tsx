import DeleteButton from '../components/DeleteButton';
import { Card } from '@/components/ui/card';
import {
  useLoaderData,
  useActionData,
  useNavigation,
  type LoaderFunctionArgs,
} from 'react-router';
import AgentForm from '../components/AgentForm';
import agentAction from '../actions/agentAction';
import type { Agent } from '../types/agent';
import { skillsLoader } from './Skills';
export const editAgentAction = agentAction;
export async function agentLoader(args: LoaderFunctionArgs) {
  const { params, request } = args;
  const [response, skills] = await Promise.all([
    fetch(`/api/agents/${params.agentId}`, { signal: request.signal }),
    skillsLoader(args),
  ]);
  if (response.status === 404)
    throw new Response('Agent not found', {
      status: 404,
      statusText: 'Agent not found',
    });
  if (!response.ok)
    throw new Error('Could not load the agent. Please try again.');
  return { agent: (await response.json()) as Agent, skills };
}
export default function EditAgent() {
  const { agent, skills } = useLoaderData<typeof agentLoader>();
  const data = useActionData<typeof editAgentAction>();
  const navigation = useNavigation();
  const busy = navigation.state !== 'idle';
  return (
    <main className="mx-auto min-h-0 w-full max-w-3xl flex-1 px-3 py-5 sm:px-4 lg:py-6">
      <header className="mb-8 space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Edit {agent.name}
        </h1>
        <p className="text-sm leading-6 text-muted-foreground">
          Update the configuration used for new sessions.
        </p>
      </header>
      <Card className="mb-6 space-y-5 rounded-2xl border bg-card/40 p-4">
        <AgentForm
          key={agent.id}
          agent={agent}
          skills={skills}
          busy={busy}
          error={data?.error}
        />
      </Card>
      <Card
        aria-labelledby="delete-agent-title"
        className="mb-6 space-y-5 rounded-2xl border bg-card/40 p-4"
      >
        <h2 id="delete-agent-title" className="text-base font-semibold">
          Delete agent
        </h2>
        <p className="text-sm leading-6 text-muted-foreground">
          Existing sessions keep their saved agent name and instructions.
        </p>
        <DeleteButton
          name={agent.name}
          label="Delete agent"
          description="Existing sessions keep their saved agent name and instructions."
          busy={busy}
        />
      </Card>
    </main>
  );
}
