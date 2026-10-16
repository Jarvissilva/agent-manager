import {
  addCounters,
  finishUsage,
  normalizeUsage,
  saveUsage,
  type TokenCounters,
} from '../../../repositories/usage.js';
import type { SessionInfo } from '../../../repositories/sessions.js';

// Each CLI process receives one prompt. Step usage is provisional; the result
// is authoritative for that process and replaces the step sum.
export function recordAntigravityUsage(
  info: SessionInfo,
  turnId: string,
  steps: Map<string, TokenCounters>,
  event: string,
  payload: Record<string, unknown>,
  model: string | null,
) {
  if (event === 'step_update' && payload.usage) {
    steps.set(
      String(payload.step_index),
      normalizeUsage('antigravity', payload.usage),
    );
    saveUsage(
      info,
      turnId,
      turnId,
      addCounters([...steps.values()]),
      [...steps.values()],
      model,
    );
  } else if (event === 'result') {
    if (payload.usage)
      saveUsage(
        info,
        turnId,
        turnId,
        normalizeUsage('antigravity', payload.usage),
        payload.usage,
        model,
      );
    finishUsage(
      info.id,
      turnId,
      Boolean(payload.usage) && payload.status === 'SUCCESS',
    );
  }
}
