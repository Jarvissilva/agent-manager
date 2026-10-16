import assert from 'node:assert/strict';
import test from 'node:test';
import {
  readSessionTabs,
  sessionTab,
  upsertSessionTab,
} from '../../client/src/lib/sessionTabs.ts';
import { parseComposerDraft } from '../../client/src/lib/composerDraft.ts';

test('session tabs restore only local session paths and deduplicate IDs', () => {
  assert.deepEqual(readSessionTabs('bad'), []);
  assert.deepEqual(readSessionTabs('{}'), []);
  const restored = readSessionTabs(
    JSON.stringify([
      { path: 'https://example.com' },
      { path: '//example.com/sessions/one' },
      { path: '/projects' },
      { path: '/sessions/one' },
      { path: '/sessions/one?anything=ignored' },
      {
        path: '/sessions/new?draft=abc&provider=codex&workingDirectory=%2Ftmp&secret=ignored',
      },
    ]),
  );
  assert.equal(restored.length, 2);
  assert.equal(restored[0].path, '/sessions/one');
  assert.equal(restored[1].draftId, 'abc');
  assert.equal(
    new URL(restored[1].path, 'http://local').searchParams.has('secret'),
    false,
  );
  assert.equal(sessionTab('/sessions/new', ''), null);
});
test('new drafts stay independent and creation replaces exactly the originating tab', () => {
  const one = sessionTab('/sessions/new', '?draft=one'),
    two = sessionTab('/sessions/new', '?draft=two');
  const saved = sessionTab('/sessions/saved', '');
  let tabs = upsertSessionTab([], one);
  tabs = upsertSessionTab(tabs, two);
  assert.equal(tabs.length, 2);
  tabs = upsertSessionTab(tabs, saved, 'one');
  assert.deepEqual(
    tabs.map((tab) => tab.key),
    ['session:saved', 'draft:two'],
  );
  tabs = upsertSessionTab(
    tabs,
    sessionTab('/sessions/new', '?draft=two&provider=opencode'),
  );
  assert.equal(tabs.length, 2);
  assert.match(tabs[1].path, /provider=opencode/);
  assert.equal(upsertSessionTab([...tabs, one], saved, 'one').length, 2);
});
test('composer draft parsing preserves text and rejects malformed or cross-provider settings', () => {
  const settings = {
    model: 'model',
    effort: 'high',
    permissions: 'workspace-write',
    mode: 'plan',
  };
  const saved = JSON.stringify({
    prompt: 'Unsent prompt',
    provider: 'codex',
    agentId: '4',
    settings,
  });
  assert.deepEqual(parseComposerDraft(saved, 'codex'), {
    prompt: 'Unsent prompt',
    provider: 'codex',
    agentId: '4',
    settings,
  });
  assert.equal(
    parseComposerDraft(
      JSON.stringify({
        prompt: '',
        provider: 'codex',
        settings,
        settingsDirty: false,
      }),
      'codex',
    ).settings,
    undefined,
  );
  assert.equal(parseComposerDraft(saved, 'opencode').settings, undefined);
  assert.equal(parseComposerDraft(saved, 'opencode').agentId, '');
  assert.equal(parseComposerDraft(saved, 'opencode').prompt, 'Unsent prompt');
  assert.equal(
    parseComposerDraft(
      JSON.stringify({
        prompt: 'x',
        provider: 'codex',
        settings: { ...settings, permissions: 'anything' },
      }),
      'codex',
    ).settings,
    undefined,
  );
  assert.equal(
    parseComposerDraft(JSON.stringify({ prompt: 123 }), 'codex'),
    null,
  );
  assert.equal(
    parseComposerDraft(JSON.stringify({ prompt: 'a'.repeat(100001) }), 'codex'),
    null,
  );
  assert.equal(parseComposerDraft('bad', 'codex'), null);
});

test('composer drafts retain file attachments and ignore malformed attachment metadata', () => {
  const file = {
    path: '/tmp/reference.md',
    name: 'reference.md',
    size: 10,
    mime: 'text/markdown',
    source: 'reference',
  };
  const draft = parseComposerDraft(
    JSON.stringify({
      prompt: '',
      provider: 'codex',
      attachments: [file, null, { path: 1 }],
    }),
    'codex',
  );
  assert.deepEqual(draft.attachments, [file]);
  assert.equal(draft.prompt, '');
});
