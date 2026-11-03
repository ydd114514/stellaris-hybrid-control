import {readFile,mkdir,writeFile,unlink} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {replaceCheckpoint} from './checkpoint-replace.mjs';

export const DIRECTOR_TIMING=Object.freeze({galaxyDeadline:120000,galaxyLead:5000,galaxyHold:15000,sceneHold:18000,battleHold:30000,eventPoll:2000,emergencyHold:3000,planetInterval:60000,starbaseInterval:90000,targetRefresh:30000,topicCooldown:45000,explorationCooldown:90000,targetCooldown:180000,pendingExpiry:120000});
export async function loadDirectorSettings(path){
 try{
  const text=await readFile(path,'utf8');if(Buffer.byteLength(text)>4096)throw Error('oversized');
  const raw=JSON.parse(text);if(!raw||!['auto','fixed'].includes(raw.mode)||raw.version!==undefined&&raw.version!==1)throw Error('invalid');
  return {mode:raw.mode,configurationKnown:true};
 }catch(error){return error.code==='ENOENT'?{mode:'auto',configurationKnown:true}:{mode:'fixed',configurationKnown:false};}
}
export async function saveDirectorSettings(path,mode){
 if(!['auto','fixed'].includes(mode))throw Error('展示模式无效');
 await mkdir(dirname(path),{recursive:true});const temporary=path+'.'+randomUUID()+'.tmp';
 try{await writeFile(temporary,JSON.stringify({version:1,mode}),{flag:'wx'});await replaceCheckpoint(temporary,path);}
 finally{await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});}
 return mode;
}
export const DIRECTOR_TOPICS={galaxy:'完整银河星图',research:'科研',planet:'星球建设',starbases:'恒星基地',fleets:'舰队配置',battle:'交战现场',exploration:'科研船探索',stations:'建造船',market:'市场',traditions:'传统',government:'内阁',leaders:'领袖'};
export function directorSummary(raw,{now=Date.now(),active=false}={}){
 if(!raw||typeof raw!=='object')return;
 const last=Number.isFinite(raw.lastGalaxyAt)&&raw.lastGalaxyAt>=0&&raw.lastGalaxyAt<=now?raw.lastGalaxyAt:null;
 /** @type {'fixed'|'auto'} */
 const mode=raw.mode==='fixed'?'fixed':'auto';
 return {mode,active,topic:DIRECTOR_TOPICS[raw.topic]??'等待展示',
  blocked:['event_window','control_unavailable','presentation_failed','configuration_invalid'].includes(raw.blocked)?raw.blocked:'',
  galaxyRemainingSeconds:last===null?0:Math.max(0,Math.ceil((last+DIRECTOR_TIMING.galaxyDeadline-now)/1000)),
  galaxyOverdue:last===null||now-last>=DIRECTOR_TIMING.galaxyDeadline};
}
