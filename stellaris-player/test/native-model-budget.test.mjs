import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {dirname,join} from 'node:path';
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

const sse=(event,newline='\n')=>['event: '+event.type,'data: '+JSON.stringify(event),'',''].join(newline);

function fragmentedSse(wire,{close=true}={}){
 let offset=0,controller;
 const stream=new ReadableStream({
  start(value){controller=value;},
  pull(controller){
   if(offset<wire.length){
    controller.enqueue(wire.subarray(offset,offset+=7));
   }else if(close)controller.close();
  }
 });
 return {response:new Response(stream,{headers:{'content-type':'text/event-stream; charset=utf-8'}}),
  finish:()=>controller.close()};
}
const requestMetadata=async path=>(await readFile(join(dirname(path),'model-requests.jsonl'),'utf8'))
 .trim().split('\n').map(line=>JSON.parse(line));

test('thinking-only max-token SSE records only allowlisted metadata before terminal delivery',async t=>{
 const f=await fixture(t);
 const wire=Buffer.from(
  sse({type:'content_block_start',index:0,content_block:{type:'thinking',thinking:'内部正文不得记录'}},'\r\n')+
  sse({type:'content_block_delta',index:0,delta:{type:'thinking_delta',thinking:'fixture-thought-sentinel'}},'\r\n')+
  sse({type:'message_delta',delta:{stop_reason:'max_tokens'},usage:{output_tokens:8192}},'\r\n')+
  sse({type:'message_stop'},'\r\n')
 );
 const upstream=fragmentedSse(wire,{close:false});
 const relay=await f.open({fetcher:async()=>upstream.response});
 const response=await submit(relay);
 const reader=response.body.getReader(),received=[];
 let bytes=0;
 while(bytes<wire.length){
  const part=await reader.read();
  assert.equal(part.done,false);
  received.push(part.value);
  bytes+=part.value.byteLength;
 }
 assert.deepEqual(Buffer.concat(received),wire);
 const rows=await requestMetadata(f.path);
 assert.deepEqual(rows,[{at:4000000,status:200,stopReason:'max_tokens',outputTokens:8192,toolUse:false,textChars:0,thinkingOnly:true}]);
 const metadata=JSON.stringify(rows);
 assert.doesNotMatch(metadata,/fixture-only|fixture-thought-sentinel|内部正文|x-api-key|messages|anthropic-version/);
 upstream.finish();
 assert.equal((await reader.read()).done,true);
 assert.equal((await requestMetadata(f.path)).length,1);
});

test('tool-use SSE preserves original bytes and counts text without copying it or tool payloads',async t=>{
 const f=await fixture(t);
 const wire=Buffer.from(
  ': a heartbeat\r\r'+
  sse({type:'content_block_start',index:0,content_block:{type:'text',text:'起'}},'\r')+
  sse({type:'content_block_delta',index:0,delta:{type:'text_delta',text:'结束'}},'\n')+
  sse({type:'content_block_start',index:1,content_block:{type:'tool_use',name:'private-tool-name',input:{private:'fixture-tool-content'}}},'\r\n')+
  sse({type:'message_delta',delta:{stop_reason:'tool_use'},usage:{output_tokens:123}},'\n')+
  sse({type:'message_stop'},'\n')
 );
 const relay=await f.open({fetcher:async()=>fragmentedSse(wire).response});
 const response=await submit(relay);
 assert.deepEqual(Buffer.from(await response.arrayBuffer()),wire);
 const rows=await requestMetadata(f.path);
 assert.deepEqual(rows,[{at:4000000,status:200,stopReason:'tool_use',outputTokens:123,toolUse:true,textChars:3,thinkingOnly:false}]);
 assert.doesNotMatch(JSON.stringify(rows),/private-tool-name|fixture-tool-content|结束|fixture-only/);
});

test('unsupported provider metadata is discarded and failed responses still have a status-only row',async t=>{
 const f=await fixture(t);
 const wire=Buffer.from(
  sse({type:'message_delta',delta:{stop_reason:'fixture-only-response-secret'},usage:{output_tokens:'fixture-usage-secret'}})+
  sse({type:'message_stop'})
 );
 let calls=0;
 const relay=await f.open({fetcher:async()=>++calls===1?fragmentedSse(wire).response:
  new Response('fixture-error-response',{status:503,headers:{'content-type':'text/plain','request-id':'fixture-header-value'}})});
 assert.deepEqual(Buffer.from(await (await submit(relay)).arrayBuffer()),wire);
 const failed=await submit(relay);
 assert.equal(failed.status,503);
 assert.equal(await failed.text(),'fixture-error-response');
 const rows=await requestMetadata(f.path);
 const empty={at:4000000,status:200,stopReason:null,outputTokens:null,toolUse:false,textChars:0,thinkingOnly:false};
 assert.deepEqual(rows,[empty,{...empty,status:503}]);
 assert.doesNotMatch(JSON.stringify(rows),/fixture-only-response-secret|fixture-usage-secret|fixture-error-response|fixture-header-value/);
});

test('sealing the relay logs an admitted upstream cancellation exactly once',async t=>{
 const f=await fixture(t);
 let signalStarted;
 const started=new Promise(resolve=>signalStarted=resolve);
 const relay=await f.open({fetcher:async(_,request)=>new Promise((resolve,reject)=>{
  request.signal.addEventListener('abort',()=>reject(Error('fixture network error')),{once:true});
  signalStarted();
 })});
 const request=submit(relay).catch(()=>null);
 await started;
 await relay.close();
 await request;
 assert.deepEqual(await requestMetadata(f.path),[
  {at:4000000,status:null,stopReason:null,outputTokens:null,toolUse:false,textChars:0,thinkingOnly:false}
 ]);
});
