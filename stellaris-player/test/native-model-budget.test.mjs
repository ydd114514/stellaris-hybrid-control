import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createNativeModelBudget} from '../src/native-model-budget.mjs';

async function fixture(t){
 const directory=await mkdtemp(join(tmpdir(),'native-model-window-'));
 const relays=new Set(),calls=[],states=[];
 let time=4000000;
 t.after(async()=>{
  for(const relay of relays)await relay.close();
  await rm(directory,{recursive:true,force:true});
 });
 const path=join(directory,'window.json');
 const open=async options=>{
  const relay=await createNativeModelBudget({path,maxRequests:2,now:()=>time,keepAliveMs:15,
   baseURL:'https://fixture.invalid/custom/v1',
   fetcher:async(url,request)=>{
    calls.push({url,method:request.method,auth:request.headers['x-api-key'],agent:request.headers['user-agent'],protocol:request.headers['anthropic-version']});
    return new Response('event: message_stop\ndata: {"type":"message_stop"}\n\n',{headers:{'content-type':'text/event-stream','request-id':'fixture-request','retry-after':'2'}});
   },
   onWaiting:(waiting,limit)=>states.push({waiting,limit}),...options});
  relays.add(relay);
  return relay;
 };
 return {path,calls,states,open,advance:ms=>time+=ms};
}
const submit=relay=>fetch(relay.baseURL+'/v1/messages',{
 method:'POST',body:JSON.stringify({model:'fixture',messages:[]}),
 headers:{'content-type':'application/json','x-api-key':'fixture-only','user-agent':'fixture-dsh','anthropic-version':'2023-06-01'},signal:AbortSignal.timeout(3000)
});

test('normal DSH hourly limit holds request N+1 locally with a Chinese notice and SSE keepalive',async t=>{
 const f=await fixture(t),relay=await f.open();
 const accepted=await Promise.all([submit(relay),submit(relay)]);
 for(const response of accepted){
  assert.match(await response.text(),/message_stop/);
  assert.equal(response.headers.get('request-id'),'fixture-request');
  assert.equal(response.headers.get('retry-after'),'2');
 }
 assert.equal(f.calls.length,2);
 assert.deepEqual(f.calls[0],{url:'https://fixture.invalid/custom/v1/messages',method:'POST',auth:'fixture-only',agent:'fixture-dsh',protocol:'2023-06-01'});
 const paused=await submit(relay);
 const reader=paused.body.getReader();
 const decoder=new TextDecoder();
 assert.match(decoder.decode((await reader.read()).value),/已达每小时 2 次模型请求上限.*已委派的原生 AI 继续运营/);
 assert.match(decoder.decode((await reader.read()).value),/等待战略复查额度/);
 assert.equal(f.calls.length,2);
 assert.deepEqual(f.states,[{waiting:true,limit:2}]);
 f.advance(60*60*1000);
 let resumed='';
 for(;;){
  const part=await reader.read();
  if(part.done)break;
  resumed+=decoder.decode(part.value);
 }
 assert.match(resumed,/message_stop/);
 assert.equal(f.calls.length,3);
 assert.deepEqual(f.states,[{waiting:true,limit:2},{waiting:false,limit:2}]);
 assert.deepEqual(JSON.parse(await readFile(f.path,'utf8')),[7600000]);
});

test('next normal controller round shares prior reservations and stop prevents forwarding held requests',async t=>{
 const f=await fixture(t);
 const previous=await f.open({maxRequests:1});
 await (await submit(previous)).text();
 await assert.rejects(f.open({maxRequests:1}),/另一控制器/);
 await previous.close();

 const next=await f.open({maxRequests:1});
 const paused=await submit(next);
 const reader=paused.body.getReader(),decoder=new TextDecoder();
 assert.match(decoder.decode((await reader.read()).value),/已达每小时 1 次模型请求上限/);
 next.seal();
 f.advance(60*60*1000);
 assert.match(decoder.decode((await reader.read()).value),/等待战略复查额度/);
 assert.equal(f.calls.length,1);
 await reader.cancel();
});
