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
    (settings.mode !== undefined &&
      settings.mode !== 'default' &&
      settings.mode !== 'plan') ||
    (settings.model !== null &&
      (typeof settings.model !== 'string' ||
        !settings.model ||
        settings.model.length > 200)) ||
    (settings.effort !== null &&
      (typeof settings.effort !== 'string' || settings.effort.length > 30)) ||
    (settings.permissions !== 'read-only' &&
      settings.permissions !== 'workspace-write' &&
      settings.permissions !== 'danger-full-access') ||
    (settings.networkAccess !== undefined &&
      typeof settings.networkAccess !== 'boolean') ||
    (settings.approvalPolicy !== undefined &&
      settings.approvalPolicy !== 'on-request' &&
      settings.approvalPolicy !== 'untrusted' &&
      settings.approvalPolicy !== 'never')
  )
    throw new RequestError(
      400,
      'Choose valid model, reasoning and permission settings.',
    );
  if (provider === 'antigravity' && settings.permissions === 'read-only')
    throw new RequestError(
      400,
      'Antigravity does not expose a read-only file sandbox. Choose Edit project files or use Codex for read-only sessions.',
    );
  if (
    provider === 'antigravity' &&
    settings.permissions === 'danger-full-access'
  )
    throw new RequestError(
      400,
      'Antigravity does not expose a separate full-access sandbox mode. Use its approval policy instead.',
    );
  if (provider !== 'codex' && settings.networkAccess !== undefined)
    throw new RequestError(
      400,
      'Network sandbox controls are only supported by Codex.',
    );
  if (provider !== 'codex' && settings.approvalPolicy === 'untrusted')
    throw new RequestError(
      400,
      'Trusted-command approvals are only supported by Codex.',
    );
  if (
    settings.permissions === 'danger-full-access' &&
    settings.networkAccess === false
  )
    throw new RequestError(
      400,
      'Full access includes network access. Choose a sandboxed mode to disable it.',
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
    ...(settings.mode !== undefined
      ? { mode: settings.mode as 'default' | 'plan' }
      : {}),
    model: selectedModel,
    effort,
    permissions: settings.permissions,
    ...(settings.networkAccess !== undefined
      ? { networkAccess: settings.networkAccess as boolean }
      : {}),
    ...(settings.approvalPolicy !== undefined
      ? {
          approvalPolicy:
            settings.approvalPolicy as ChatSettings['approvalPolicy'],
        }
      : {}),
  };
}
