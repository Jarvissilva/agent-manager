import { Card } from '@/components/ui/card';
import { useActionData, useNavigation, useLoaderData } from 'react-router';
import AgentForm from '../components/AgentForm';
import agentAction from '../actions/agentAction';
import { skillsLoader } from './Skills';
import type { LoaderFunctionArgs } from 'react-router';
export async function newAgentLoader(args: LoaderFunctionArgs) {
  return { skills: await skillsLoader(args) };
}
export const newAgentAction = agentAction;
export default function NewAgent() {
  const data = useActionData<typeof newAgentAction>();
  const navigation = useNavigation();
  const { skills } = useLoaderData<typeof newAgentLoader>();
  return (
    <main className="mx-auto min-h-0 w-full max-w-3xl flex-1 px-3 py-5 sm:px-4 lg:py-6">
      <header className="mb-8 space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          New agent
        </h1>
        <p className="text-sm leading-6 text-muted-foreground">
          Define a reusable role for your agent provider.
        </p>
      </header>
      <Card className="mb-6 space-y-5 rounded-2xl border bg-card/40 p-4">
        <AgentForm
          skills={skills}
          busy={navigation.state !== 'idle'}
          error={data?.error}
        />
      </Card>
    </main>
  );
}
