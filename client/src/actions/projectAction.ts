import type { ActionFunctionArgs } from 'react-router';
import { api } from '../lib/api';

export async function projectsAction({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  const intent = form.get('intent');
  if (intent !== 'rename' && intent !== 'delete')
    return { error: 'Invalid project action.' };
  try {
    if (intent === 'delete') {
      await api(
        `/projects/${encodeURIComponent(String(form.get('projectId')))}`,
        request.signal,
        'DELETE',
        { sessionDisposition: form.get('sessionDisposition') },
      );
      return { deleted: true };
    }
    await api(
      `/projects/${encodeURIComponent(String(form.get('projectId')))}`,
      request.signal,
      'PATCH',
      { name: form.get('name') },
    );
    return { saved: true };
  } catch (error) {
    if (request.signal.aborted) throw error;
    return {
      error:
        error instanceof Error ? error.message : 'Could not update project.',
    };
  }
}
