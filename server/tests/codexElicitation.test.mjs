import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  mcpElicitation,
  mcpElicitationResponse,
  automaticMcpConfirmation,
} from '../src/lib/providers/codex/elicitation.ts';

const params = {
  threadId: 'thread',
  serverName: 'hostinger',
  mode: 'form',
  message: 'Allow this hosting request?',
  requestedSchema: { type: 'object', properties: {}, required: [] },
};

test('MCP consent uses action/content responses and validates structured input', () => {
  const request = mcpElicitation(42, params);
  assert.equal(request.kind, 'mcp');
  assert.match(request.title, /hostinger/);
  assert.deepEqual(mcpElicitationResponse(request, { decision: 'accept' }), {
    action: 'accept',
    content: {},
  });
  assert.deepEqual(mcpElicitationResponse(request, { decision: 'decline' }), {
    action: 'decline',
    content: null,
  });
  assert.deepEqual(mcpElicitationResponse(request, { decision: 'cancel' }), {
    action: 'cancel',
    content: null,
  });
  assert.throws(() =>
    mcpElicitationResponse(request, { decision: 'acceptForSession' }),
  );
  const form = mcpElicitation('form', {
    ...params,
    requestedSchema: {
      type: 'object',
      required: ['confirm', 'amount', 'account', 'scopes'],
      properties: {
        confirm: { type: 'boolean', title: 'Confirm request' },
        amount: { type: 'integer', minimum: 1, maximum: 10 },
        account: {
          type: 'string',
          oneOf: [{ const: 'account-id', title: 'My account' }],
        },
        scopes: {
          type: 'array',
          minItems: 1,
          items: { type: 'string', enum: ['read', 'write'] },
        },
        optional: { type: 'string', minLength: 2, maxLength: 5 },
      },
    },
  });
  const answers = {
    confirm: 'false',
    amount: '3',
    account: 'account-id',
    scopes: '["read"]',
    optional: '',
  };
  assert.equal(form.questions[2].options[0].value, 'account-id');
  assert.deepEqual(
    mcpElicitationResponse(form, { decision: 'accept', answers }).content,
    { confirm: false, amount: 3, account: 'account-id', scopes: ['read'] },
  );
  for (const invalid of [
    { confirm: '' },
    { amount: '2.5' },
    { amount: '11' },
    { account: 'My account' },
    { scopes: '["other"]' },
    { scopes: '[]' },
    { scopes: '["read","read"]' },
    { optional: 'too long' },
  ]) {
    assert.throws(() =>
      mcpElicitationResponse(form, {
        decision: 'accept',
        answers: { ...answers, ...invalid },
      }),
    );
  }
  assert.deepEqual(
    mcpElicitationResponse(form, { decision: 'decline', answers: {} }),
    { action: 'decline', content: null },
  );
});

test('URL consent is explicit and device verification is never treated as ordinary approval', () => {
  const url = mcpElicitation('url', {
    ...params,
    mode: 'url',
    url: 'https://example.com/consent',
  });
  assert.equal(url.elicitation.url, 'https://example.com/consent');
  assert.equal(automaticMcpConfirmation(url), undefined);
  assert.deepEqual(mcpElicitationResponse(url, { decision: 'accept' }), {
    action: 'accept',
    content: null,
  });
  for (const extra of [
    { mode: 'url', url: 'javascript:alert(1)' },
    { mode: 'openai/userVerification', challenge: 'proof-required' },
    {
      mode: 'form',
      requestedSchema: {
        type: 'object',
        properties: { nested: { type: 'object' } },
      },
    },
  ]) {
    const unsupported = mcpElicitation('unsupported', { ...params, ...extra });
    assert.equal(unsupported.elicitation.mode, 'unsupported');
    assert.equal(automaticMcpConfirmation(unsupported), undefined);
    assert.throws(() =>
      mcpElicitationResponse(unsupported, { decision: 'accept' }),
    );
    assert.deepEqual(
      mcpElicitationResponse(unsupported, { decision: 'cancel' }),
      { action: 'cancel', content: null },
    );
  }
});

test('all MCP servers auto-approve empty confirmations but never invent form input', () => {
  for (const serverName of ['hostinger', 'another-server']) {
    assert.deepEqual(
      automaticMcpConfirmation(
        mcpElicitation('confirm', { ...params, serverName }),
      ),
      { action: 'accept', content: {} },
    );
  }
  const form = mcpElicitation('input', {
    ...params,
    requestedSchema: {
      type: 'object',
      properties: { confirm: { type: 'boolean', default: true } },
    },
  });
  assert.equal(automaticMcpConfirmation(form), undefined);
});

test('Codex MCP requests wait for user input and keep existing approval responses unchanged', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'codex-mcp-consent-'));
  const previous = process.env.AGENT_MANAGER_DB_PATH;
  process.env.AGENT_MANAGER_DB_PATH = join(dir, 'test.sqlite');
  const { ChatSession } = await import('../src/services/chat.ts');
  const { database } = await import('../src/lib/database.ts');
  try {
    const replies = [];
    const rejections = [];
    const chat = Object.assign(Object.create(ChatSession.prototype), {
      info: { id: 'test', codexConversationId: 'thread' },
      state: 'working',
      requests: new Map(),
      error: null,
      events: new EventEmitter(),
      rpc: {
        respond: (id, result) => replies.push({ id, result }),
        reject: (id) => rejections.push(id),
      },
    });
    chat.receive({
      id: 'automatic',
      method: 'mcpServer/elicitation/request',
      params,
    });
    assert.deepEqual(replies.pop(), {
      id: 'automatic',
      result: { action: 'accept', content: {} },
    });
    assert.equal(chat.requests.size, 0);
    const interactive = {
      ...params,
      requestedSchema: {
        type: 'object',
        properties: { confirm: { type: 'boolean' } },
        required: ['confirm'],
      },
    };
    chat.receive({
      id: 42,
      method: 'mcpServer/elicitation/request',
      params: interactive,
    });
    assert.equal(replies.length, 0);
    assert.equal(rejections.length, 0);
    assert.equal(chat.requests.get('42').kind, 'mcp');
    chat.respond('42', { decision: 'accept', answers: { confirm: 'true' } });
    assert.deepEqual(replies.pop(), {
      id: 42,
      result: { action: 'accept', content: { confirm: true } },
    });
    assert.equal(chat.requests.size, 0);
    assert.throws(
      () => chat.respond('42', { decision: 'accept' }),
      /already been resolved/,
    );
    for (const decision of ['decline', 'cancel']) {
      chat.receive({
        id: decision,
        method: 'mcpServer/elicitation/request',
        params: interactive,
      });
      chat.respond(decision, { decision });
      assert.deepEqual(replies.pop().result, {
        action: decision,
        content: null,
      });
    }
    chat.receive({
      id: 'resolved',
      method: 'mcpServer/elicitation/request',
      params: interactive,
    });
    chat.receive({
      method: 'serverRequest/resolved',
      params: { threadId: 'thread', requestId: 'resolved' },
    });
    assert.equal(chat.requests.size, 0);
    chat.receive({
      id: 'other',
      method: 'mcpServer/elicitation/request',
      params: { ...interactive, threadId: 'different' },
    });
    assert.equal(chat.requests.size, 0);
    chat.state = 'idle';
    chat.receive({
      id: 'idle',
      method: 'mcpServer/elicitation/request',
      params: interactive,
    });
    chat.respond('idle', { decision: 'decline' });
    assert.deepEqual(replies.pop().result, {
      action: 'decline',
      content: null,
    });
    chat.state = 'working';
    chat.receive({
      id: 'command',
      method: 'item/commandExecution/requestApproval',
      params: { threadId: 'thread', command: 'echo test' },
    });
    chat.respond('command', { decision: 'accept' });
    assert.deepEqual(replies.pop().result, { decision: 'accept' });
  } finally {
    database.close();
    if (previous === undefined) delete process.env.AGENT_MANAGER_DB_PATH;
    else process.env.AGENT_MANAGER_DB_PATH = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
