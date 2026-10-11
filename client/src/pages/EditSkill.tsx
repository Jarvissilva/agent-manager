import DeleteButton from '../components/DeleteButton';
import { Card } from '@/components/ui/card';
import {
  useLoaderData,
  useActionData,
  useNavigation,
  type LoaderFunctionArgs,
} from 'react-router';
import SkillForm from '../components/SkillForm';
import skillAction from '../actions/skillAction';
import type { Skill } from '../types/skill';
export const editSkillAction = skillAction;
export async function skillLoader({ params, request }: LoaderFunctionArgs) {
  const response = await fetch(`/api/skills/${params.skillId}`, {
    signal: request.signal,
  });
  if (response.status === 404)
    throw new Response('Skill not found', {
      status: 404,
      statusText: 'Skill not found',
    });
  if (!response.ok)
    throw new Error('Could not load the skill. Please try again.');
  return (await response.json()) as Skill;
}
export default function EditSkill() {
  const skill = useLoaderData<typeof skillLoader>();
  const data = useActionData<typeof editSkillAction>();
  const navigation = useNavigation();
  const busy = navigation.state !== 'idle';
  return (
    <main className="mx-auto min-h-0 w-full max-w-3xl flex-1 px-3 py-5 sm:px-4 lg:py-6">
      <header className="mb-8 space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Edit {skill.name}
        </h1>
        <p className="text-sm leading-6 text-muted-foreground">
          Manage the native skill and its provider discovery status.
        </p>
      </header>
      <Card className="mb-6 space-y-5 rounded-2xl border bg-card/40 p-4">
        <SkillForm
          key={skill.id}
          skill={skill}
          busy={busy}
          error={data?.error}
        />
      </Card>
      <Card
        aria-labelledby="delete-skill-title"
        className="mb-6 space-y-5 rounded-2xl border bg-card/40 p-4"
      >
        <h2 id="delete-skill-title" className="text-base font-semibold">
          Delete skill
        </h2>
        <p className="text-sm leading-6 text-muted-foreground">
          Unregisters the skill and removes app-owned provider links or copies.
          Original files are kept.
        </p>
        <DeleteButton
          name={skill.name}
          label="Delete skill"
          description="Unregisters the skill and removes app-owned provider links or copies. Original files are kept."
          busy={busy}
        />
      </Card>
    </main>
  );
}
