import assert from 'node:assert/strict';
import test from 'node:test';
import { validateChatSettings } from '../src/services/chatSettings.ts';

const legacy = { model: null, effort: null, permissions: 'workspace-write' };

test('permission settings preserve legacy defaults and supported provider choices', async () => {
  for (const provider of ['codex', 'opencode', 'antigravity']) {
    assert.deepEqual(await validateChatSettings(legacy, provider), legacy);
    assert.deepEqual(
      await validateChatSettings(
        { ...legacy, approvalPolicy: 'never' },
        provider,
      ),
      { ...legacy, approvalPolicy: 'never' },
    );
  }
  for (const permissions of [
    'read-only',
    'workspace-write',
    'danger-full-access',
  ]) {
    for (const approvalPolicy of ['on-request', 'untrusted', 'never']) {
      const settings = {
        ...legacy,
        permissions,
        approvalPolicy,
        networkAccess: true,
      };
      assert.deepEqual(await validateChatSettings(settings, 'codex'), settings);
    }
  }
  const full = {
    ...legacy,
    permissions: 'danger-full-access',
    approvalPolicy: 'never',
  };
  assert.deepEqual(await validateChatSettings(full, 'opencode'), full);
});

test('invalid and unsupported permissions are rejected without silently broadening access', async () => {
  const invalid = [
    ['codex', { networkAccess: 'true' }],
    ['codex', { networkAccess: null }],
    ['codex', { approvalPolicy: 'auto' }],
    ['codex', { approvalPolicy: null }],
    ['codex', { permissions: 'anything' }],
    ['codex', { permissions: 'danger-full-access', networkAccess: false }],
    ['opencode', { networkAccess: true }],
    ['opencode', { networkAccess: false }],
    ['opencode', { approvalPolicy: 'untrusted' }],
    ['antigravity', { networkAccess: true }],
    ['antigravity', { approvalPolicy: 'untrusted' }],
    ['antigravity', { permissions: 'read-only' }],
    ['antigravity', { permissions: 'danger-full-access' }],
  ];
  for (const [provider, changes] of invalid) {
    await assert.rejects(
      validateChatSettings({ ...legacy, ...changes }, provider),
      (error) => error.status === 400,
    );
  }
});
