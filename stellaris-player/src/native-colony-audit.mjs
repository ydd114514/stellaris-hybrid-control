const day=date=>{const m=/^(\d+)\.(\d+)\.(\d+)$/.exec(date??'');return m?+m[1]*360+(+m[2]-1)*30+(+m[3]-1):null;};
const number=x=>Number.isFinite(x)?Math.round(x*10)/10:null;
const colonyFacts=(raw,date)=>({planetId:raw.planet_id,name:typeof raw.name==='string'?raw.name.slice(0,40):String(raw.planet_id),observedDate:date,
 popGroups:number(raw.kpi?.pop_groups),unemployed:number(raw.workforce_summary?.unemployed??raw.kpi?.unemployed),
 employedWorkforce:number(raw.workforce_summary?.total_employed_workforce),effectiveWorkforce:number(raw.workforce_summary?.total_effective_workforce),
 activeJobsCount:number(raw.workforce_summary?.active_jobs_count),amenities:number(raw.kpi?.amenities),housing:number(raw.kpi?.housing),stability:number(raw.kpi?.stability_percent),
 unityNet:number(raw.monthly_production?.net?.unity),constructionCount:Array.isArray(raw.construction_queue)?raw.construction_queue.length:null});
/** Bounded read-only rounds; no alerts are interpreted as permission to build. */
export class NativeColonyAudit {
 constructor(){this.lastDay=null;this.identity=null;this.checked=new Map();this.details=new Map();this.last=null;}
 facts(current,ids){return [...this.details.values()].filter(x=>ids.has(x.planetId)&&current-day(x.observedDate)<=360).map(x=>({...x,ageDays:current-day(x.observedDate)})).slice(-12);}
 async review(state,{rpc,onPlanet=()=>{}}){
  const current=day(state.date),identity=JSON.stringify([state.player?.country_id,state.player?.capital_system_id]);
  if(current===null)return {known:false,reason:'日期未知，不推断殖民地管理已完成'};
  if(this.identity!==identity||this.lastDay!==null&&current<this.lastDay){this.checked.clear();this.details.clear();this.lastDay=null;this.last=null;}
  this.identity=identity;
  const owned=(state.colonies??[]).flatMap(s=>s.colonies_summary??[]).filter(p=>Number.isInteger(p.planet_id)&&p.is_colonizing!==true);
  const ids=new Set(owned.map(p=>p.planet_id));for(const id of this.checked.keys())if(!ids.has(id)){this.checked.delete(id);this.details.delete(id);}
  if(this.lastDay!==null&&current-this.lastDay<180)return {...this.last,checkedThisRound:[],colonies:this.facts(current,ids)};
  const candidates=[...owned].sort((a,b)=>(this.checked.get(a.planet_id)??-Infinity)-(this.checked.get(b.planet_id)??-Infinity)||(b.status_alerts_count??0)-(a.status_alerts_count??0));
  this.lastDay=current;const checkedThisRound=[],failed=[];
  for(const candidate of candidates.slice(0,3)){
   try{
    const raw=await rpc('get_planet_details',{planet_id:candidate.planet_id});
    if(raw?.planet_id!==candidate.planet_id)throw Error('星球身份未确认');
    onPlanet(raw);this.checked.set(candidate.planet_id,current);this.details.delete(candidate.planet_id);this.details.set(candidate.planet_id,colonyFacts(raw,state.date));checkedThisRound.push(candidate.planet_id);
   }catch{failed.push(candidate.planet_id);this.checked.set(candidate.planet_id,current-90);}
  }
  const noQueueAlerts=owned.filter(p=>p.status_alerts_count>0&&p.has_construction===false).map(p=>p.planet_id);
  this.last={known:true,date:state.date,checkedThisRound,failed,totalColonies:owned.length,alertedWithoutQueue:noQueueAlerts,colonies:this.facts(current,ids),readOnly:true,
   note:'每半年轮巡至多3颗当前本国殖民地；警报只提示核查岗位、人口、维护和队列，不证明建设失败，也不自动派建设命令'};
  return this.last;
 }
}
