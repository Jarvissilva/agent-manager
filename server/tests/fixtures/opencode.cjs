const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const store = path.join(process.cwd(), 'native.json');
let native = fs.existsSync(store) ? JSON.parse(fs.readFileSync(store)) : {};
let clients = new Set();
let permissions = [],
  forms = [],
  pending;
const save = () => fs.writeFileSync(store, JSON.stringify(native));
const event = (type, data) => {
  for (const client of clients)
    client.write('data: ' + JSON.stringify({ type, data }) + '\n\n');
};
const finish = (session, outcome = 'succeeded') => {
  pending = undefined;
  const assistant = session.messages.findLast((x) => x.type === 'assistant');
  if (assistant) {
    assistant.time.completed = Date.now();
    assistant.content[0].text = 'Hello OpenCode';
    if (outcome === 'failed') assistant.error = { message: 'Fixture failure' };
  }
  session.messages.push({
    id: 'msg_idle_' + session.messages.length,
    type: 'idle',
    outcome,
    time: { created: Date.now() },
  });
  save();
  event('session.status', {
    sessionID: session.id,
    status: { type: 'idle' },
  });
};
const server = http.createServer(async (req, res) => {
  if (
    req.headers.authorization !==
    'Basic ' + Buffer.from('opencode:fixture-secret').toString('base64')
  ) {
    res.writeHead(401).end();
    return;
  }
  const url = new URL(req.url, 'http://localhost');
  if (!pending && fs.existsSync(store))
    native = JSON.parse(fs.readFileSync(store, 'utf8'));
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : {};
  fs.appendFileSync(
    'requests.jsonl',
    JSON.stringify({
      method: req.method,
      path: url.pathname,
      query: [...url.searchParams],
      body,
    }) + '\n',
  );
  const json = (data, status = 200) => {
    res
      .writeHead(status, { 'Content-Type': 'application/json' })
      .end(JSON.stringify(data));
  };
  if (url.pathname === '/api/skill') {
    const root = path.join(
      process.env.AGENT_MANAGER_SKILL_HOME,
      '.agents/skills',
    );
    const skills = fs.existsSync(root)
      ? fs.readdirSync(root).flatMap((id) => {
          try {
            const file = path.join(root, id, 'SKILL.md');
            const parts = fs.readFileSync(file, 'utf8').split(/^---$/m);
            return [{ id, path: file, content: parts[2].trim() }];
          } catch {
            return [];
          }
        })
      : [];
    json({ data: skills });
    return;
  }
  if (url.pathname === '/api/location/reload') {
    res.writeHead(204).end();
    return;
  }
  if (url.pathname === '/api/event') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"type":"server.connected","data":{}}\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (url.pathname === '/api/provider') {
    json({
      data: [
        {
          id: 'test',
          name: 'Test Provider',
          activation: 'auto',
          integrationID: 'test-login',
        },
      ],
    });
    return;
  }
  if (url.pathname === '/api/integration') {
    json({
      data: [
        {
          id: 'test-login',
          connections: [{ type: 'env', name: 'TEST_API_KEY' }],
        },
      ],
    });
    return;
  }
  if (url.pathname === '/api/model') {
    json({
      data: fs.existsSync('no-models')
        ? []
        : [
            {
              id: 'fixture',
              providerID: 'test',
              name: 'Fixture model',
              enabled: true,
              variants: [{ id: 'high' }],
            },
          ],
    });
    return;
  }
  if (url.pathname === '/api/model/default') {
    json({
      data: fs.existsSync('no-models')
        ? null
        : { id: 'fixture', providerID: 'test' },
    });
    return;
  }
  if (url.pathname === '/api/agent') {
    json({
      data: [
        { id: 'build', permissions: [] },
        ...(fs.existsSync('no-plan')
          ? []
          : [
              {
                id: 'plan',
                permissions: [
                  { action: 'edit', resource: '*', effect: 'deny' },
                  {
                    action: 'edit',
                    resource: '/native/plan/*',
                    effect: 'allow',
                  },
                ],
              },
            ]),
      ],
    });
    return;
  }
  if (url.pathname === '/api/session' && req.method === 'POST') {
    const id = 'ses_fixture_' + Object.keys(native).length;
    const session = {
      id,
      location: body.location,
      permissions: body.permissions,
      model: body.model,
      agent: body.agent,
      messages: [],
    };
    native[id] = session;
    save();
    json({ data: session });
    return;
  }
  if (url.pathname.includes('/instructions/entries/')) {
    res.writeHead(204).end();
    return;
  }
  const parts = url.pathname.split('/');
  const session = native[parts[3]];
  if (!session) {
    json({ message: 'Session not found' }, 404);
    return;
  }
  const suffix = parts.slice(4).join('/');
  if (!suffix) {
    if (req.method === 'PATCH') {
      session.permissions = body.permissions;
      save();
      res.writeHead(204).end();
    } else json({ data: session });
    return;
  }
  if (suffix === 'agent') {
    session.agent = body.agent;
    save();
    res.writeHead(204).end();
    return;
  }
  if (suffix === 'model') {
    session.model = body.model;
    save();
    res.writeHead(204).end();
    return;
  }
  if (suffix === 'message') {
    const offset = Number(url.searchParams.get('cursor') || 0);
    const data = session.messages.slice(offset, offset + 2);
    json({
      data,
      cursor: {
        next: offset + 2 < session.messages.length ? String(offset + 2) : null,
      },
    });
    return;
  }
  if (suffix === 'permission') {
    json({ data: permissions });
    return;
  }
  if (suffix === 'form') {
    json({ data: forms });
    return;
  }
  if (suffix === 'interrupt') {
    clearTimeout(pending);
    permissions = [];
    forms = [];
    if (pending) finish(session, 'interrupted');
    json({});
    return;
  }
  if (suffix === 'prompt') {
    const id = 'msg_user_' + session.messages.length;
    session.messages.push({
      id,
      type: 'user',
      text: body.text,
      time: { created: Date.now() },
    });
    const assistantID = 'msg_assistant_' + session.messages.length;
    session.messages.push({
      id: assistantID,
      type: 'assistant',
      content: [{ type: 'text', text: '' }],
      time: { created: Date.now() },
    });
    save();
    json({ data: { id } });
    pending = setTimeout(() => {
      event('session.next.text.delta', {
        sessionID: session.id,
        assistantMessageID: assistantID,
        textID: 'text1',
        delta: 'Hello ',
      });
      if (body.text === 'wait') return;
      if (body.text === 'approval') {
        permissions = [
          { id: 'per_fixture', action: 'shell', resources: ['printf hello'] },
        ];
        return;
      }
      if (body.text === 'question') {
        forms = [
          {
            id: 'frm_fixture',
            title: 'Choose',
            fields: [
              {
                key: 'choice',
                type: 'string',
                title: 'Pick',
                required: true,
                options: [{ value: 'a', label: 'Option A' }],
              },
            ],
          },
        ];
        return;
      }
      pending = setTimeout(
        () => finish(session, body.text === 'error' ? 'failed' : 'succeeded'),
        350,
      );
    }, 100);
    return;
  }
  if (suffix.includes('/reply')) {
    if (suffix.startsWith('permission')) permissions = [];
    else forms = [];
    res.writeHead(204).end();
    pending = setTimeout(() => finish(session), 100);
    return;
  }
  if (suffix.startsWith('form/') && req.method === 'DELETE') {
    forms = [];
    res.writeHead(204).end();
    pending = setTimeout(() => finish(session), 100);
    return;
  }
  json({ message: 'Unknown endpoint ' + suffix }, 404);
});
server.listen(0, '127.0.0.1', () => {
  console.log('server listening on http://127.0.0.1:' + server.address().port);
  console.log('server password fixture-secret');
});
