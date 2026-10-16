import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test(
  'project sessions and independent schedules run concurrently with isolated controls',
  { timeout: 20000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'manager-concurrent-'));
    const original = {
      PATH: process.env.PATH,
      AGENT_MANAGER_DB_PATH: process.env.AGENT_MANAGER_DB_PATH,
      AGENT_MANAGER_SKILL_HOME: process.env.AGENT_MANAGER_SKILL_HOME,
    };
    const parent = join(directory, 'acme'),
      code = join(parent, 'code');
    await mkdir(join(directory, 'bin'));
    await mkdir(code, { recursive: true });
    await writeFile(
      join(directory, 'bin/codex'),
      `#!${process.execPath}
const readline = require('node:readline');
const { randomUUID } = require('node:crypto');
let thread = randomUUID(), turn, pending;
const out = value => process.stdout.write(JSON.stringify(value)+'\\n');
const result = (id,value) => out({id,result:value});
const event = (method,params) => out({method,params:{threadId:thread,...params}});
const finish = (status='completed') => {
  event('item/completed',{turnId:turn,item:{id:turn+'-assistant',type:'agentMessage',text:'Finished '+thread}});
  event('turn/completed',{turn:{id:turn,status,items:[],error:null}});
  turn=null;
};
readline.createInterface({input:process.stdin}).on('line',line=>{
  const m=JSON.parse(line);
  if(m.method==='initialize') result(m.id,{});
  else if(m.method==='skills/list') result(m.id,{data:[]});
  else if(m.method==='thread/start'||m.method==='thread/resume') {
    thread=m.params.threadId||thread;
    result(m.id,{thread:{id:thread,turns:[]},model:'fixture',reasoningEffort:'low'});
  } else if(m.method==='turn/start') {
    turn=randomUUID();
    event('turn/started',{turn:{id:turn,status:'inProgress'}});
    result(m.id,{turn:{id:turn,status:'inProgress'}});
    const prompt=m.params.input[0].text.split('\\n\\n--- Previous session final response')[0];
    if(prompt==='approve') {
      pending='approval';
      out({id:pending,method:'item/commandExecution/requestApproval',params:{threadId:thread,turnId:turn,command:'echo approved'}});
    } else if(prompt!=='wait') setTimeout(()=>finish(),10);
  } else if(m.method==='turn/interrupt') { pending=null;result(m.id,{});finish('interrupted'); }
  else if(!m.method&&m.id===pending){pending=null;finish();}
});
`,
      { mode: 0o755 },
    );
    process.env.PATH = join(directory, 'bin') + ':' + original.PATH;
    process.env.AGENT_MANAGER_DB_PATH = join(directory, 'test.sqlite');
    process.env.AGENT_MANAGER_SKILL_HOME = join(directory, 'skill-home');
    const { database } = await import('../src/lib/database.ts');
    const { default: app } = await import('../src/app.ts');
    const { getSessionById, shutdownSessions } =
      await import('../src/services/sessions.ts');
    const { findSchedule } = await import('../src/repositories/schedules.ts');
    const { occurrenceSessions, findSessionById } =
      await import('../src/repositories/sessions.ts');
    const {
      initializeScheduledSessions,
      enqueueSchedule,
      dispatchScheduledSessions,
      stopScheduledSessions,
    } = await import('../src/services/scheduledSessions.ts');
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}/api`;
    const request = (method, path, body) =>
      fetch(base + path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const json = async (method, path, body) => {
      const response = await request(method, path, body);
      assert.ok(response.ok, await response.clone().text());
      return response.status === 204 ? null : response.json();
    };
    const wait = async (predicate) => {
      const deadline = Date.now() + 5000;
      while (!predicate()) {
        if (Date.now() > deadline)
          throw Error('Timed out waiting for concurrent sessions');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    };
    const end = async (id) => {
      await json('POST', `/sessions/${id}/cancel`, {});
      await wait(() => findSessionById(id).status === 'exited');
    };
    try {
      const project = await json('POST', '/projects', { name: 'Acme' });
      const start = async (workingDirectory) =>
        (
          await json('POST', '/sessions', {
            projectId: project.id,
            transport: 'chat',
            workingDirectory,
          })
        ).session;
      const a = await start(parent),
        b = await start(code),
        c = await start(code);
      assert.equal(
        new Set([
          a.codexConversationId,
          b.codexConversationId,
          c.codexConversationId,
        ]).size,
        3,
      );
      await json('POST', `/sessions/${a.id}/messages`, { prompt: 'wait' });
      await json('POST', `/sessions/${b.id}/messages`, { prompt: 'approve' });
      await json('POST', `/sessions/${c.id}/messages`, { prompt: 'wait' });
      await wait(() => getSessionById(b.id).chat.requests.size === 1);
      const legacyStop = await request(
        'DELETE',
        `/projects/${project.id}/session`,
      );
      assert.equal(legacyStop.status, 409);
      assert.equal(getSessionById(a.id).chat.state, 'working');
      assert.equal(getSessionById(c.id).chat.state, 'working');
      await json('POST', `/sessions/${b.id}/requests/approval`, {
        decision: 'accept',
      });
      await wait(() => getSessionById(b.id).chat.state === 'idle');
      assert.equal(getSessionById(a.id).chat.state, 'working');
      assert.equal(getSessionById(c.id).chat.state, 'working');
      await json('POST', `/sessions/${a.id}/interrupt`, {});
      await wait(() => getSessionById(a.id).chat.state === 'idle');
      assert.equal(getSessionById(c.id).chat.state, 'working');
      await end(a.id);
      const resumes = await Promise.all([
        request('POST', `/sessions/${a.id}/resume`, { transport: 'chat' }),
        request('POST', `/sessions/${a.id}/resume`, { transport: 'chat' }),
      ]);
      assert.deepEqual(
        resumes.map((response) => response.status).sort(),
        [201, 409],
      );
      assert.equal(
        getSessionById(a.id).info.codexConversationId,
        a.codexConversationId,
      );
      assert.equal(getSessionById(c.id).chat.state, 'working');

      const step = (name, prompt) => ({
        name,
        prompt,
        provider: 'codex',
        workingDirectory: code,
        settings: { model: null, effort: null, permissions: 'workspace-write' },
        timeoutMinutes: 1,
      });
      const schedule = async (name, steps) =>
        json('POST', '/schedules', {
          name,
          projectId: project.id,
          steps,
          kind: 'once',
          runAt: new Date(Date.now() + 60000).toISOString(),
          timezone: 'UTC',
          enabled: true,
        });
      const firstSchedule = await schedule('Ordered', [
        step('Approval', 'approve'),
        step('Follow-up', 'fast'),
      ]);
      const first = enqueueSchedule(findSchedule(firstSchedule.id));
      const secondSchedule = await schedule('Independent', [
        step('Wait', 'wait'),
      ]);
      const second = enqueueSchedule(findSchedule(secondSchedule.id));
      // Queued work does not prevent another manual session in the same folder.
      const d = await start(code);
      initializeScheduledSessions();
      await dispatchScheduledSessions();
      await wait(
        () =>
          getSessionById(first.id)?.chat.requests.size === 1 &&
          getSessionById(second.id)?.chat.state === 'working',
      );
      assert.equal(occurrenceSessions(first.occurrenceId)[1].status, 'queued');
      assert.equal(getSessionById(c.id).chat.state, 'working');
      await end(d.id);
      assert.equal(getSessionById(second.id).chat.state, 'working');
      await json('POST', `/sessions/${first.id}/requests/approval`, {
        decision: 'accept',
      });
      await wait(() =>
        occurrenceSessions(first.occurrenceId).every(
          (session) => session.outcome === 'succeeded',
        ),
      );
      assert.equal(getSessionById(second.id).chat.state, 'working');
      assert.equal(getSessionById(c.id).chat.state, 'working');
      await end(second.id);
      assert.equal(getSessionById(c.id).chat.state, 'working');
      await end(c.id);
      await end(a.id);
      await json('DELETE', `/projects/${project.id}/session`);
      await wait(() => findSessionById(b.id).status === 'exited');
      assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), []);
    } finally {
      stopScheduledSessions();
      await shutdownSessions();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      database.close();
      for (const [name, value] of Object.entries(original)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      await rm(directory, { recursive: true, force: true });
    }
  },
);
