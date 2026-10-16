import { workingDirectory } from '../lib/directories.js';
import { getSettings, saveSettings } from '../repositories/settings.js';
import { RequestError } from '../lib/http/errors.js';
import type { AgentProvider, ProviderModel } from '../lib/providers/types.js';
import { defaultChatSettings, validateChatSettings } from './chatSettings.js';
import { listProviderModels } from '../lib/providers/models.js';

export function resolveDefaults(
  provider: AgentProvider,
  models: ProviderModel[],
) {
  const saved = getSettings().providers[provider];
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
  return {
    settings: { ...defaultChatSettings, ...(valid ? saved : {}) },
    notice: valid
      ? null
      : 'Your saved model or reasoning default is unavailable here. Using provider defaults.',
  };
}
export async function newChatDefaults(provider: AgentProvider, cwd: string) {
  const saved = getSettings().providers[provider];
  if (saved.model === null && saved.effort === null)
    return { settings: { ...defaultChatSettings }, notice: null };
  return resolveDefaults(provider, await listProviderModels(provider, cwd));
}
export async function updateSettings(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new RequestError(400, 'Invalid settings.');
  const patch = value as Record<string, unknown>;
  if (
    Object.keys(patch).some(
      (key) =>
        ![
          'providers',
          'timezone',
          'shortcutsEnabled',
          'workingDirectory',
        ].includes(key),
    )
  )
    throw new RequestError(400, 'Unknown setting.');
  const cwd =
    patch.workingDirectory === undefined
      ? undefined
      : await workingDirectory(patch.workingDirectory);
  const next = getSettings();
  if (patch.timezone !== undefined) {
    if (typeof patch.timezone !== 'string' || patch.timezone.length > 100)
      throw new RequestError(400, 'Choose a valid timezone.');
    try {
      new Intl.DateTimeFormat('en', { timeZone: patch.timezone });
    } catch {
      throw new RequestError(400, 'Choose a valid timezone.');
    }
    next.timezone = patch.timezone;
  }
  if (patch.shortcutsEnabled !== undefined) {
    if (typeof patch.shortcutsEnabled !== 'boolean')
      throw new RequestError(400, 'Invalid shortcut preference.');
    next.shortcutsEnabled = patch.shortcutsEnabled;
  }
  if (patch.providers !== undefined) {
    if (
      !patch.providers ||
      typeof patch.providers !== 'object' ||
      Array.isArray(patch.providers)
    )
      throw new RequestError(400, 'Invalid provider defaults.');
    const providers = patch.providers as Record<string, unknown>;
    for (const [id, raw] of Object.entries(providers)) {
      if (
        !['codex', 'opencode', 'antigravity'].includes(id) ||
        !raw ||
        typeof raw !== 'object' ||
        Array.isArray(raw)
      )
        throw new RequestError(400, 'Invalid provider defaults.');
      const settings = raw as Record<string, unknown>;
      if (
        Object.keys(settings).some((key) => !['model', 'effort'].includes(key))
      )
        throw new RequestError(
          400,
          'Only model and reasoning defaults can be changed.',
        );
      const provider = id as AgentProvider;
      const current = next.providers[provider];
      const selected = {
        model: settings.model === undefined ? current.model : settings.model,
        effort:
          settings.effort === undefined ? current.effort : settings.effort,
      };
      const validated = await validateChatSettings(
        { ...defaultChatSettings, ...selected },
        provider,
        cwd,
      );
      next.providers[provider] = {
        model: selected.model === null ? null : validated.model,
        effort: selected.effort === null ? null : validated.effort,
      };
    }
  }
  // Re-read after catalog requests so independent preference updates are retained.
  const latest = getSettings();
  if (patch.providers !== undefined)
    for (const id of Object.keys(patch.providers as object))
      latest.providers[id as AgentProvider] =
        next.providers[id as AgentProvider];
  if (patch.timezone !== undefined) latest.timezone = next.timezone;
  if (patch.shortcutsEnabled !== undefined)
    latest.shortcutsEnabled = next.shortcutsEnabled;
  return saveSettings(latest);
}
