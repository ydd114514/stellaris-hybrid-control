import {open,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
const validDate=x=>typeof x==='string'&&/^\d{4}\.\d{2}\.\d{2}$/.test(x);
const fingerprint=(binding,state)=>JSON.stringify({pid:binding?.pid,creationTime:binding?.creationTime,country:state?.player?.country_id,capital:state?.player?.capital_system_id});

// This carries diagnosis/guard memory, never authority to replay an old order.
export class ControllerContinuity {
 constructor({directory,now=Date.now}={}){Object.assign(this,{directory,now});}
 async load(binding,state){
  if(!binding?.creationTime||!Number.isSafeInteger(binding.pid)||!validDate(state?.date))return null;
  let handle;try{handle=await open(join(this.directory,'continuity.json'),'r');const b=Buffer.alloc(262145);const {bytesRead}=await handle.read(b,0,b.length,0);if(bytesRead>262144)return null;const data=JSON.parse(b.subarray(0,bytesRead).toString('utf8'));
   if(data.version!==1||data.binding!==fingerprint(binding,state)||!Number.isFinite(data.savedAt)||data.savedAt>this.now()+5000||this.now()-data.savedAt>86400000||!validDate(data.gameDate)||data.gameDate>state.date)return null;
   const stationFailures=Array.isArray(data.stationFailures)?data.stationFailures.slice(-256).filter(row=>Array.isArray(row)&&/^\d+:(mining|research)$/.test(row[0])&&typeof row[1]?.signature==='string'&&row[1].signature.length<12000).map(([key,row])=>[key,{signature:row.signature,error:'当前目标曾被引擎明确判定不可建站；条件变化后重评'}]):[];
   return {...data,stationFailures};
  }catch{return null;}finally{await handle?.close();}
 }
 async save(binding,state,{growth,stationFailures,orderTracking}={}){
  if(!binding?.creationTime||!validDate(state?.date))return;
  const data={version:1,savedAt:this.now(),gameDate:state.date,binding:fingerprint(binding,state),growth,stationFailures:(stationFailures||[]).slice(-256).filter(([key,row])=>/^\d+:(mining|research)$/.test(key)&&typeof row?.signature==='string'&&row.signature.length<12000).map(([key,row])=>[key,{signature:row.signature,error:'当前目标曾被引擎明确判定不可建站；条件变化后重评'}]),orderTracking};
  const body=JSON.stringify(data);if(Buffer.byteLength(body)>262144)return;
  const file=join(this.directory,'continuity.json');await writeFile(file+'.tmp',body);await rename(file+'.tmp',file);
 }
}
