import {open,writeFile,rename} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

export const ECONOMY_FOCUSES=['balanced','unity_traditions','consumer_stability','alloys_military','research'];
export const OPERATOR_NOTE_LIMIT=600;
const clip=(value,length)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,length):'';

// Bound the read itself as well as the resulting fields. Never expose file actions.
export async function readOperatorStanding(path,sessionId,now=Date.now()){
 let file;
 try{
  file=await open(path,'r');if((await file.stat()).size>32768)return;
  const buffer=Buffer.alloc(32769),{bytesRead}=await file.read(buffer,0,buffer.length,0);
  if(bytesRead>32768)return;
  const x=JSON.parse(buffer.subarray(0,bytesRead).toString('utf8'));
  if(x?.version!==1||x.source!=='cyberfish-ai-hub'||x.kind!=='operator-standing'||!sessionId||x.gameSessionId!==sessionId)return;
  if(!Number.isFinite(x.refreshedAt)||now-x.refreshedAt>180000||x.refreshedAt-now>5000||!Number.isFinite(x.setAt)||!clip(x.id,100)||!clip(x.text,OPERATOR_NOTE_LIMIT))return;
  return {version:1,source:x.source,kind:x.kind,id:clip(x.id,100),gameSessionId:sessionId,text:clip(x.text,OPERATOR_NOTE_LIMIT),
   economyFocus:ECONOMY_FOCUSES.includes(x.economyFocus)?x.economyFocus:null,
   until:{date:clip(x.until?.date,20),condition:clip(x.until?.condition,300)},setAt:x.setAt,refreshedAt:x.refreshedAt};
 }catch{return;}finally{await file?.close();}
}

export async function writeControllerReceipt(path,receipt){
 const temporary=path+'.'+randomUUID()+'.tmp';
 await writeFile(temporary,JSON.stringify({operatorStandingId:receipt.operatorStandingId??null,readAt:receipt.readAt,
  appliedFocus:receipt.appliedFocus??null,steeringApplied:receipt.steeringApplied===true,reason:clip(receipt.reason,300)})+'\n');
 await rename(temporary,path);
}
