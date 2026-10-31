import {open,mkdir,appendFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

const numberFields=(value,keys)=>Object.fromEntries(keys.filter(k=>Number.isFinite(value?.[k])).map(k=>[k,value[k]]));
const hash=x=>createHash('sha256').update(x).digest('base64');

/** Existing local OBS API only. No stream keys or mutation methods are requested. */
export async function readObsQuality({configPath=join(process.env.APPDATA||'','obs-studio/plugin_config/obs-websocket/config.json'),WebSocketImpl=globalThis.WebSocket,timeoutMs=2000}={}) {
 let cfg;try{const h=await open(configPath,'r');try{const bytes=Buffer.alloc(16385);const {bytesRead}=await h.read(bytes,0,bytes.length,0);if(bytesRead>16384)return {status:'unknown',reason:'invalid_config'};cfg=JSON.parse(bytes.subarray(0,bytesRead).toString('utf8'));}finally{await h.close();}}catch{return {status:'unknown',reason:'not_configured'};}
 const port=cfg.server_port||4455;
 if(!cfg.server_enabled||!cfg.auth_required||typeof cfg.server_password!=='string'||!cfg.server_password||!Number.isInteger(port)||port<1024||port>65535||!WebSocketImpl)return {status:'unknown',reason:'not_configured'};
 return new Promise(resolve=>{
  let ws,ended=false;const pending=new Map(),data={};
  const finish=result=>{if(ended)return;ended=true;clearTimeout(timer);try{ws?.close();}catch{}resolve(result);};
  const timer=setTimeout(()=>finish({status:'unknown',reason:'unavailable'}),timeoutMs);
  try{ws=new WebSocketImpl(`ws://127.0.0.1:${port}`);}catch{return finish({status:'unknown',reason:'unavailable'});}
  const request=type=>{const id=randomUUID();pending.set(id,type);ws.send(JSON.stringify({op:6,d:{requestType:type,requestId:id}}));};
  ws.addEventListener('error',()=>finish({status:'unknown',reason:'unavailable'}));
  ws.addEventListener('close',()=>finish({status:'unknown',reason:'unavailable'}));
  ws.addEventListener('message',event=>{
   if(ended)return;
   try {
    const body=String(event.data);if(body.length>65536)return finish({status:'unknown',reason:'invalid_response'});
    const {op,d}=JSON.parse(body);
    if(op===0){if(!d?.authentication?.salt||!d.authentication.challenge)return finish({status:'unknown',reason:'authentication'});ws.send(JSON.stringify({op:1,d:{rpcVersion:1,authentication:hash(hash(cfg.server_password+d.authentication.salt)+d.authentication.challenge),eventSubscriptions:0}}));}
    else if(op===2)for(const type of ['GetStats','GetStreamStatus','GetRecordStatus'])request(type);
    else if(op===7&&pending.has(d?.requestId)){
     const type=pending.get(d.requestId);pending.delete(d.requestId);
     if(d.requestStatus?.result!==true)return finish({status:'unknown',reason:'request_failed'});
     const r=d.responseData||{};
     data[type]=type==='GetStats'?numberFields(r,['activeFps','averageFrameRenderTime','renderSkippedFrames','renderTotalFrames','outputSkippedFrames','outputTotalFrames','cpuUsage','memoryUsage']):{active:r.outputActive===true,reconnecting:r.outputReconnecting===true,...numberFields(r,['outputDuration','outputBytes','outputSkippedFrames','outputTotalFrames','outputCongestion'])};
     if(!pending.size)finish({status:'observed',source:'local_obs',stats:data.GetStats,stream:data.GetStreamStatus,record:data.GetRecordStatus,audioIsolation:'not_measured',viewerLatency:'not_measured'});
    }
   }catch{finish({status:'unknown',reason:'invalid_response'});}
  });
 });
}

/** Independent of the native command queue; samples never control OBS or the game. */
export class BroadcastQualityMonitor {
 constructor({directory,sessionId,now=Date.now,read=readObsQuality,intervalMs=10000}={}) {Object.assign(this,{directory,sessionId,now,read,intervalMs});this.lastAt=-Infinity;}
 tick(state) {
  if(this.stopped||this.inFlight||this.now()-this.lastAt<this.intervalMs)return this.inFlight;
  this.lastAt=this.now();
  this.inFlight=(async()=>{
   let obs;try{obs=await this.read();}catch{obs={status:'unknown',reason:'unavailable'};}
   if(this.stopped)return;
   // Re-allowlist an injected reader too; no untrusted provider fields reach disk.
   obs=obs?.status==='observed'?{status:'observed',source:'local_obs',stats:numberFields(obs.stats,['activeFps','averageFrameRenderTime','renderSkippedFrames','renderTotalFrames','outputSkippedFrames','outputTotalFrames','cpuUsage','memoryUsage']),stream:{active:obs.stream?.active===true,reconnecting:obs.stream?.reconnecting===true,...numberFields(obs.stream,['outputDuration','outputBytes','outputSkippedFrames','outputTotalFrames','outputCongestion'])},record:{active:obs.record?.active===true,...numberFields(obs.record,['outputDuration','outputBytes'])},audioIsolation:'not_measured',viewerLatency:'not_measured'}:{status:'unknown',reason:['not_configured','invalid_config','unavailable','authentication','invalid_response','request_failed'].includes(obs?.reason)?obs.reason:'unavailable'};
   const row={version:1,sessionId:this.sessionId,at:this.now(),gameDate:typeof state?.date==='string'?state.date.slice(0,20):undefined,gamePaused:typeof state?.paused==='boolean'?state.paused:null,obs};
   await mkdir(this.directory,{recursive:true});if(this.stopped)return;
   await appendFile(join(this.directory,`quality-${this.sessionId}.jsonl`),JSON.stringify(row)+'\n');
   const file=join(this.directory,'quality-latest.json');await writeFile(file+'.tmp',JSON.stringify(row));await rename(file+'.tmp',file);this.latest=row;
  })().catch(()=>{}).finally(()=>{this.inFlight=undefined;});
  return this.inFlight;
 }
 stop(){this.stopped=true;}
}
