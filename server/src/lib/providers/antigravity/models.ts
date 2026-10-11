import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ProviderModel } from '../types.js';

const execute = promisify(execFile);
let cached: { models: ProviderModel[]; expires: number } | undefined;
let loading: Promise<ProviderModel[]> | undefined;

export function listAntigravityModels(): Promise<ProviderModel[]> {
  if (cached && cached.expires > Date.now())
    return Promise.resolve(cached.models);
  if (loading) return loading;
  loading = execute('agy', ['models'], {
    timeout: 30000,
    maxBuffer: 1024 * 1024,
  })
    .then(({ stdout }) => {
      const models: ProviderModel[] = [];
      for (const line of stdout.split('\n')) {
        const match = /^([a-zA-Z0-9][a-zA-Z0-9._:/-]*)\t(.+)$/.exec(
          line.trim(),
        );
        if (!match) continue;
        models.push({
          id: match[1],
          model: match[1],
          displayName: match[2],
          description: '',
          // The CLI does not report which model is the configured default.
          isDefault: false,
          defaultReasoningEffort: '',
          supportedReasoningEfforts: [
            'low',
            'medium',
            'high',
            'xhigh',
            'max',
          ].map((reasoningEffort) => ({
            reasoningEffort,
            description: 'Antigravity CLI reasoning effort',
          })),
        });
      }
      if (!models.length)
        throw Error('Antigravity did not return a model catalog.');
      cached = { models, expires: Date.now() + 5 * 60 * 1000 };
      return models;
    })
    .finally(() => {
      loading = undefined;
    });
  return loading;
}
