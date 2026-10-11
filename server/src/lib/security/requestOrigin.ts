import type { IncomingMessage } from 'node:http';

const configured = process.env.AGENT_MANAGER_PUBLIC_ORIGIN?.trim();
let publicOrigin: string | undefined;
if (configured) {
  const url = new URL(configured);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'AGENT_MANAGER_PUBLIC_ORIGIN must be an HTTPS origin without credentials, a path, query, or fragment.',
    );
  }
  publicOrigin = url.origin;
}

export function isAllowedOrigin(request: IncomingMessage) {
  try {
    const value = request.headers.origin ?? '';
    const origin = new URL(value);
    if (origin.origin !== value || origin.host !== request.headers.host)
      return false;
    return (
      origin.origin === publicOrigin ||
      (['http:', 'https:'].includes(origin.protocol) &&
        ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname))
    );
  } catch {
    return false;
  }
}
