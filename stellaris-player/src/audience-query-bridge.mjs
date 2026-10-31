import {open,writeFile,mkdir,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {summarizeOperationalFacts} from './operational-context.mjs';

const topics=new Set(['government','research','traditions','ascension','planet','buildings','jobs','zones','military','upgrades']);
const entities=new Set(['planet','buildings','jobs','zones','upgrades']);
const ident=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(x);
const allowed=(x,keys)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).every(k=>keys.includes(k));
const entityId=x=>Number.isSafeInteger(x)&&x>=0&&x<0xffffffff;
async function boundedRead(file,limit=65536) {
 const handle=await open(file,'r');try{const bytes=Buffer.alloc(limit+1);const {bytesRead}=await handle.read(bytes,0,bytes.length,0);if(bytesRead>limit)throw Error('query file too large');return JSON.parse(bytes.subarray(0,bytesRead).toString('utf8'));}finally{await handle.close();}
}

/** Consumed only from the existing serial native queue; never executes orders. */
export class AudienceQueryBridge {
 constructor({directory,now=Date.now,maxResults=16}={}) {Object.assign(this,{directory,now,maxResults});this.seen=new Map();}
 async poll({gameSessionId,state,inspect,isStopped=()=>false,maxQueries=1}) {
  if(isStopped())return [];
  let envelope;try{envelope=await boundedRead(join(this.directory,'audience-queries.json'));}catch{return [];}
  if(!allowed(envelope,['version','source','runId','gameSessionId','updatedAt','requests'])||envelope.version!==1||envelope.source!=='cyberfish-ai-hub'||!ident(envelope.runId)||!ident(envelope.gameSessionId)||!Number.isFinite(envelope.updatedAt)||this.now()-envelope.updatedAt>65000||envelope.updatedAt>this.now()+5000||!Array.isArray(envelope.requests)||envelope.requests.length>8)return [];
  const generation=`${envelope.runId}:${envelope.gameSessionId}`;
  if(this.generation!==generation){
   this.generation=generation;this.seen.clear();this.results=[];
   try{const old=await boundedRead(join(this.directory,'audience-query-results.json'),131072);if(old.version===1&&old.source==='cyberfish-audience-query-results'&&old.runId===envelope.runId&&old.gameSessionId===envelope.gameSessionId&&Array.isArray(old.results))this.results=old.results.filter(r=>ident(r.id)&&ident(r.taskId)&&Number.isFinite(r.observedAt)&&['ok','unavailable'].includes(r.status)).slice(-this.maxResults).map(r=>({id:r.id,taskId:r.taskId,status:r.status,observedAt:r.observedAt,...(r.status==='ok'?{facts:typeof r.facts==='string'?r.facts.slice(0,1800):''}:{reason:['unsupported','stopped','expired','cross_session','invalid_entity','error'].includes(r.reason)?r.reason:'error'})}));}catch{}
   for(const r of this.results)this.seen.set(r.id,{taskId:r.taskId});
  }
  const own=new Set((state?.colonies||[]).flatMap(s=>(s.colonies_summary||[]).map(p=>p.planet_id)));
  const emitted=[];let calls=0;
  for(const request of envelope.requests) {
   if(isStopped())return [];
   if(!allowed(request,['id','taskId','topic','entityId','createdAt','expiresAt'])||!ident(request.id)||!ident(request.taskId))continue;
   if(this.seen.has(request.id))continue;
   const base={id:request.id,taskId:request.taskId,observedAt:this.now()};let result;
   if(envelope.gameSessionId!==gameSessionId)result={...base,status:'unavailable',reason:'cross_session'};
   else if(!Number.isFinite(request.createdAt)||!Number.isFinite(request.expiresAt)||request.expiresAt<request.createdAt||request.expiresAt-request.createdAt>60000||request.createdAt>this.now()+5000||request.expiresAt<=this.now())result={...base,status:'unavailable',reason:'expired'};
   else if(!topics.has(request.topic))result={...base,status:'unavailable',reason:'unsupported'};
   else if(entities.has(request.topic)?!entityId(request.entityId)||!own.has(request.entityId):request.entityId!==undefined)result={...base,status:'unavailable',reason:'invalid_entity'};
   else {
    if(calls>=Math.max(0,Math.min(2,maxQueries)))continue;calls++;
    try {
     const value=await inspect({topic:request.topic,...(entities.has(request.topic)?{id:request.entityId}:{})});
     if(isStopped())return [];
     const facts=summarizeOperationalFacts(request.topic,value).slice(0,1800);
     result=this.now()>=request.expiresAt?{...base,observedAt:this.now(),status:'unavailable',reason:'expired'}:facts?{...base,observedAt:this.now(),status:'ok',facts}:{...base,observedAt:this.now(),status:'unavailable',reason:'unsupported'};
    }catch{result={...base,observedAt:this.now(),status:'unavailable',reason:'error'};}
   }
   this.seen.set(request.id,{taskId:request.taskId});this.results.push(result);emitted.push(result);
   while(this.seen.size>128)this.seen.delete(this.seen.keys().next().value);
  }
  if(!emitted.length)return [];
  // A stop/restart or newly published run during an awaited read invalidates this work.
  let current;try{current=await boundedRead(join(this.directory,'audience-queries.json'));}catch{return [];}
  if(isStopped()||current.runId!==envelope.runId||current.gameSessionId!==envelope.gameSessionId)return [];
  const stillCurrent=result=>{
   const original=envelope.requests.find(q=>q.id===result.id&&q.taskId===result.taskId);
   return Array.isArray(current.requests)&&current.requests.some(q=>q.id===original?.id&&q.taskId===original?.taskId&&q.topic===original?.topic&&q.entityId===original?.entityId&&q.createdAt===original?.createdAt&&q.expiresAt===original?.expiresAt);
  };
  const valid=emitted.filter(stillCurrent);
  const discarded=new Set(emitted.filter(r=>!valid.includes(r)).map(r=>r.id));
  for(const id of discarded)this.seen.delete(id);
  this.results=this.results.filter(r=>!discarded.has(r.id));
  if(!valid.length)return [];
  for(const row of valid)if(row.status==='ok'&&this.now()>=envelope.requests.find(q=>q.id===row.id).expiresAt){delete row.facts;row.status='unavailable';row.reason='expired';row.observedAt=this.now();}
  this.results=this.results.slice(-this.maxResults);
  const output={version:1,source:'cyberfish-audience-query-results',runId:envelope.runId,gameSessionId:envelope.gameSessionId,updatedAt:this.now(),results:this.results};
  await mkdir(this.directory,{recursive:true});const file=join(this.directory,'audience-query-results.json');await writeFile(file+'.tmp',JSON.stringify(output));await rename(file+'.tmp',file);
  return valid;
 }
}
