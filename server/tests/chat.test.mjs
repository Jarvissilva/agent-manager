import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

const threadId = '12345678-1234-5678-9012-123456789012';
test(
  'chat streams, approves, interrupts, reconnects and resumes the same conversation',
  { timeout: 25000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-manager-chat-'));
    const originalPath = process.env.PATH;
    const originalDb = process.env.AGENT_MANAGER_DB_PATH;
    await mkdir(join(directory, 'bin'));
    await mkdir(join(directory, 'fail'));
    await writeFile(
      join(directory, 'bin/codex'),
      `#!${process.execPath}
const fs = require('node:fs');
const readline = require('node:readline');
const path = require('node:path');
const file = path.join(process.cwd(), 'history.json');
let history = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file,'utf8')) : [];
let count = history.length;
let active;
let pending;
const out = m => process.stdout.write(JSON.stringify(m)+'\\n');
const result = (id,value) => out({id,result:value});
const event = (method,params) => out({method,params:{threadId:'${threadId}',...params}});
const item = (value, done=true) => {
  if(done){ const idx=history.findIndex(x=>x.item.id===value.id); const entry={turnId:active,item:value}; if(idx<0)history.push(entry);else history[idx]=entry; fs.writeFileSync(file,JSON.stringify(history)); }
  event(done?'item/completed':'item/started',{turnId:active,item:value});
};
const finish = (text,status='completed') => {
  item({id:active+'-assistant',type:'agentMessage',text});
  event('turn/completed',{turn:{id:active,status,items:[],error:null}});
  active=null;
};
readline.createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);
 if(m.method==='initialize')result(m.id,{});
 else if(m.method==='skills/list')result(m.id,{data:[]});
 else if(m.method==='model/list')result(m.id,m.params.cursor ? {data:[{id:'fixture-b',model:'fixture-b',displayName:'Fixture B',description:'Second model',isDefault:false,defaultReasoningEffort:'medium',supportedReasoningEfforts:[{reasoningEffort:'medium',description:'Balanced'}]}],nextCursor:null} : {data:[{id:'fixture-a',model:'fixture-a',displayName:'Fixture A',description:'Default model',isDefault:true,defaultReasoningEffort:'low',supportedReasoningEfforts:[{reasoningEffort:'low',description:'Fast'},{reasoningEffort:'high',description:'Deep'}]}],nextCursor:'page-2'});
 else if(m.method==='thread/start'||m.method==='thread/resume'){
   if(process.cwd().endsWith('/fail')){out({id:m.id,error:{message:'Fixture startup failure'}});return;}
   fs.writeFileSync(path.join(process.cwd(),'launch.json'),JSON.stringify({args:process.argv.slice(2),params:m.params}));
   result(m.id,{thread:{id:'${threadId}',historyMode:'paginated',turns:[]},model:m.params.model||'fixture-a',reasoningEffort:m.params.config?.model_reasoning_effort||'low'});
 }
 else if(m.method==='thread/items/list')result(m.id,{data:history,nextCursor:null});
 else if(m.method==='turn/start'){
   fs.writeFileSync(path.join(process.cwd(),'turn.json'),JSON.stringify(m.params));
   const prompt=m.params.input[0].text;
   if(prompt==='reject'){out({id:m.id,error:{message:'Fixture turn rejected'}});return;}
   active='turn-'+(++count);
   event('turn/started',{turn:{id:active,status:'inProgress'}});
   item({id:active+'-user',type:'userMessage',content:[{type:'text',text:prompt}]});
   item({id:active+'-assistant',type:'agentMessage',text:''},false);
   if(prompt==='fast'){finish('Fast response');result(m.id,{turn:{id:'fast',status:'completed'}});return;}
   result(m.id,{turn:{id:active,status:'inProgress'}});
   if(prompt==='wait'){event('item/agentMessage/delta',{turnId:active,itemId:active+'-assistant',delta:'Partial response'});return;}
   if(prompt==='crash'){setTimeout(()=>process.exit(3),20);return;}
   if(prompt==='approve'){
     pending='approval-1';out({id:pending,method:'item/commandExecution/requestApproval',params:{threadId:'${threadId}',turnId:active,itemId:'command',command:'echo approved',reason:'Fixture approval'}});return;
   }
   if(prompt==='question'){
     pending='question-1';out({id:pending,method:'item/tool/requestUserInput',params:{threadId:'${threadId}',turnId:active,itemId:'question',questions:[{id:'choice',question:'Which option?',isSecret:false,options:[{label:'First',description:'The first choice'}]}]}});return;
   }
   item({id:active+'-command',type:'commandExecution',command:'printf hello',aggregatedOutput:'',status:'inProgress'},false);
   event('item/commandExecution/outputDelta',{turnId:active,itemId:active+'-command',delta:'hello'});
   event('item/agentMessage/delta',{turnId:active,itemId:active+'-assistant',delta:'Hello **'});
   setTimeout(()=>{
     event('item/agentMessage/delta',{turnId:active,itemId:active+'-assistant',delta:'world**'});
     item({id:active+'-command',type:'commandExecution',command:'printf hello',aggregatedOutput:'hello',status:'completed',exitCode:0});
     item({id:active+'-files',type:'fileChange',status:'completed',changes:[{path:'example.ts',diff:'+added'}]});
     finish('Hello **world**');
   },50);
 }
 else if(m.method==='turn/interrupt'){pending=null;result(m.id,{});finish('Partial response','interrupted');}
 else if(!m.method && m.id===pending){pending=null;finish(m.result.decision ? m.result.decision==='accept'?'Approved':'Declined' : m.result.answers.choice.answers[0]);}
});
`,
      { mode: 0o755 },
    );
    process.env.PATH = `${directory}/bin:${originalPath}`;
    const originalSkillHome = process.env.AGENT_MANAGER_SKILL_HOME;
    process.env.AGENT_MANAGER_DB_PATH = join(directory, 'test.sqlite');
    process.env.AGENT_MANAGER_SKILL_HOME = join(
      directory,
      'test.sqlite',
    ).replace(/[^/]+$/, 'provider-home');
    const { database } = await import('../src/lib/database.ts');
    const { default: app } = await import('../src/app.ts');
    const { getSession, shutdownSessions } =
      await import('../src/services/sessions.ts');
    const { listSessionItems } =
      await import('../src/repositories/sessionItems.ts');
    database.prepare('INSERT INTO projects(name) VALUES(?)').run('Chat');
    database.prepare('INSERT INTO projects(name) VALUES(?)').run('Failure');
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const streams = [];
    const sessionBody = (method, path, body) =>
      method === 'POST' &&
      /\/projects\/\d+\/session$/.test(path) &&
      !body?.resumeSessionId
        ? {
            workingDirectory: directory + (path.includes('/2/') ? '/fail' : ''),
            ...body,
          }
        : body;
    const request = (method, path, body, origin = base) =>
      fetch(base + '/api' + path, {
        method,
        headers: {
          Origin: origin,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(sessionBody(method, path, body)),
      });
    const waitFor = async (predicate) => {
      const deadline = Date.now() + 5000;
      while (!predicate()) {
        if (Date.now() > deadline) throw Error('Timed out waiting for chat');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    };
    const stream = async (id) => {
      const abort = new AbortController();
      streams.push(abort);
      const response = await fetch(`${base}/api/sessions/${id}/chat`, {
        signal: abort.signal,
      });
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /text\/event-stream/);
      const events = [];
      const reader = response.body.getReader();
      void (async () => {
        let buffer = '';
        const decoder = new TextDecoder();
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let split;
            while ((split = buffer.indexOf('\n\n')) >= 0) {
              const line = buffer.slice(0, split);
              buffer = buffer.slice(split + 2);
              if (line.startsWith('data: '))
                events.push(JSON.parse(line.slice(6)));
            }
          }
        } catch (error) {
          if (!abort.signal.aborted) throw error;
        }
      })();
      await waitFor(() => events.length);
      return { events, abort };
    };
    try {
      const models = await (
        await request('GET', '/providers/codex/models')
      ).json();
      assert.deepEqual(
        models.map((model) => model.model),
        ['fixture-a', 'fixture-b'],
      );
      assert.equal(
        models[0].supportedReasoningEfforts[1].reasoningEffort,
        'high',
      );
      assert.equal(
        (
          await request('POST', '/projects/1/session', {
            transport: 'chat',
            settings: {
              model: 'missing',
              effort: null,
              permissions: 'read-only',
            },
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await request('POST', '/projects/1/session', {
            transport: 'chat',
            settings: {
              model: 'fixture-b',
              effort: 'high',
              permissions: 'read-only',
            },
          })
        ).status,
        400,
      );
      assert.equal(
        (await request('POST', '/projects/1/session', { transport: 'invalid' }))
          .status,
        400,
      );
      const start = await request('POST', '/projects/1/session', {
        transport: 'chat',
        settings: {
          model: 'fixture-a',
          effort: 'high',
          permissions: 'read-only',
        },
      });
      assert.equal(start.status, 201);
      const { session } = await start.json();
      assert.equal(session.transport, 'chat');
      assert.equal(session.codexConversationId, threadId);
      const chat = getSession(1).chat;
      assert.equal(chat.state, 'idle');
      const launch = JSON.parse(
        await readFile(join(directory, 'launch.json'), 'utf8'),
      );
      assert.ok(launch.args.includes('app-server'));
      assert.equal(launch.params.approvalPolicy, 'on-request');
      assert.equal(launch.params.sandbox, 'read-only');
      assert.equal(launch.params.model, 'fixture-a');
      assert.equal(launch.params.config.model_reasoning_effort, 'high');
      assert.equal(
        (await request('POST', '/projects/1/session', { transport: 'chat' }))
          .status,
        409,
      );
      assert.equal(
        (
          await request(
            'POST',
            `/sessions/${session.id}/messages`,
            { prompt: 'hi' },
            'https://untrusted.invalid',
          )
        ).status,
        403,
      );
      assert.equal(
        (
          await request('POST', `/sessions/${session.id}/messages`, {
            prompt: '  ',
          })
        ).status,
        400,
      );
      const first = await stream(session.id);
      assert.equal(first.events[0].state, 'idle');
      const send = (prompt, settings) =>
        request('POST', `/sessions/${session.id}/messages`, {
          prompt,
          settings,
        });
      assert.equal(
        (
          await send('bad settings', {
            model: 'fixture-b',
            effort: 'high',
            permissions: 'workspace-write',
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await send('hello', {
            model: 'fixture-b',
            effort: 'medium',
            permissions: 'workspace-write',
          })
        ).status,
        202,
      );
      await waitFor(() => chat.state === 'idle');
      const turn = JSON.parse(
        await readFile(join(directory, 'turn.json'), 'utf8'),
      );
      assert.equal(turn.model, 'fixture-b');
      assert.equal(turn.effort, 'medium');
      assert.equal(turn.sandboxPolicy.type, 'workspaceWrite');
      assert.deepEqual(
        JSON.parse(
          database
            .prepare('SELECT chatSettings FROM sessions WHERE id = ?')
            .get(session.id).chatSettings,
        ),
        {
          model: 'fixture-b',
          effort: 'medium',
          permissions: 'workspace-write',
        },
      );
      assert.ok(first.events.some((e) => e.item?.text === 'Hello **'));
      assert.ok(first.events.some((e) => e.item?.type === 'fileChange'));
      assert.equal(
        [...chat.items.values()].filter((i) => i.role === 'user').length,
        1,
      );
      assert.equal(
        [...chat.items.values()].find((i) => i.type === 'commandExecution')
          .text,
        'hello\nExit code: 0',
      );
      assert.equal(listSessionItems(session.id).length, chat.items.size);
      first.abort.abort();
      const reconnected = await stream(session.id);
      assert.equal(reconnected.events[0].items.length, chat.items.size);
      assert.equal((await send('wait')).status, 202);
      await waitFor(() => chat.turnId);
      assert.equal((await send('duplicate')).status, 409);
      assert.equal(
        (await request('POST', `/sessions/${session.id}/interrupt`, {})).status,
        200,
      );
      await waitFor(() => chat.state === 'idle');
      assert.ok(
        [...chat.items.values()].some((i) => i.text === 'Partial response'),
      );
      assert.equal((await send('approve')).status, 202);
      await waitFor(() => chat.requests.size === 1);
      assert.equal(
        chat.snapshot().requests[0].detail,
        'echo approved\nFixture approval',
      );
      assert.equal(
        (
          await request('POST', `/sessions/${session.id}/requests/approval-1`, {
            decision: 'anything',
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await request('POST', `/sessions/${session.id}/requests/approval-1`, {
            decision: 'accept',
          })
        ).status,
        200,
      );
      await waitFor(() => chat.state === 'idle');
      assert.equal(
        (
          await request('POST', `/sessions/${session.id}/requests/approval-1`, {
            decision: 'accept',
          })
        ).status,
        409,
      );
      assert.ok([...chat.items.values()].some((i) => i.text === 'Approved'));
      assert.equal((await send('approve')).status, 202);
      await waitFor(() => chat.requests.size === 1);
      assert.equal(
        (
          await request('POST', `/sessions/${session.id}/requests/approval-1`, {
            decision: 'decline',
          })
        ).status,
        200,
      );
      await waitFor(() => chat.state === 'idle');
      assert.ok([...chat.items.values()].some((i) => i.text === 'Declined'));
      assert.equal((await send('question')).status, 202);
      await waitFor(() => chat.requests.size === 1);
      assert.equal(
        (
          await request('POST', `/sessions/${session.id}/requests/question-1`, {
            answers: {},
          })
        ).status,
        400,
      );
      assert.equal(
        (
          await request('POST', `/sessions/${session.id}/requests/question-1`, {
            answers: { choice: 'First' },
          })
        ).status,
        200,
      );
      await waitFor(() => chat.state === 'idle');
      assert.ok([...chat.items.values()].some((i) => i.text === 'First'));
      assert.equal((await send('fast')).status, 202);
      assert.equal(chat.state, 'idle');
      assert.equal(chat.turnId, null);
      assert.equal((await send('reject')).status, 502);
      assert.equal(chat.state, 'idle');
      const skill = await (
        await request('POST', '/skills', {
          name: 'Release',
          nativeName: 'release',
          description: 'Use when releasing.',
          instructions: 'Secret workflow body is loaded natively.',
        })
      ).json();
      assert.equal((await send('$release inspect')).status, 202);
      await waitFor(() => chat.state === 'idle');
      const nativeTurn = JSON.parse(
        await readFile(join(directory, 'turn.json'), 'utf8'),
      );
      assert.deepEqual(nativeTurn.input[1], {
        type: 'skill',
        name: 'release',
        path: join(skill.path, 'SKILL.md'),
      });
      assert.ok(!JSON.stringify(nativeTurn).includes('Secret workflow body'));
      const count = chat.items.size;
      await request('DELETE', '/projects/1/session');
      await waitFor(() => getSession(1).info.status === 'exited');
      const resumed = await request('POST', '/projects/1/session', {
        transport: 'chat',
        resumeSessionId: session.id,
      });
      assert.equal(resumed.status, 201);
      assert.equal((await resumed.json()).session.id, session.id);
      const resumedChat = getSession(1).chat;
      assert.deepEqual(resumedChat.info.chatSettings, {
        model: 'fixture-b',
        effort: 'medium',
        permissions: 'workspace-write',
      });
      assert.equal(resumedChat.items.size, count);
      assert.equal(
        database
          .prepare('SELECT count(*) AS count FROM sessions WHERE projectId=1')
          .get().count,
        1,
      );
      assert.equal(listSessionItems(session.id).length, count);
      assert.equal((await send('crash')).status, 202);
      await waitFor(() => getSession(1).info.status === 'exited');
      assert.equal(resumedChat.state, 'closed');
      assert.ok(resumedChat.error);
      assert.ok(
        [...resumedChat.items.values()].some((i) => i.status === 'interrupted'),
      );
      const saved = await stream(session.id);
      assert.equal(saved.events[0].state, 'closed');
      assert.ok(saved.events[0].items.length);
      assert.equal((await send('after close')).status, 409);
      const failed = await request('POST', '/projects/2/session', {
        transport: 'chat',
      });
      assert.equal(failed.status, 503);
      await waitFor(() => getSession(2).info.status === 'exited');
    } finally {
      for (const stream of streams) stream.abort();
      await shutdownSessions();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      database.close();
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
      if (originalDb === undefined) delete process.env.AGENT_MANAGER_DB_PATH;
      else process.env.AGENT_MANAGER_DB_PATH = originalDb;
      if (originalSkillHome === undefined)
        delete process.env.AGENT_MANAGER_SKILL_HOME;
      else process.env.AGENT_MANAGER_SKILL_HOME = originalSkillHome;
      await rm(directory, { recursive: true, force: true });
    }
  },
);
