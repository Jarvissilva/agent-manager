import type { ProviderModel } from '../types/chat';

export function openCodeSelection(
  models: ProviderModel[],
  value: string | null,
) {
  const providerId = value ? value.slice(0, value.indexOf('/')) : '';
  const providers = [
    ...new Map(
      models.map((model) => [
        model.providerId ?? model.model.split('/')[0],
        model.providerName ?? model.description,
      ]),
    ).entries(),
  ].map(([id, name]) => ({ id, name: name || id }));
  const choices = models.filter(
    (model) => (model.providerId ?? model.model.split('/')[0]) === providerId,
  );
  return { providerId, providers, choices };
}

export function openCodeProviderModel(
  models: ProviderModel[],
  providerId: string,
) {
  if (!providerId) return null;
  const choices = models.filter(
    (model) => (model.providerId ?? model.model.split('/')[0]) === providerId,
  );
  return (
    (choices.find((model) => model.isDefault) ?? choices[0])?.model ?? null
  );
}
