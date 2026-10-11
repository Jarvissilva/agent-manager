import { api } from '../lib/api';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Form,
  useActionData,
  useNavigation,
  redirect,
  type ActionFunctionArgs,
} from 'react-router';
export async function newProjectAction({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  try {
    await api('/projects', request.signal, 'POST', { name: form.get('name') });
    return redirect('/projects');
  } catch (error) {
    if (request.signal.aborted) throw error;
    return {
      error: error instanceof Error ? error.message : 'Could not add project.',
    };
  }
}
export default function NewProject() {
  const data = useActionData<typeof newProjectAction>();
  const busy = useNavigation().state !== 'idle';
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-3 py-5 sm:px-4 lg:py-6">
      <header className="mb-8 space-y-3">
        <h1 className="text-2xl font-semibold">New project</h1>
        <p className="text-sm text-muted-foreground">
          Group your sessions and scheduled work. Choose a folder when starting
          a session.
        </p>
      </header>
      <Card className="p-4">
        <Form method="post" className="grid gap-3">
          <Label htmlFor="project-name">Name</Label>
          <Input
            id="project-name"
            name="name"
            placeholder="Acme"
            required
            maxLength={100}
            disabled={busy}
          />
          <Button disabled={busy} className="justify-self-start">
            {busy ? 'Adding…' : 'Add project'}
          </Button>
          {data?.error && (
            <p role="alert" className="text-sm text-destructive">
              {data.error}
            </p>
          )}
        </Form>
      </Card>
    </main>
  );
}
