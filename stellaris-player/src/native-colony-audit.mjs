const day=date=>{const m=/^(\d+)\.(\d+)\.(\d+)$/.exec(date??'');return m?+m[1]*360+(+m[2]-1)*30+(+m[3]-1):null;};
const number=x=>Number.isFinite(x)?Math.round(x*10)/10:null;
const fullRef=x=>Number.isSafeInteger(x)&&x>=0&&x<0xffffffff;
const colonyFacts=(raw,date)=>({planetId:raw.planet_id,name:typeof raw.name==='string'?raw.name.slice(0,40):String(raw.planet_id),observedDate:date,
 popGroups:number(raw.kpi?.pop_groups),unemployed:number(raw.workforce_summary?.unemployed??raw.kpi?.unemployed),
 employedWorkforce:number(raw.workforce_summary?.total_employed_workforce),effectiveWorkforce:number(raw.workforce_summary?.total_effective_workforce),
 activeJobsCount:number(raw.workforce_summary?.active_jobs_count),amenities:number(raw.kpi?.amenities),housing:number(raw.kpi?.housing),stability:number(raw.kpi?.stability_percent),
 unityNet:number(raw.monthly_production?.net?.unity),constructionCount:Array.isArray(raw.construction_queue)?raw.construction_queue.length:null});
/** Bounded read-only rounds; no alerts are interpreted as permission to build. */
export class NativeColonyAudit {
 constructor(){this.lastDay=null;this.latestDay=null;this.identity=null;this.checked=new Map();this.details=new Map();this.last=null;}
 facts(current,ids){return [...this.details.values()].filter(x=>ids.has(x.planetId)&&current-day(x.observedDate)>=0&&current-day(x.observedDate)<=360).map(x=>({...x,ageDays:current-day(x.observedDate)})).slice(-12);}
 context(state){
  const current=day(state.date),identity=JSON.stringify([state.player?.country_id,state.player?.capital_system_id]);
  if(current===null)return null;
  if(this.identity!==null&&this.identity!==identity||this.latestDay!==null&&current<this.latestDay){this.checked.clear();this.details.clear();this.lastDay=null;this.last=null;}
  this.identity=identity;this.latestDay=current;
  const owned=(state.colonies??[]).flatMap(s=>s.colonies_summary??[]).filter(p=>fullRef(p.planet_id)&&p.is_colonizing!==true),ids=new Set(owned.map(p=>p.planet_id));
  this.ownedIds=ids;
  for(const id of this.checked.keys())if(!ids.has(id))this.checked.delete(id);
  for(const id of this.details.keys())if(!ids.has(id))this.details.delete(id);
  return {current,owned,ids};
 }
 /** Caller has already checked current-world ownership and raw.planet_id.
  * A targeted read uses exactly the same structured facts as the normal audit. */
 record(raw,date){
  const current=day(date);
  if(current===null||!fullRef(raw?.planet_id)||raw.success===false||this.latestDay!==null&&current<this.latestDay)return null;
  const facts=colonyFacts(raw,date);this.latestDay=current;
  this.checked.delete(raw.planet_id);this.checked.set(raw.planet_id,current);
  this.details.delete(raw.planet_id);this.details.set(raw.planet_id,facts);
  // Details have a fixed observation budget; scheduling history is bounded by
  // the currently owned set, rather than capping the number of usable colonies.
  while(this.details.size>256)this.details.delete(this.details.keys().next().value);
  if(!this.ownedIds)while(this.checked.size>256)this.checked.delete(this.checked.keys().next().value);
  return {...facts,ageDays:0};
 }
 view(state,{checkedThisRound=[],failed=[]}={}){
  const context=this.context(state);
  if(!context)return {known:false,reason:'日期未知，不推断殖民地管理已完成'};
  const {current,owned,ids}=context;
  this.last={known:true,date:state.date,checkedThisRound:[...checkedThisRound],failed:[...failed],totalColonies:owned.length,
   alertedWithoutQueue:owned.filter(p=>p.status_alerts_count>0&&p.has_construction===false).map(p=>p.planet_id),colonies:this.facts(current,ids),readOnly:true,
   note:'每半年轮巡至多3颗当前本国殖民地；警报只提示核查岗位、人口、维护和队列，不证明建设失败，也不自动派建设命令'};
  return this.last;
 }
 async review(state,{rpc,onPlanet=()=>{}}){
  const context=this.context(state);
  if(!context)return {known:false,reason:'日期未知，不推断殖民地管理已完成'};
  const {current,owned}=context;
  if(this.lastDay!==null&&current-this.lastDay<180)return this.view(state);
  const candidates=[...owned].sort((a,b)=>(this.checked.get(a.planet_id)??-Infinity)-(this.checked.get(b.planet_id)??-Infinity)||(b.status_alerts_count??0)-(a.status_alerts_count??0));
  this.lastDay=current;const checkedThisRound=[],failed=[];
  for(const candidate of candidates.slice(0,3)){
   try{
    const raw=await rpc('get_planet_details',{planet_id:candidate.planet_id});
    if(raw?.planet_id!==candidate.planet_id)throw Error('星球身份未确认');
    onPlanet(raw);if(!this.record(raw,state.date))throw Error('星球事实无效');checkedThisRound.push(candidate.planet_id);
   }catch{failed.push(candidate.planet_id);this.checked.set(candidate.planet_id,current-90);}
  }
  return this.view(state,{checkedThisRound,failed});
 }
}
