import { redirect, type ActionFunctionArgs } from 'react-router';
import type { Skill } from '../types/skill';

export default async function skillAction({
  request,
  params,
}: ActionFunctionArgs) {
  const form = await request.formData();
  const intent = form.get('intent');
  if (intent !== 'save' && intent !== 'delete' && intent !== 'import')
    return { error: 'Invalid skill action.' };
  if (intent === 'delete' && !params.skillId)
    return { error: 'Choose a skill to delete.' };
  try {
    const response = await fetch(
      intent === 'import'
        ? '/api/skills/import'
        : params.skillId
          ? `/api/skills/${params.skillId}`
          : '/api/skills',
      {
        method:
          intent === 'delete' ? 'DELETE' : params.skillId ? 'PUT' : 'POST',
        headers:
          intent !== 'delete'
            ? { 'Content-Type': 'application/json' }
            : undefined,
        body:
          intent !== 'delete'
            ? JSON.stringify(
                intent === 'import'
                  ? { path: form.get('path') }
                  : {
                      nativeName: form.get('nativeName'),
                      description: form.get('description'),
                      name: form.get('name'),
                      instructions: form.get('instructions'),
                    },
              )
            : undefined,
        signal: request.signal,
      },
    );
    if (response.status === 204 && intent === 'delete')
      return redirect('/skills');
    const result: Skill | { error: string } = await response.json();
    if (!response.ok)
      return {
        error:
          'error' in result && result.error
            ? result.error
            : 'Could not save skill.',
      };
    return redirect('/skills');
  } catch (error) {
    if (request.signal.aborted) throw error;
    return {
      error:
        intent === 'delete'
          ? 'Could not delete skill. Please try again.'
          : 'Could not save skill. Please try again.',
    };
  }
}
