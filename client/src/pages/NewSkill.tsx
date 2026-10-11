import SkillImport from '../components/SkillImport';
import { Card } from '@/components/ui/card';
import { useActionData, useNavigation } from 'react-router';
import SkillForm from '../components/SkillForm';
import skillAction from '../actions/skillAction';
export const newSkillAction = skillAction;
export default function NewSkill() {
  const data = useActionData<typeof newSkillAction>();
  const navigation = useNavigation();
  return (
    <main className="mx-auto min-h-0 w-full max-w-3xl flex-1 px-3 py-5 sm:px-4 lg:py-6">
      <header className="mb-8 space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          New skill
        </h1>
        <p className="text-sm leading-6 text-muted-foreground">
          Define a reusable procedure for your agents.
        </p>
      </header>
      <Card className="mb-6 space-y-5 rounded-2xl border bg-card/40 p-4">
        <SkillForm busy={navigation.state !== 'idle'} error={data?.error} />
      </Card>
      <SkillImport busy={navigation.state !== 'idle'} />
    </main>
  );
}
