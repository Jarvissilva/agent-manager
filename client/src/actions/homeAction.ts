import { redirect, type ActionFunctionArgs } from 'react-router';
import { api } from '../lib/api';
import type { Session } from '../types/session';

export async function homeAction({ request }: ActionFunctionArgs) {
  const form = await request.formData();
  try {
    const { session, defaultsNotice } = await api<{
      session: Session;
      defaultsNotice?: string;
    }>('/sessions', request.signal, 'POST', {
      transport: 'chat',
      provider: form.get('provider') ?? 'codex',
      projectId: form.get('projectId') ? Number(form.get('projectId')) : null,
      workingDirectory: form.get('workingDirectory'),
    });
    return redirect(
      `/sessions/${session.id}${defaultsNotice ? `?defaultsNotice=${encodeURIComponent(defaultsNotice)}` : ''}`,
    );
  } catch (error) {
    if (request.signal.aborted) throw error;
    return {
      error:
        error instanceof Error ? error.message : 'Could not start session.',
    };
  }
}
