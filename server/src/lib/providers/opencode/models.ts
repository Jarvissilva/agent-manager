import { OpenCodeServer, array, record, text } from './server.js';
import type { ProviderModel } from '../types.js';

export const locationQuery = (cwd: string) =>
  '?' + new URLSearchParams({ 'location[directory]': cwd });
export async function readOpenCodeModels(
  server: OpenCodeServer,
  cwd: string,
): Promise<ProviderModel[]> {
  const [catalog, defaults] = await Promise.all([
    server.request('/api/model' + locationQuery(cwd)),
    server.request('/api/model/default' + locationQuery(cwd)),
  ]);
  const defaultModel = record(defaults.data);
  return array(catalog.data)
    .map(record)
    .filter((model) => model.enabled !== false)
    .map((model) => ({
      id: `${text(model.providerID)}/${text(model.id)}`,
      model: `${text(model.providerID)}/${text(model.id)}`,
      displayName: text(model.name) || text(model.id),
      description: text(model.providerID),
      isDefault:
        defaultModel.id === model.id &&
        defaultModel.providerID === model.providerID,
      defaultReasoningEffort: '',
      supportedReasoningEfforts: array(model.variants)
        .map(record)
        .map((variant) => ({
          reasoningEffort: text(variant.id),
          description: text(variant.id),
        })),
    }));
}
const cache = new Map<
  string,
  { expires: number; promise: Promise<ProviderModel[]> }
>();
export function listOpenCodeModels(cwd = process.cwd()) {
  const cached = cache.get(cwd);
  if (cached && cached.expires > Date.now()) return cached.promise;
  const promise = (async () => {
    const server = new OpenCodeServer(cwd);
    try {
      return await readOpenCodeModels(server, cwd);
    } finally {
      server.close();
    }
  })();
  cache.set(cwd, { expires: Date.now() + 15000, promise });
  void promise.catch(() => cache.delete(cwd));
  return promise;
}
export function modelRef(model: string, variant: string | null) {
  const separator = model.indexOf('/');
  return {
    providerID: model.slice(0, separator),
    id: model.slice(separator + 1),
    ...(variant ? { variant } : {}),
  };
}
