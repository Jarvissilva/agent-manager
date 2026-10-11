import { listOpenCodeModels } from './opencode/models.js';
import { listCodexModels } from './codex/models.js';
import { listAntigravityModels } from './antigravity/models.js';
import type { AgentProvider } from './types.js';
export function listProviderModels(provider: AgentProvider, cwd?: string) {
  if (provider === 'opencode') return listOpenCodeModels(cwd);
  return provider === 'antigravity'
    ? listAntigravityModels()
    : listCodexModels();
}
