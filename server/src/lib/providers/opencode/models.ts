import { OpenCodeServer, array, record, text } from './server.js';
import type { ProviderModel } from '../types.js';

export const locationQuery = (cwd: string) =>
  '?' + new URLSearchParams({ 'location[directory]': cwd });
export async function readOpenCodeModels(
  server: OpenCodeServer,
  cwd: string,
): Promise<ProviderModel[]> {
  // OpenCode populates its provider registry while loading the model catalog.
  // Querying providers concurrently on a fresh server can return an empty list.
  const catalog = await server.request('/api/model' + locationQuery(cwd));
  const [defaults, providers, integrations] = await Promise.all([
    server.request('/api/model/default' + locationQuery(cwd)),
    server.request('/api/provider' + locationQuery(cwd)),
    server.request('/api/integration' + locationQuery(cwd)),
  ]);
  const connections = new Map(
    array(integrations.data)
      .map(record)
      .map((integration) => [text(integration.id), integration]),
  );
  const available = new Map(
    array(providers.data)
      .map(record)
      .filter((provider) => {
        if (provider.activation === 'disabled') return false;
        if (provider.activation === 'enabled') return true;
        const integration = connections.get(
          text(provider.integrationID) || text(provider.id),
        );
        return integration
          ? array(integration.connections).length > 0
          : !text(provider.integrationID);
      })
      .map((provider) => [
        text(provider.id),
        text(provider.name) || text(provider.id),
      ]),
  );
  const defaultModel = record(defaults.data);
  return array(catalog.data)
    .map(record)
    .filter(
      (model) =>
        model.enabled !== false && available.has(text(model.providerID)),
    )
    .map((model) => ({
      id: `${text(model.providerID)}/${text(model.id)}`,
      model: `${text(model.providerID)}/${text(model.id)}`,
      displayName: text(model.name) || text(model.id),
      description: text(model.providerID),
      providerId: text(model.providerID),
      providerName: available.get(text(model.providerID)),
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
