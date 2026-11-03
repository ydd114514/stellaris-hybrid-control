import {isDeepStrictEqual} from 'node:util';

const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const clone=value=>structuredClone(value);
const currentFields=['snapshotId','date','remainingSeconds','paused','speed','decisionReview','strategyBrief'];
function difference(before,after,path=[],removed=[]){
  const patch={};
  for(const [key,value] of Object.entries(after)){
    if(isDeepStrictEqual(before?.[key],value)&&Object.hasOwn(before||{},key))continue;
    if(object(before?.[key])&&object(value)){
      const nested=difference(before[key],value,[...path,key],removed);
      if(Object.keys(nested).length)patch[key]=nested;
    }else patch[key]=clone(value);
  }
  for(const key of Object.keys(before||{}))if(!Object.hasOwn(after,key))removed.push([...path,key]);
  return patch;
}

// Lossless recursive object patches. Arrays are replaced as a whole, never
// spliced or matched by possibly ambiguous IDs. Null, zero, false and [] are
// literal new values; missing keys mean unchanged, explicit paths mean removal.
export class ModelView {
  constructor({fullEvery=6}={}){this.fullEvery=fullEvery;this.count=0;this.previous=null;}
  project(state,{full=false}={}) {
    const complete=full || !this.previous || ++this.count>=this.fullEvery;
    if(complete)this.count=0;
    let result;
    if(complete)result={view:'full',...clone(state)};
    else {
      const removed=[],changes=difference(this.previous,state,[],removed);
      result={view:'delta',protocol:'merge-v2'};
      for(const key of currentFields)if(Object.hasOwn(state,key)){result[key]=clone(state[key]);delete changes[key];}
      if(Object.keys(changes).length)result.changes=changes;
      if(removed.length)result.removed=removed;
    }
    this.previous=clone(state);return result;
  }
}

/** Offline replay oracle; never asks a model to reconstruct data for tests. */
export function restoreModelView(previous,view){
  if(view.view==='full'){const {view:_,...state}=view;return clone(state);}
  if(view.protocol!=='merge-v2')throw new Error('Unsupported model delta protocol');
  const result=clone(previous);
  const merge=(target,patch)=>{for(const [key,value]of Object.entries(patch)){
    if(['__proto__','constructor','prototype'].includes(key))throw new Error('Invalid state key');
    if(object(value)){if(!object(target[key]))target[key]={};merge(target[key],value);}else target[key]=clone(value);
  }};
  merge(result,view.changes||{});
  for(const path of view.removed||[]){
    if(!Array.isArray(path)||!path.length||path.some(k=>['__proto__','constructor','prototype'].includes(k)))throw new Error('Invalid removal path');
    let parent=result;for(const key of path.slice(0,-1)){parent=parent?.[key];if(!object(parent))break;}
    if(object(parent))delete parent[path.at(-1)];
  }
  for(const key of currentFields)if(Object.hasOwn(view,key))result[key]=clone(view[key]);
  return result;
}

const idle = status => /无指令|空闲|idle/i.test(status||'');
export function attentionReasons(before,after) {
  const reasons=[];
  if(after.warGoalsWindow || after.pendingEvents?.length)reasons.push('central_event');
  const oldAlerts=new Set((before.alerts||[]).map(x=>x.type));
  if((after.alerts||[]).some(x=>!oldAlerts.has(x.type)))reasons.push('new_alert');
  if(!isDeepStrictEqual(before.wars,after.wars)) {
    const identities=rows=>(rows||[]).map(x=>[x.war_id,x.have_defender_war_goal]);
    if(!isDeepStrictEqual(identities(before.wars),identities(after.wars)))reasons.push('war_changed');
  }
  for(const area of ['physics','society','engineering']) {
    const a=before.research?.[area]?.current,b=after.research?.[area]?.current;
    if(a?.key!==b?.key || a?.is_researching!==b?.is_researching)reasons.push('research_changed');
  }
  const fleetRows=s=>[...(s.military?.fleets||[]),...(s.civilian?.science_ships||[]),...(s.civilian?.construction_ships||[]),...(s.civilian?.colony_ships||[])];
  const previous=new Map(fleetRows(before).map(x=>[x.fleet_id,x]));
  const next=fleetRows(after);
  if(previous.size!==next.length || next.some(x=>!previous.has(x.fleet_id) || previous.get(x.fleet_id)?.total_ships!==x.total_ships || !idle(previous.get(x.fleet_id)?.status)&&idle(x.status)))reasons.push('fleet_changed');
  if(!isDeepStrictEqual(before.pendingDiplomacy,after.pendingDiplomacy))reasons.push('diplomacy_changed');
  for(const [key,value] of Object.entries(after.resources||{})) {
    const old=before.resources?.[key];if(!old)continue;
    if(!old.capped && value.capped || old.stockpile>=100 && value.stockpile<100 || old.net>=0 && value.net<0)reasons.push('resource_attention');
  }
  const colonyFlags=s=>(s.colonies||[]).flatMap(sector=>sector.colonies_summary||[]).map(x=>[x.planet_id,x.has_construction,x.status_alerts_count]);
  if(!isDeepStrictEqual(colonyFlags(before),colonyFlags(after)))reasons.push('colony_changed');
  return [...new Set(reasons)];
}
