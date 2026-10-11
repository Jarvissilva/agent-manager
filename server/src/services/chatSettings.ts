import { RequestError } from '../lib/http/errors.js';
import { listProviderModels } from '../lib/providers/models.js';
import type { AgentProvider, ChatSettings } from '../lib/providers/types.js';
export type { ChatSettings } from '../lib/providers/types.js';
export const defaultChatSettings: ChatSettings = {
  model: null,
  effort: null,
  permissions: 'workspace-write',
};

export async function validateChatSettings(
  value: unknown,
  provider: AgentProvider = 'codex',
  cwd?: string,
): Promise<ChatSettings> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new RequestError(400, 'Invalid chat settings.');
  const settings = value as Record<string, unknown>;
  if (
    (settings.model !== null &&
      (typeof settings.model !== 'string' ||
        !settings.model ||
        settings.model.length > 200)) ||
    (settings.effort !== null &&
      (typeof settings.effort !== 'string' || settings.effort.length > 30)) ||
    (settings.permissions !== 'read-only' &&
      settings.permissions !== 'workspace-write')
  )
    throw new RequestError(
      400,
      'Choose valid model, reasoning and file access settings.',
    );
  if (provider === 'antigravity' && settings.permissions === 'read-only')
    throw new RequestError(
      400,
      'Antigravity does not expose a read-only file sandbox. Choose Edit project files or use Codex for read-only sessions.',
    );
  let selectedModel = settings.model as string | null;
  let effort = settings.effort as string | null;
  if (settings.model !== null || settings.effort !== null) {
    let models;
    try {
      models = await listProviderModels(provider, cwd);
    } catch {
      throw new RequestError(
        503,
        'Could not load provider models. Try again or use provider defaults.',
      );
    }
    const model =
      settings.model === null
        ? models.find((model) => model.isDefault)
        : models.find((model) => model.model === settings.model);
    if (!model)
      throw new RequestError(
        400,
        'This model is not in the current provider catalog.',
      );
    selectedModel = model.model;
    if (
      settings.effort !== null &&
      !model.supportedReasoningEfforts.some(
        (option) => option.reasoningEffort === settings.effort,
      )
    )
      throw new RequestError(
        400,
        'This reasoning level is not supported by the selected model.',
      );
    effort ??= model.defaultReasoningEffort || null;
  }
  return {
    model: selectedModel,
    effort,
    permissions: settings.permissions,
  };
}
