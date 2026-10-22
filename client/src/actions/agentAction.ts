import { redirect, type ActionFunctionArgs } from 'react-router';
import type { Agent } from '../types/agent';

export default async function agentAction({
  request,
  params,
}: ActionFunctionArgs) {
  const form = await request.formData();
  const intent = form.get('intent');
  if (intent !== 'save' && intent !== 'delete')
    return { error: 'Invalid agent action.' };
  if (intent === 'delete' && !params.agentId)
    return { error: 'Choose an agent to delete.' };
  try {
    const response = await fetch(
      params.agentId ? `/api/agents/${params.agentId}` : '/api/agents',
      {
        method:
          intent === 'delete' ? 'DELETE' : params.agentId ? 'PUT' : 'POST',
        headers:
          intent === 'save'
            ? { 'Content-Type': 'application/json' }
            : undefined,
        body:
          intent === 'save'
            ? JSON.stringify({
                name: form.get('name'),
                instructions: form.get('instructions'),
                skillIds: form.getAll('skillIds').map(Number),
              })
            : undefined,
        signal: request.signal,
      },
    );
    if (response.status === 204 && intent === 'delete')
      return redirect('/agents');
    const result: Agent | { error: string } = await response.json();
    if (!response.ok || 'error' in result)
      return {
        error: 'error' in result ? result.error : 'Could not save agent.',
      };
    return redirect('/agents');
  } catch (error) {
    if (request.signal.aborted) throw error;
    return {
      error:
        intent === 'delete'
          ? 'Could not delete agent. Please try again.'
          : 'Could not save agent. Please try again.',
    };
  }
}
