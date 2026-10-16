import assert from 'node:assert/strict';
import test from 'node:test';
import { readOpenCodeModels } from '../src/lib/providers/opencode/models.ts';
import {
  openCodeProviderModel,
  openCodeSelection,
} from '../../client/src/lib/opencodeModels.ts';

const providers = [
  { id: 'account', name: 'Connected account', integrationID: 'login' },
  { id: 'environment', name: 'Environment account' },
  { id: 'disconnected' },
  { id: 'local', name: 'Local' },
  { id: 'free', activation: 'enabled', integrationID: 'free-login' },
  { id: 'disabled', activation: 'disabled', integrationID: 'login' },
  { id: 'missing-login', integrationID: 'unknown' },
];
const integrations = [
  {
    id: 'login',
    connections: [{ type: 'credential', id: 'secret-reference' }],
  },
  { id: 'environment', connections: [{ type: 'env', name: 'MODEL_API_KEY' }] },
  { id: 'disconnected', connections: [] },
  { id: 'free-login', connections: [] },
];
const catalog = [
  ...providers.map(({ id }) => ({
    providerID: id,
    id: 'model',
    name: `${id} model`,
    enabled: true,
    variants: [{ id: 'high' }],
  })),
  {
    providerID: 'account',
    id: 'default',
    name: 'Account default',
    enabled: true,
  },
  { providerID: 'account', id: 'hidden', enabled: false },
  { providerID: 'absent', id: 'model' },
];
function server(overrides = {}) {
  return {
    async request(path) {
      const url = new URL(path, 'http://localhost');
      assert.equal(url.searchParams.get('location[directory]'), '/project');
      const data = {
        '/api/model': catalog,
        '/api/model/default': { providerID: 'account', id: 'default' },
        '/api/provider': providers,
        '/api/integration': integrations,
        ...overrides,
      };
      assert.ok(Object.hasOwn(data, url.pathname));
      if (data[url.pathname] instanceof Error) throw data[url.pathname];
      return { data: data[url.pathname] };
    },
  };
}

test('OpenCode exposes only enabled models from usable location providers', async () => {
  const models = await readOpenCodeModels(server(), '/project');
  assert.deepEqual(
    models.map((model) => model.model),
    [
      'account/model',
      'environment/model',
      'local/model',
      'free/model',
      'account/default',
    ],
  );
  assert.equal(models[0].providerId, 'account');
  assert.equal(models[0].providerName, 'Connected account');
  assert.equal(models[0].supportedReasoningEfforts[0].reasoningEffort, 'high');
  assert.equal(models.at(-1).isDefault, true);
});

test('OpenCode availability errors do not fall back to an unrestricted catalog', async () => {
  await assert.rejects(
    readOpenCodeModels(
      server({ '/api/integration': Error('Unavailable') }),
      '/project',
    ),
    /Unavailable/,
  );
  assert.deepEqual(
    await readOpenCodeModels(server({ '/api/provider': [] }), '/project'),
    [],
  );
  assert.deepEqual(
    await readOpenCodeModels(server({ '/api/model': [] }), '/project'),
    [],
  );
});

test('OpenCode loads the model catalog before querying the cold provider registry', async () => {
  const fixture = server();
  let loaded = false;
  const coldServer = {
    async request(path) {
      const route = new URL(path, 'http://localhost').pathname;
      if (route === '/api/model') {
        await new Promise((resolve) => setImmediate(resolve));
        loaded = true;
      }
      if (route === '/api/provider' && !loaded) return { data: [] };
      return fixture.request(path);
    },
  };
  const models = await readOpenCodeModels(coldServer, '/project');
  assert.equal(models.length, 5);
  assert.equal(models[0].providerId, 'account');
});

test('provider-first selections restore full model IDs and preserve unavailable selections', async () => {
  const models = await readOpenCodeModels(server(), '/project');
  const selection = openCodeSelection(models, 'account/model');
  assert.equal(selection.providerId, 'account');
  assert.deepEqual(
    selection.choices.map((model) => model.model),
    ['account/model', 'account/default'],
  );
  assert.equal(selection.providers[0].name, 'Connected account');
  assert.equal(selection.providers.length, 4);
  assert.equal(openCodeProviderModel(models, 'account'), 'account/default');
  assert.equal(openCodeProviderModel(models, 'local'), 'local/model');
  assert.equal(openCodeProviderModel(models, ''), null);
  assert.equal(openCodeProviderModel(models, 'disconnected'), null);
  assert.equal(openCodeSelection(models, null).providerId, '');
  const missing = openCodeSelection(models, 'disconnected/old');
  assert.equal(missing.providerId, 'disconnected');
  assert.deepEqual(missing.choices, []);
  assert.deepEqual(openCodeSelection([], 'account/model').choices, []);
});
