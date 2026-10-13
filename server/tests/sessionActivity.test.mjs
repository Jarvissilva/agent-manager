import assert from 'node:assert/strict';
import test from 'node:test';
import { sessionActivity } from '../src/lib/sessionActivity.ts';

const info = {
  transport: 'chat',
  mode: 'interactive',
  status: 'running',
  exitCode: null,
};
const chat = (state, error = null, requests = 0) => ({
  state,
  error,
  requests: { size: requests },
});

test('chat activity describes turns rather than provider process lifetime', () => {
  assert.equal(sessionActivity(info, chat('starting')), 'ready');
  assert.equal(sessionActivity(info, chat('idle')), 'ready');
  assert.equal(sessionActivity(info, chat('working')), 'running');
  assert.equal(sessionActivity(info, chat('stopping')), 'running');
  assert.equal(sessionActivity(info, chat('working', null, 1)), 'needs_input');
  assert.equal(
    sessionActivity(info, chat('idle', 'API request failed')),
    'error',
  );
  // Starting another turn takes precedence over the previous saved failure.
  assert.equal(
    sessionActivity({ ...info, error: 'Old failure' }, chat('working')),
    'running',
  );
  assert.equal(
    sessionActivity({ ...info, error: 'Old failure' }, chat('idle')),
    'ready',
  );
});

test('saved sessions retain meaningful outcomes without exposing process states', () => {
  const ended = { ...info, status: 'exited', exitCode: 0 };
  assert.equal(sessionActivity(ended), 'ready');
  assert.equal(sessionActivity({ ...ended, outcome: 'succeeded' }), 'ready');
  assert.equal(
    sessionActivity({ ...ended, outcome: 'cancelled', exitCode: 143 }),
    'ready',
  );
  assert.equal(sessionActivity({ ...ended, outcome: 'skipped' }), 'ready');
  for (const outcome of ['failed', 'timed_out', 'interrupted']) {
    assert.equal(sessionActivity({ ...ended, outcome }), 'error');
  }
  assert.equal(sessionActivity({ ...ended, status: 'interrupted' }), 'error');
  assert.equal(sessionActivity({ ...ended, error: 'Failed request' }), 'error');
  assert.equal(sessionActivity({ ...ended, exitCode: 1 }), 'error');
  assert.equal(sessionActivity(ended, chat('closed')), 'ready');
  assert.equal(
    sessionActivity(
      { ...ended, outcome: 'cancelled' },
      chat('closed', 'Disconnected'),
    ),
    'ready',
  );
});

test('queued and execution sessions are supported without guessing terminal activity', () => {
  assert.equal(sessionActivity({ ...info, status: 'queued' }), 'queued');
  assert.equal(
    sessionActivity({ ...info, mode: 'exec', transport: 'terminal' }),
    'running',
  );
  assert.equal(sessionActivity({ ...info, transport: 'terminal' }), null);
  assert.equal(sessionActivity({ ...info, transport: undefined }), null);
});
