import {readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';

const empty=()=>({status:'disconnected',summary:'',items:[]});
const text=(value,max)=>typeof value==='string'?value.slice(0,max):'';
const statuses=new Set(['stopped','waiting','collecting','ready']);
const itemStatuses=new Set(['pending','forwarded','adopted','dismissed','answered']);

// Read only the public handoff, never the AI profile, credentials or private blackboard.
export async function readAudienceGuidance(directory,now=Date.now()) {
  try{
    const path=join(directory,'audience-guidance.json');if((await stat(path)).size>65536)return empty();
    const saved=JSON.parse(await readFile(path,'utf8'));
    if(saved.version!==1||saved.source!=='cyberfish-ai-hub'||!statuses.has(saved.status)||!Number.isFinite(saved.updatedAt))return empty();
    if(saved.updatedAt>now+5000||(saved.status!=='stopped'&&now-saved.updatedAt>15000))return empty();
    return {status:saved.status,summary:text(saved.summary,200),items:(Array.isArray(saved.items)?saved.items:[]).slice(0,20).filter(x=>x&&typeof x.text==='string'&&x.text.trim()).map(x=>({id:text(x.id,80),name:text(x.name,60),text:text(x.text,1000),status:itemStatuses.has(x.status)?x.status:'pending',reply:text(x.reply,200)}))};
  }catch{return empty();}
}
