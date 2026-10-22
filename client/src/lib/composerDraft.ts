import type { ChatSettings } from '../types/chat';
import type { FileAttachment } from '../types/files';
import { readBrowserStorage, writeBrowserStorage } from './sessionTabs';
export type ComposerDraft = {
  prompt: string;
  provider: string;
  settings?: ChatSettings;
  agentId: string;
  settingsDirty?: boolean;
  attachments?: FileAttachment[];
};
const storageKey = (key: string) => `agent-manager:composer:${key}`;
export function parseComposerDraft(
  value: string | null,
  provider: string,
): ComposerDraft | null {
  try {
    const raw: unknown = JSON.parse(value ?? 'null');
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const draft = raw as Record<string, unknown>;
    if (typeof draft.prompt !== 'string' || draft.prompt.length > 100000)
      return null;
    const settings = draft.settings;
    let validSettings: ChatSettings | undefined;
    if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
      const s = settings as Record<string, unknown>;
      if (
        (s.model === null || typeof s.model === 'string') &&
        (s.effort === null || typeof s.effort === 'string') &&
        ['read-only', 'workspace-write', 'danger-full-access'].includes(
          String(s.permissions),
        ) &&
        (s.mode === undefined || s.mode === 'plan' || s.mode === 'default') &&
        (s.networkAccess === undefined ||
          typeof s.networkAccess === 'boolean') &&
        (s.approvalPolicy === undefined ||
          ['on-request', 'untrusted', 'never'].includes(
            String(s.approvalPolicy),
          ))
      )
        validSettings = settings as ChatSettings;
    }
    return {
      prompt: draft.prompt,
      ...(Array.isArray(draft.attachments)
        ? {
            attachments: draft.attachments
              .filter((file): file is FileAttachment =>
                Boolean(
                  file &&
                  typeof file === 'object' &&
                  typeof file.path === 'string' &&
                  typeof file.name === 'string' &&
                  typeof file.size === 'number' &&
                  typeof file.mime === 'string' &&
                  ['reference', 'upload'].includes(file.source),
                ),
              )
              .slice(0, 8),
          }
        : {}),
      provider,
      settings:
        draft.provider === provider && draft.settingsDirty !== false
          ? validSettings
          : undefined,
      agentId: typeof draft.agentId === 'string' ? draft.agentId : '',
    };
  } catch {
    return null;
  }
}
export function readComposerDraft(key: string, provider: string) {
  return parseComposerDraft(readBrowserStorage(storageKey(key)), provider);
}
export function saveComposerDraft(key: string, draft: ComposerDraft) {
  writeBrowserStorage(storageKey(key), JSON.stringify(draft));
}
export function removeComposerDraft(key: string) {
  writeBrowserStorage(storageKey(key), null);
}
