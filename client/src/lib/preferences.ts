import { useRouteLoaderData } from 'react-router';
import type { projectsLoader } from '../layouts/AppLayout';
import type { AppSettings } from '../types/settings';
import type { ChatSettings, ProviderModel } from '../types/chat';
import type { Agent } from '../types/agent';
export function useAppSettings() {
  return useRouteLoaderData<typeof projectsLoader>('app')!.settings;
}
export function chatDefaults(
  provider: Agent['provider'],
  models: ProviderModel[],
  preferences: AppSettings,
) {
  const saved = preferences.providers[provider];
  const model =
    saved.model === null
      ? models.find((m) => m.isDefault)
      : models.find((m) => m.model === saved.model);
  const valid =
    (saved.model === null && saved.effort === null) ||
    Boolean(
      model &&
      (saved.effort === null ||
        model.supportedReasoningEfforts.some(
          (e) => e.reasoningEffort === saved.effort,
        )),
    );
  const settings: ChatSettings = {
    model: null,
    effort: null,
    permissions: 'workspace-write',
    ...(valid ? saved : {}),
  };
  return {
    settings,
    notice: valid
      ? null
      : 'Your saved model or reasoning default is unavailable here. Using provider defaults.',
  };
}
