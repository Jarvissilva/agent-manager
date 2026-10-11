export async function api<T>(
  path: string,
  signal: AbortSignal,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  const response = await fetch('/api' + path, {
    method,
    signal,
    headers:
      body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (response.status === 204) return undefined as T;
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      typeof result.error === 'string'
        ? result.error
        : 'Could not complete the request.',
    );
  return result as T;
}
