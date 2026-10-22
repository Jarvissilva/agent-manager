#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');
const path = require('node:path');
// Tests install this executable in <temporary directory>/bin/codex.
// Model discovery can run from the server directory instead of a test workspace.
const requestsFile = path.join(__dirname, '..', 'codex-requests.jsonl');
const file = path.join(process.cwd(), 'history.json');
let history = fs.existsSync(file)
  ? JSON.parse(fs.readFileSync(file, 'utf8'))
  : [];
let count = history.length;
let active;
let pending;
const out = (m) => process.stdout.write(JSON.stringify(m) + '\n');
const result = (id, value) => out({ id, result: value });
const event = (method, params) =>
  out({
    method,
    params: { threadId: '12345678-1234-5678-9012-123456789012', ...params },
  });
const item = (value, done = true) => {
  if (done) {
    const idx = history.findIndex((x) => x.item.id === value.id);
    const entry = { turnId: active, item: value };
    if (idx < 0) history.push(entry);
    else history[idx] = entry;
    fs.writeFileSync(file, JSON.stringify(history));
  }
  event(done ? 'item/completed' : 'item/started', {
    turnId: active,
    item: value,
  });
};
const finish = (text, status = 'completed') => {
  item({ id: active + '-assistant', type: 'agentMessage', text });
  event('turn/completed', {
    turn: { id: active, status, items: [], error: null },
  });
  active = null;
};
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line);
  fs.appendFileSync(requestsFile, JSON.stringify(m) + '\n');
  history = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, 'utf8'))
    : history;
  if (m.method === 'initialize') result(m.id, {});
  else if (m.method === 'thread/read')
    result(m.id, {
      thread: {
        id: '12345678-1234-5678-9012-123456789012',
        historyMode: 'paginated',
      },
    });
  else if (m.method === 'skills/list') result(m.id, { data: [] });
  else if (m.method === 'model/list')
    result(
      m.id,
      m.params.cursor
        ? {
            data: [
              {
                id: 'fixture-b',
                model: 'fixture-b',
                displayName: 'Fixture B',
                description: 'Second model',
                isDefault: false,
                defaultReasoningEffort: 'medium',
                supportedReasoningEfforts: [
                  { reasoningEffort: 'medium', description: 'Balanced' },
                ],
              },
            ],
            nextCursor: null,
          }
        : {
            data: [
              {
                id: 'fixture-a',
                model: 'fixture-a',
                displayName: 'Fixture A',
                description: 'Default model',
                isDefault: true,
                defaultReasoningEffort: 'low',
                supportedReasoningEfforts: [
                  { reasoningEffort: 'low', description: 'Fast' },
                  { reasoningEffort: 'high', description: 'Deep' },
                ],
              },
            ],
            nextCursor: 'page-2',
          },
    );
  else if (m.method === 'thread/start' || m.method === 'thread/resume') {
    if (process.cwd().endsWith('/fail')) {
      out({ id: m.id, error: { message: 'Fixture startup failure' } });
      return;
    }
    fs.writeFileSync(
      path.join(process.cwd(), 'launch.json'),
      JSON.stringify({ args: process.argv.slice(2), params: m.params }),
    );
    result(m.id, {
      thread: {
        id: '12345678-1234-5678-9012-123456789012',
        historyMode: 'paginated',
        turns: [],
      },
      model: m.params.model || 'fixture-a',
      reasoningEffort: m.params.config?.model_reasoning_effort || 'low',
    });
  } else if (m.method === 'thread/items/list')
    result(m.id, { data: history, nextCursor: null });
  else if (m.method === 'turn/start') {
    fs.writeFileSync(
      path.join(process.cwd(), 'turn.json'),
      JSON.stringify(m.params),
    );
    const fullPrompt = m.params.input[0].text;
    const prompt = fullPrompt.split(
      '\n\n--- Previous session final response',
    )[0];
    fs.appendFileSync(
      'turns.jsonl',
      JSON.stringify({ method: 'turn/start', ...m.params }) + '\n',
    );
    if (prompt === 'reject') {
      out({ id: m.id, error: { message: 'Fixture turn rejected' } });
      return;
    }
    active = 'turn-' + ++count;
    event('turn/started', { turn: { id: active, status: 'inProgress' } });
    item({
      id: active + '-user',
      type: 'userMessage',
      content: [{ type: 'text', text: fullPrompt }],
    });
    item({ id: active + '-assistant', type: 'agentMessage', text: '' }, false);
    if (prompt === 'empty') {
      finish('');
      result(m.id, { turn: { id: 'empty', status: 'completed' } });
      return;
    }
    if (prompt === 'fast') {
      finish('Fast response');
      result(m.id, { turn: { id: 'fast', status: 'completed' } });
      return;
    }
    result(m.id, { turn: { id: active, status: 'inProgress' } });
    if (prompt === 'wait') {
      event('item/agentMessage/delta', {
        turnId: active,
        itemId: active + '-assistant',
        delta: 'Partial response',
      });
      return;
    }
    if (prompt === 'crash') {
      setTimeout(() => process.exit(3), 20);
      return;
    }
    if (prompt === 'approve') {
      pending = 'approval-1';
      out({
        id: pending,
        method: 'item/commandExecution/requestApproval',
        params: {
          threadId: '12345678-1234-5678-9012-123456789012',
          turnId: active,
          itemId: 'command',
          command: 'echo approved',
          reason: 'Fixture approval',
        },
      });
      return;
    }
    if (prompt === 'question') {
      pending = 'question-1';
      out({
        id: pending,
        method: 'item/tool/requestUserInput',
        params: {
          threadId: '12345678-1234-5678-9012-123456789012',
          turnId: active,
          itemId: 'question',
          questions: [
            {
              id: 'choice',
              question: 'Which option?',
              isSecret: false,
              options: [{ label: 'First', description: 'The first choice' }],
            },
          ],
        },
      });
      return;
    }
    item(
      {
        id: active + '-command',
        type: 'commandExecution',
        command: 'printf hello',
        aggregatedOutput: '',
        status: 'inProgress',
      },
      false,
    );
    event('item/commandExecution/outputDelta', {
      turnId: active,
      itemId: active + '-command',
      delta: 'hello',
    });
    event('item/agentMessage/delta', {
      turnId: active,
      itemId: active + '-assistant',
      delta: 'Hello **',
    });
    setTimeout(() => {
      event('item/agentMessage/delta', {
        turnId: active,
        itemId: active + '-assistant',
        delta: 'world**',
      });
      item({
        id: active + '-command',
        type: 'commandExecution',
        command: 'printf hello',
        aggregatedOutput: 'hello',
        status: 'completed',
        exitCode: 0,
      });
      item({
        id: active + '-files',
        type: 'fileChange',
        status: 'completed',
        changes: [{ path: 'example.ts', diff: '+added' }],
      });
      finish('Hello **world**');
    }, 50);
  } else if (m.method === 'turn/interrupt') {
    pending = null;
    result(m.id, {});
    finish('Partial response', 'interrupted');
  } else if (!m.method && m.id === pending) {
    pending = null;
    finish(
      m.result.decision
        ? m.result.decision === 'accept'
          ? 'Approved'
          : 'Declined'
        : m.result.answers.choice.answers[0],
    );
  }
});
