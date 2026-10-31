import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createLiveModelBudget} from '../src/live-model-budget.mjs';
test('actual request and response model identifiers are recorded without retaining messages',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'fish-live-models-'));
 const proxy=await createLiveModelBudget({directory,fetcher:async()=>new Response(JSON.stringify({model:'server-flash',usage:{input_tokens:7,output_tokens:2}}))});
 t.after(async()=>{await proxy.close();await rm(directory,{recursive:true,force:true});});
 await (await fetch(proxy.baseURL+'/v1/messages',{method:'POST',body:JSON.stringify({model:'requested-flash',messages:[{content:'do-not-retain-message'}]})})).text();await proxy.close();
 assert.deepEqual(proxy.report.requestedModels,['requested-flash']);assert.deepEqual(proxy.report.serverModels,['server-flash']);assert.equal(proxy.report.usage.output_tokens,2);
 assert.equal((await readFile(join(directory,'model-usage.jsonl'),'utf8')).includes('do-not-retain-message'),false);
});
test('closing waits for the final audit of an interrupted upstream request',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'fish-live-close-'));let markStarted;const started=new Promise(done=>markStarted=done);
 const proxy=await createLiveModelBudget({directory,fetcher:async(_url,{signal})=>new Promise((_done,reject)=>{signal.addEventListener('abort',()=>setTimeout(()=>reject(Error('test abort')),20),{once:true});markStarted();})});
 t.after(async()=>{await proxy.close();await rm(directory,{recursive:true,force:true});});
 const request=fetch(proxy.baseURL+'/v1/messages',{method:'POST',body:'{}'}).catch(()=>null);
 await started;await proxy.close();await request;
 assert.equal(proxy.report.failed,1);assert.equal(proxy.report.rows.at(-1).status,'failed');
 const rows=(await readFile(join(directory,'model-usage.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);assert.equal(rows.at(-1).status,'failed');
});
test('live budget counts actual upstream calls, audits SSE usage and never stores credentials or prompts',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'fish-live-budget-'));let actual=0,limited=0;
 const proxy=await createLiveModelBudget({directory,maxRequests:1,onLimit:()=>limited++,fetcher:async(url,opts)=>{actual++;assert.equal(url,'https://api.deepseek.com/anthropic/v1/messages');assert.equal(opts.headers.authorization,'Bearer private-test-value');return new Response('data: {"type":"message_start","message":{"usage":{"input_tokens":12,"cache_read_input_tokens":3}}}\n\ndata: {"type":"message_delta","usage":{"output_tokens":5}}\n\n',{headers:{'content-type':'text/event-stream'}});}});
 t.after(async()=>{await proxy.close();await rm(directory,{recursive:true,force:true});});
 const options={method:'POST',headers:{authorization:'Bearer private-test-value','content-type':'application/json'},body:JSON.stringify({secretPrompt:'never-log-this'})};
 assert.equal((await fetch(proxy.baseURL+'/v1/messages',options)).status,200);
 assert.equal((await fetch(proxy.baseURL+'/v1/messages',options)).status,429);
 assert.equal(actual,1);assert.equal(limited,1);assert.equal(proxy.report.usage.output_tokens,5);
 assert.deepEqual(proxy.report.rows[0].usage,{});assert.equal(proxy.report.rows[1].usage.output_tokens,5);
 const log=await readFile(join(directory,'model-usage.jsonl'),'utf8');assert(!log.includes('private-test-value'));assert(!log.includes('never-log-this'));
});
test('budget relay does not forward arbitrary routes',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'fish-live-budget-'));let actual=0;
 const proxy=await createLiveModelBudget({directory,fetcher:async()=>{actual++;return new Response('{}');}});t.after(async()=>{await proxy.close();await rm(directory,{recursive:true,force:true});});
 assert.equal((await fetch(proxy.baseURL+'/other',{method:'POST',body:'{}'})).status,404);assert.equal(actual,0);
});
test('sealing stops new paid calls while an admitted request can finish before host shutdown',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'fish-live-seal-'));let entered,release;
 const admitted=new Promise(done=>entered=done),finish=new Promise(done=>release=done);let actual=0;
 const proxy=await createLiveModelBudget({directory,fetcher:async()=>{actual++;entered();await finish;return new Response('{"usage":{"output_tokens":1}}');}});
 t.after(async()=>{await proxy.close();await rm(directory,{recursive:true,force:true});});
 const first=fetch(proxy.baseURL+'/v1/messages',{method:'POST',body:'{}'}).then(r=>r.text());await admitted;
 proxy.seal();release();await first;
 const blocked=fetch(proxy.baseURL+'/v1/messages',{method:'POST',body:'{}'}).catch(()=>null);
 for(let i=0;i<50&&!proxy.report.blockedAfterStop;i++)await new Promise(done=>setTimeout(done,2));
 assert.equal(proxy.report.blockedAfterStop,1);assert.equal(actual,1);assert.equal(proxy.report.completed,1);assert.equal(proxy.report.failed,0);
 await proxy.close();await blocked;assert.equal(proxy.report.forwardedRequests,1);
});
test('a cooperative quota stop does not inject a 429 agent error before host handoff',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'fish-live-cooperative-limit-'));let actual=0,limited=0,proxy;
 proxy=await createLiveModelBudget({directory,maxRequests:1,onLimit:()=>{limited++;proxy.seal();},fetcher:async()=>{actual++;return new Response('{}');}});
 t.after(async()=>{await proxy.close();await rm(directory,{recursive:true,force:true});});
 await (await fetch(proxy.baseURL+'/v1/messages',{method:'POST',body:'{}'})).text();
 let received=false;
 const next=fetch(proxy.baseURL+'/v1/messages',{method:'POST',body:'{}'}).then(()=>{received=true;},()=>{});
 for(let i=0;i<50&&!proxy.report.blockedAfterStop;i++)await new Promise(done=>setTimeout(done,2));
 assert.equal(limited,1);assert.equal(received,false);assert.equal(proxy.report.blockedAfterStop,1);
 assert.equal(actual,1);assert.equal(proxy.report.forwardedRequests,1);
 await proxy.close();await next;
});
