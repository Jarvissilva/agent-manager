import { workingDirectory } from '../../lib/directories.js';
import { RequestError } from '../../lib/http/errors.js';
import type { Request, Response } from 'express';
import { listProviderModels } from '../../lib/providers/models.js';

export default async function getModels(request: Request, response: Response) {
  const provider = request.params.providerId;
  if (
    provider !== 'codex' &&
    provider !== 'antigravity' &&
    provider !== 'opencode'
  ) {
    response.status(404).json({ error: 'Provider not supported.' });
    return;
  }
  try {
    const cwd =
      request.query.workingDirectory === undefined
        ? undefined
        : await workingDirectory(request.query.workingDirectory);
    response.json(await listProviderModels(provider, cwd));
  } catch (error) {
    if (error instanceof RequestError) {
      response.status(error.status).json({ error: error.message });
      return;
    }
    response.status(503).json({
      error: `Could not load ${provider === 'opencode' ? 'OpenCode' : provider === 'codex' ? 'Codex' : 'Antigravity'} models. Check that the CLI is installed and signed in.`,
    });
  }
}
