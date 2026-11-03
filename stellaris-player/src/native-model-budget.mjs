import {randomUUID} from 'node:crypto';
import {open,readFile,unlink,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {replaceCheckpoint} from './checkpoint-replace.mjs';
import {nativeModelRequestLimit} from './hybrid-settings-store.mjs';

const HOUR_MS=60*60*1000;
const MAX_BODY_BYTES=4*1024*1024;
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

// The relay counts admission before sending to the configured provider, and
// saves only a rolling timestamp window across normal controller rounds.
// SSE comments keep the DSH Messages watchdog alive while quota is exhausted,
// so the running MCP child can keep its original native-AI lease supervised.
export async function createNativeModelBudget({path,maxRequests,baseURL,now=Date.now,fetcher=fetch,
 onWaiting=()=>{},windowMs=HOUR_MS,keepAliveMs=15000}={}){
 const limit=nativeModelRequestLimit(maxRequests),endpoint=messagesEndpoint(baseURL);
 const release=await claimWindow(path);
 let timestamps;
 try{timestamps=await loadWindow(path);}catch(error){await release();throw error;}
 const route='/'+randomUUID(),active=new Set();
 let serialized=Promise.resolve(),waiting=0,sealed=false,closing;
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
  active.add(abort);
  res.once('close',()=>abort.abort());
  let paused=false,waitingForSlot=false;
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
   const upstream=await fetcher(endpoint,{method:'POST',body,headers,signal:abort.signal,redirect:'error'});
   if(paused&&!upstream.ok){await streamUpstreamError(res,upstream);return;}
   if(!paused){
    const responseHeaders={'content-type':'application/json','cache-control':'no-store'};
    for(const name of RESPONSE_HEADERS){const value=upstream.headers.get(name);if(value!==null)responseHeaders[name]=value;}
    res.writeHead(upstream.status,responseHeaders);
   }
   if(upstream.body)for await(const chunk of upstream.body){
    if(!res.write(chunk))await once(res,'drain',{signal:abort.signal});
   }
   res.end();
  }catch{if(!abort.signal.aborted)apiError(res,res.headersSent);}
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
   for(const abort of active)abort.abort();
   server.closeAllConnections();
   await new Promise(done=>server.close(done));
   await serialized;
   await release();
  })();}
 };
}
