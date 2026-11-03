import {randomUUID} from 'node:crypto';
import {appendFile,open,readFile,unlink,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {dirname,join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {replaceCheckpoint} from './checkpoint-replace.mjs';
import {nativeModelRequestLimit} from './hybrid-settings-store.mjs';

const HOUR_MS=60*60*1000;
const MAX_BODY_BYTES=4*1024*1024;
const MAX_SSE_FRAME_CHARS=1024*1024;
const STOP_REASONS=new Set(['end_turn','stop_sequence','tool_use','max_tokens','pause_turn','refusal','model_context_window_exceeded']);
const REPLY_HEADERS={'content-type':'text/event-stream','cache-control':'no-store'};
const FORWARD_HEADERS=['content-type','accept','user-agent','authorization','x-api-key','anthropic-version','anthropic-beta',
 'x-deepseek-harness-user-id','x-deepseek-harness-session-id','x-deepseek-harness-compact'];
const RESPONSE_HEADERS=['content-type','retry-after','request-id','x-request-id','x-deepseek-request-id'];

export const modelBudgetNotice=limit=>`已达每小时 ${limit} 次模型请求上限，战略复查等待额度，已委派的原生 AI 继续运营。`;

async function claimWindow(path){
 const lockPath=path+'.lock';
 let handle;
 try{handle=await open(lockPath,'wx');}
 catch(error){
  if(error.code!=='EEXIST')throw error;
  const owner=await readFile(lockPath,'utf8');
  if(!/^\d{1,10}$/.test(owner))throw Error('模型预算记录正被另一控制器使用');
  try{process.kill(Number(owner),0);}
  catch(cause){
   if(cause.code!=='ESRCH')throw cause;
   if(await readFile(lockPath,'utf8')!==owner)throw Error('模型预算记录正被另一控制器使用');
   await unlink(lockPath);
   handle=await open(lockPath,'wx');
  }
  if(!handle)throw Error('模型预算记录正被另一控制器使用');
 }
 try{await handle.writeFile(String(process.pid));}
 catch(error){await handle.close();await unlink(lockPath);throw error;}
 await handle.close();
 return ()=>unlink(lockPath);
}

async function loadWindow(path){
 let contents;
 try{contents=await readFile(path,'utf8');}
 catch(error){if(error.code==='ENOENT')return [];throw error;}
 const timestamps=contents.length<=8192?JSON.parse(contents):null;
 if(!Array.isArray(timestamps)||timestamps.length>200||timestamps.some(x=>!Number.isSafeInteger(x)||x<0))
  throw Error('模型预算记录无效，已阻止模型请求');
 return timestamps.sort((a,b)=>a-b);
}

async function saveWindow(path,timestamps){
 const temporary=path+'.'+randomUUID()+'.tmp';
 try{
  await writeFile(temporary,JSON.stringify(timestamps),{flag:'wx',mode:0o600});
  await replaceCheckpoint(temporary,path);
 }finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}

function messagesEndpoint(baseURL){
 const url=new URL(baseURL??'https://api.deepseek.com/anthropic');
 if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)
  throw Error('DeepSeek 消息服务地址无效');
 const path=url.pathname.replace(/\/+$/u,'');
 url.pathname=path+(path.endsWith('/v1')?'':'/v1')+'/messages';
 return url.href;
}

async function readBody(req){
 const chunks=[];
 let size=0;
 for await(const chunk of req){
  size+=chunk.length;
  if(size>MAX_BODY_BYTES)throw Error('模型请求体过大');
  chunks.push(chunk);
 }
 return Buffer.concat(chunks);
}

function apiError(res,streaming,error={type:'api_error',message:'模型请求未能完成'}){
 if(streaming)res.end('event: error\ndata: '+JSON.stringify({type:'error',error})+'\n\n');
 else res.writeHead(502,{'content-type':'application/json'}).end(JSON.stringify({type:'error',error}));
}

async function streamUpstreamError(res,upstream){
 // The client already received SSE headers while waiting. Preserve the
 // provider's error class after admission rather than converting it to a retry.
 const type={400:'invalid_request_error',401:'authentication_error',403:'permission_error',
  413:'invalid_request_error',429:'rate_limit_error'}[upstream.status]??'api_error';
 let details='';
 if(upstream.body)for await(const chunk of upstream.body){
  details+=Buffer.from(chunk).toString('utf8');
  if(details.length>8192)break;
 }
 let error;
 try{error=JSON.parse(details)?.error;}catch{}
 apiError(res,true,{
  type:typeof error?.type==='string'?error.type.slice(0,80):type,
  ...(typeof error?.code==='string'?{code:error.code.slice(0,80)}:{}),
  message:typeof error?.message==='string'?error.message.slice(0,1024):'模型请求未能完成'
 });
}

// Observe a bounded copy of the SSE framing while forwarding the original bytes.
function observeMessagesSse(){
 const decoder=new TextDecoder();
 let line='',lineLength=0,data='',overflow=false,skipLF=false,finished=false;
 let stopReason=null,outputTokens=null,toolUse=false,textChars=0,thinking=false;

 function endFrame(){
  if(overflow||!data)return;
  let event;
  try{event=JSON.parse(data);}catch{return;}
  switch(event?.type){
   case 'content_block_start': {
    const block=event.content_block;
    if(block?.type==='tool_use'||block?.type==='server_tool_use')toolUse=true;
    if(block?.type==='thinking'||block?.type==='redacted_thinking')thinking=true;
    if(block?.type==='text'&&typeof block.text==='string')textChars+=block.text.length;
    break;
   }
   case 'content_block_delta': {
    const delta=event.delta;
    if(delta?.type==='text_delta'&&typeof delta.text==='string')textChars+=delta.text.length;
    if(delta?.type==='thinking_delta')thinking=true;
    if(delta?.type==='input_json_delta')toolUse=true;
    break;
   }
   case 'message_delta': {
    const reason=event.delta?.stop_reason,tokens=event.usage?.output_tokens;
    if(STOP_REASONS.has(reason))stopReason=reason;
    if(Number.isSafeInteger(tokens)&&tokens>=0)outputTokens=tokens;
    break;
   }
   case 'message_stop': finished=true;break;
  }
 }

 function consume(part,endOfLine){
  lineLength+=part.length;
  if(!overflow){
   if(lineLength>MAX_SSE_FRAME_CHARS){overflow=true;line='';data='';}
   else line+=part;
  }
  if(!endOfLine)return;
  if(lineLength===0){
   endFrame();
   overflow=false;
   data='';
  }else if(!overflow&&line.startsWith('data:')){
   const part=line.slice(5).replace(/^ /u,'');
   if(data.length+part.length+1>MAX_SSE_FRAME_CHARS){overflow=true;data='';}
   else data+=(data?'\n':'')+part;
  }
  line='';
  lineLength=0;
 }

 return {
  push(chunk){
   if(finished)return true;
   let text=decoder.decode(chunk,{stream:true});
   if(!text)return false;
   if(skipLF&&text[0]==='\n')text=text.slice(1);
   skipLF=text.endsWith('\r');
   let start=0;
   for(const delimiter of text.matchAll(/\r\n|\r|\n/gu)){
    consume(text.slice(start,delimiter.index),true);
    if(finished)return true;
    start=delimiter.index+delimiter[0].length;
   }
   consume(text.slice(start),false);
   return false;
  },
  metadata(){return {stopReason,outputTokens,toolUse,textChars,thinkingOnly:thinking&&!toolUse&&textChars===0};}
 };
}

// The relay counts admission before sending to the configured provider, and
// saves only a rolling timestamp window across normal controller rounds.
// SSE comments keep the DSH Messages watchdog alive while quota is exhausted,
// so the running MCP child can keep its original native-AI lease supervised.
export async function createNativeModelBudget({path,maxRequests,baseURL,now=Date.now,fetcher=fetch,
 onWaiting=()=>{},windowMs=HOUR_MS,keepAliveMs=15000}={}){
 const limit=nativeModelRequestLimit(maxRequests),endpoint=messagesEndpoint(baseURL);
 const metadataPath=join(dirname(path),'model-requests.jsonl');
 const release=await claimWindow(path);
 let timestamps;
 try{timestamps=await loadWindow(path);}catch(error){await release();throw error;}
 const route='/'+randomUUID(),active=new Map();
 let serialized=Promise.resolve(),metadataWrites=Promise.resolve(),waiting=0,sealed=false,closing;
 const reserve=signal=>{
  const decision=serialized.then(async()=>{
   signal.throwIfAborted();
   if(sealed)return {sealed:true};
   const at=now();
   const recent=timestamps.filter(stamp=>stamp>at-windowMs);
   if(recent.length>=limit)return {retryAt:recent[recent.length-limit]+windowMs};
   // Persist the reservation before forwarding. A cancelled request after
   // reservation may consume a slot, but crashes cannot grant extra slots.
   timestamps=[...recent,at].sort((a,b)=>a-b);
   await saveWindow(path,timestamps);
   return {admitted:true};
  });
  serialized=decision.catch(()=>{});
  return decision;
 };
 const server=createServer(async(req,res)=>{
  if(req.method!=='POST'||req.url!==route+'/v1/messages'){res.writeHead(404).end();return;}
  const abort=new AbortController();
  res.once('close',()=>abort.abort());
  let paused=false,waitingForSlot=false,attempted=false,recorded=false,status=null,observer;
  const recordResponse=()=>{
   if(!attempted||recorded)return;
   recorded=true;
   const fields=observer?.metadata()??{stopReason:null,outputTokens:null,toolUse:false,textChars:0,thinkingOnly:false};
   const row=JSON.stringify({at:now(),status,...fields})+'\n';
   // Diagnostic write failure must not break or change the client's stream.
   metadataWrites=metadataWrites.then(()=>appendFile(metadataPath,row,{mode:0o600})).catch(()=>{});
   return metadataWrites;
  };
  active.set(abort,recordResponse);
  const clearWait=()=>{
   if(waitingForSlot&&--waiting===0&&!sealed)onWaiting(false,limit);
   waitingForSlot=false;
  };
  try{
   const body=await readBody(req);
   let decision=await reserve(abort.signal);
   while(!decision.admitted||sealed){
    if(!paused){
     paused=true;
     waitingForSlot=true;
     if(++waiting===1&&!sealed)onWaiting(true,limit);
     res.writeHead(200,REPLY_HEADERS);
     res.write(': '+modelBudgetNotice(limit)+'\n\n');
    }else res.write(': 等待战略复查额度\n\n');
    await delay(sealed?keepAliveMs:Math.min(keepAliveMs,Math.max(1,decision.retryAt-now())),undefined,{signal:abort.signal});
    decision=await reserve(abort.signal);
   }
   clearWait();
   abort.signal.throwIfAborted();
   const headers={};
   for(const name of FORWARD_HEADERS)if(typeof req.headers[name]==='string')headers[name]=req.headers[name];
   attempted=true;
   const upstream=await fetcher(endpoint,{method:'POST',body,headers,signal:abort.signal,redirect:'error'});
   status=Number.isInteger(upstream.status)&&upstream.status>=100&&upstream.status<=599?upstream.status:null;
   if(!upstream.ok)await recordResponse();
   else if(/^text\/event-stream(?:\s*;|$)/iu.test(upstream.headers.get('content-type')??''))observer=observeMessagesSse();
   if(paused&&!upstream.ok){await streamUpstreamError(res,upstream);return;}
   if(!paused){
    const responseHeaders={'content-type':'application/json','cache-control':'no-store'};
    for(const name of RESPONSE_HEADERS){const value=upstream.headers.get(name);if(value!==null)responseHeaders[name]=value;}
    res.writeHead(upstream.status,responseHeaders);
   }
   if(upstream.body)for await(const chunk of upstream.body){
    // DSH can run its turn-stopping hook as soon as it reads message_stop.
    if(observer?.push(chunk))await recordResponse();
    if(!res.write(chunk))await once(res,'drain',{signal:abort.signal});
   }
   await recordResponse();
   res.end();
  }catch{
   await recordResponse();
   if(!abort.signal.aborted)apiError(res,res.headersSent);
  }
  finally{
   clearWait();
   active.delete(abort);
  }
 });
 try{await new Promise((done,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',done);});}
 catch(error){await release();throw error;}
 return {
  baseURL:`http://127.0.0.1:${server.address().port}${route}`,
  seal(){sealed=true;},
  close(){return closing??=(async()=>{
   sealed=true;
   for(const [abort,record] of active){
    abort.abort();
    record();
   }
   server.closeAllConnections();
   await new Promise(done=>server.close(done));
   await serialized;
   await metadataWrites;
   await release();
  })();}
 };
}
