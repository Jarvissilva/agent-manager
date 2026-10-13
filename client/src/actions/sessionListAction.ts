import { redirect, type ActionFunctionArgs } from 'react-router';
import { api } from '../lib/api';

export async function sessionListAction({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  if (form.get('intent') !== 'delete')
    return { error: 'Invalid session action.' };
  const id = form.get('sessionId');
  if (typeof id !== 'string' || !id) return { error: 'Choose a session.' };
  try {
    await api(`/sessions/${encodeURIComponent(id)}`, request.signal, 'DELETE');
    return form.get('redirectToList') === 'true'
      ? redirect('/sessions')
      : { deleted: true };
  } catch (error) {
    if (request.signal.aborted) throw error;
    return {
      error:
        error instanceof Error ? error.message : 'Could not delete session.',
    };
  }
}
