import { once } from 'node:events';
import { createAppServer } from './appServer.js';

import type { ProviderModel } from '../types.js';

let cached: { models: ProviderModel[]; expires: number } | undefined;
let loading: Promise<ProviderModel[]> | undefined;

export function listCodexModels(): Promise<ProviderModel[]> {
  if (cached && cached.expires > Date.now())
    return Promise.resolve(cached.models);
  if (loading) return loading;
  loading = readModels()
    .then((models) => {
      cached = { models, expires: Date.now() + 5 * 60 * 1000 };
      return models;
    })
    .finally(() => {
      loading = undefined;
    });
  return loading;
}

async function readModels() {
  const rpc = createAppServer(
    process.cwd(),
    (message) => {
      if (message.id !== undefined) rpc.reject(message.id);
    },
    () => {},
  );
  try {
    await rpc.request('initialize', {
      clientInfo: {
        name: 'agent_manager',
        title: 'Agent OS',
        version: '0.0.0',
      },
    });
    rpc.notify('initialized');
    const models: ProviderModel[] = [];
    let cursor: string | null = null;
    const seen = new Set<string>();
    do {
      const page = await rpc.request('model/list', {
        cursor,
        limit: 100,
        includeHidden: false,
      });
      if (!Array.isArray(page.data))
        throw Error('Codex returned an invalid model catalog.');
      for (const value of page.data) {
        if (!value || typeof value !== 'object') continue;
        const model = value as Record<string, unknown>;
        if (
          model.hidden ||
          typeof model.model !== 'string' ||
          typeof model.displayName !== 'string'
        )
          continue;
        models.push({
          id: String(model.id ?? model.model),
          model: model.model,
          displayName: model.displayName,
          description: String(model.description ?? ''),
          isDefault: model.isDefault === true,
          defaultReasoningEffort: String(model.defaultReasoningEffort ?? ''),
          supportedReasoningEfforts: Array.isArray(
            model.supportedReasoningEfforts,
          )
            ? model.supportedReasoningEfforts.filter(
                (
                  option,
                ): option is { reasoningEffort: string; description: string } =>
                  Boolean(
                    option &&
                    typeof option.reasoningEffort === 'string' &&
                    typeof option.description === 'string',
                  ),
              )
            : [],
        });
      }
      cursor = typeof page.nextCursor === 'string' ? page.nextCursor : null;
      if (cursor && seen.has(cursor))
        throw Error('Codex returned a repeated model cursor.');
      if (cursor) seen.add(cursor);
    } while (cursor);
    if (!models.length) throw Error('Codex did not return any visible models.');
    return models;
  } finally {
    if (rpc.child.exitCode === null && rpc.child.signalCode === null) {
      const closed = once(rpc.child, 'close');
      rpc.child.kill('SIGTERM');
      const force = setTimeout(() => rpc.child.kill('SIGKILL'), 2000);
      force.unref();
      await closed;
      clearTimeout(force);
    }
  }
}
