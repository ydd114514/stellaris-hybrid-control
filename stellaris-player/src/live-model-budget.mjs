import {createServer} from 'node:http';
import {appendFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';

// A loopback-only relay for an explicitly authorized live run. Fixed upstream;
// no request bodies, prompts, credentials or model reasoning enter its audit.
export async function createLiveModelBudget({directory,maxRequests=40,fetcher=fetch,onLimit=()=>{},now=Date.now}={}){
 if(!Number.isSafeInteger(maxRequests)||maxRequests<1||maxRequests>200)throw Error('实机请求上限需要1..200');
 await mkdir(directory,{recursive:true});const report={provider:'deepseek-official',requests:0,forwardedRequests:0,completed:0,failed:0,limit:maxRequests,requestedModels:[],serverModels:[],usage:{},rows:[]};
 const active=new Set(),finishing=new Set();let saving=Promise.resolve(),closed=false,sealed=false,closing;
 const audit=row=>{const snapshot=structuredClone(row);report.rows.push(snapshot);saving=saving.then(()=>appendFile(join(directory,'model-usage.jsonl'),JSON.stringify(snapshot)+'\n'));return saving;};
 const usageFrom=(text,row)=>{
  for(const line of text.split('\n')){
   const raw=line.startsWith('data:')?line.slice(5).trim():line.trim();
   if(!raw||raw==='[DONE]')continue;
   try{const event=JSON.parse(raw),usage=event.usage||event.message?.usage;
    const model=event.message?.model??event.model;
    if(typeof model==='string'&&/^[a-zA-Z0-9_.:/-]{1,100}$/.test(model)){row.serverModel=model;if(!report.serverModels.includes(row.serverModel))report.serverModels.push(row.serverModel);}
    if(!usage)continue;
    for(const key of ['input_tokens','output_tokens','cache_read_input_tokens','cache_creation_input_tokens','prompt_tokens','completion_tokens','total_tokens'])if(Number.isFinite(usage[key]))row.usage[key]=usage[key];
   }catch{/* Partial SSE lines are retained by the streaming buffer. */}
  }
 };
 const holdStopped=res=>{report.blockedAfterStop=(report.blockedAfterStop||0)+1;res.on('error',()=>{});};
 const server=createServer(async(req,res)=>{
  if(closed||req.method!=='POST'||req.url?.split('?')[0]!=='/anthropic/v1/messages'){res.writeHead(404).end();return;}
  if(sealed){holdStopped(res);return;}
  if(report.requests>=maxRequests){
   // A cooperative supervisor seals synchronously, then closes the host once
   // the game confirms handoff. Do not inject a provider error into that path.
   onLimit();if(sealed){holdStopped(res);return;}
   res.writeHead(429,{'content-type':'application/json'}).end(JSON.stringify({type:'error',error:{type:'rate_limit_error',message:'本次实机请求预算已用完'}}));return;
  }
  // Reserve the slot before awaiting the body: parallel arrivals share one cap.
  const id=++report.requests,started=now(),abort=new AbortController();active.add(abort);
  let finish;const finished=new Promise(done=>{finish=done;});finishing.add(finished);
  const row={id,startedAt:started,method:'POST',endpoint:'https://api.deepseek.com/anthropic/v1/messages',status:'started',usage:{}};
  await audit({...row});
  const timer=setTimeout(()=>abort.abort(),90000);let bytes=0;
  try{
   const parts=[];for await(const b of req){bytes+=b.length;if(bytes>4*1024*1024)throw Error('模型请求超过本次实机上限');parts.push(b);}
   const body=Buffer.concat(parts);
   try{const metadata=JSON.parse(body.toString('utf8'));if(typeof metadata.model==='string'&&/^[a-zA-Z0-9_.:/-]{1,100}$/.test(metadata.model)){row.requestedModel=metadata.model;if(!report.requestedModels.includes(metadata.model))report.requestedModels.push(metadata.model);}}catch{/* No body or prompt is retained in the audit. */}
   if(sealed){holdStopped(res);row.status='stopped_before_forward';report.cancelled=(report.cancelled||0)+1;return;}
   const headers={};for(const name of ['content-type','authorization','x-api-key','anthropic-version','anthropic-beta'])if(typeof req.headers[name]==='string')headers[name]=req.headers[name];
   report.forwardedRequests++;row.forwardedAt=now();row.requestBytes=bytes;
   const upstream=await fetcher(row.endpoint,{method:'POST',headers,body,signal:abort.signal,redirect:'error'});
   row.httpStatus=upstream.status;res.writeHead(upstream.status,{'content-type':upstream.headers.get('content-type')||'application/json','cache-control':'no-store'});
   const decoder=new TextDecoder();let pending='';
   for await(const chunk of upstream.body){
    const decoded=decoder.decode(chunk,{stream:true});pending+=decoded;
    const last=pending.lastIndexOf('\n');if(last>=0){usageFrom(pending.slice(0,last),row);pending=pending.slice(last+1);}
    if(pending.length>65536)pending='';
    if(!res.destroyed)res.write(chunk);
   }
   pending+=decoder.decode();usageFrom(pending,row);res.end();
   row.status=upstream.ok?'completed':'failed';upstream.ok?report.completed++:report.failed++;
  }catch{row.status='failed';report.failed++;if(!res.headersSent)res.writeHead(502,{'content-type':'application/json'});res.end(JSON.stringify({type:'error',error:{type:'api_error',message:'本次实机模型请求失败，详情仅记录状态'}}));}
  finally{
   clearTimeout(timer);active.delete(abort);row.elapsedMs=now()-started;
   for(const [key,n]of Object.entries(row.usage))report.usage[key]=(report.usage[key]||0)+n;
   try{await audit(row);}finally{finish();finishing.delete(finished);}
  }
 });
 await new Promise((done,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',done);});
 return {baseURL:`http://127.0.0.1:${server.address().port}/anthropic`,report,
  seal(){sealed=true;},
  close(){return closing??=(async()=>{closed=true;for(const a of active)a.abort();server.closeAllConnections();await new Promise(done=>server.close(done));await Promise.allSettled([...finishing]);await saving;})();}};
}
