const id=value=>Number.isSafeInteger(value)&&value>=0&&value<0xffffffff;
const source='bound_readonly_process_memory';
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const scaled=['current_workforce','max_workforce','bonus_workforce','workforce_limit'];
const raw=['raw_workforce','raw_max_workforce','raw_bonus_workforce','raw_workforce_limit'];
export function needsPlanetJobsSupplement(data,planet={}){
 return data?.success===true&&Array.isArray(data.strata)&&data.strata.length===0&&
  [data.total_workforce,planet.workforce_summary?.total_employed_workforce].some(value=>Number.isFinite(value)&&value>0);
}
function validJob(row){
 return id(row?.job_id)&&typeof row.job_key==='string'&&/^[a-zA-Z_][a-zA-Z0-9_]{0,127}$/.test(row.job_key)&&
  scaled.every(key=>row[key]===null||Number.isFinite(row[key]))&&
  ['current_workforce','max_workforce'].every(key=>row[key]===null||row[key]>=0)&&
  raw.every(key=>typeof row[key]==='string'&&/^-?\d{1,20}$/.test(row[key]));
}
/** Read-only fallback for the loaded bridge's omitted gestalt strata. The
 * controller checks the world on both sides; the process reader proves every
 * full entity reference and refuses a changing colony/job snapshot. */
export async function supplementPlanetJobs({data,planetId,binding,worldScope,ownedColonies,assertScope,processReader,now=Date.now}){
 const unknown=reason=>({...data,flat_jobs:[],flat_jobs_coverage:{known:false,source},coverageKnown:false,coverageReason:'只读岗位补充未确认：'+reason.slice(0,220)});
 try{
  if(!id(planetId)||data?.planet_id!==planetId||!id(data.colony_id)||!Number.isSafeInteger(binding?.pid)||binding.pid<=0||typeof binding.creationTime!=='string'||
   !Number.isSafeInteger(worldScope?.world_generation)||worldScope.world_generation<0||!id(worldScope.country_id)||
   !Number.isSafeInteger(worldScope.country_address)||worldScope.country_address<=0||typeof assertScope!=='function'||typeof processReader!=='function')throw Error('本轮进程或本国世界绑定不完整');
  if(!Array.isArray(ownedColonies)||!ownedColonies.some(row=>row?.planet_id===planetId&&row.colony_id===data.colony_id))throw Error('当前本国殖民地完整引用未核实');
  const expected={binding:{pid:binding.pid,creationTime:binding.creationTime},worldScope:structuredClone(worldScope)};
  const before=await assertScope();if(!same(before,expected))throw Error('读取前进程或世界绑定改变');
  const read=await processReader({op:'planet_jobs',pid:binding.pid,creationTime:binding.creationTime,countryId:worldScope.country_id,planetId,colonyId:data.colony_id});
  const after=await assertScope();if(!same(after,expected))throw Error('读取期间进程或世界绑定改变');
  const jobs=read?.planetJobs;
  if(read?.ok!==true||read.pid!==binding.pid||read.creationTime!==binding.creationTime||jobs?.known!==true||jobs.readOnly!==true||jobs.stableRead!==true||jobs.coverageComplete!==true||
   jobs.ownershipRelationshipVerified!==true||jobs.countryId!==worldScope.country_id||jobs.planetId!==planetId||jobs.colonyId!==data.colony_id)throw Error(jobs?.reason||jobs?.error||'进程读数、归属或稳定性未确认');
  if(!Number.isSafeInteger(jobs.jobCount)||jobs.jobCount<0||jobs.jobCount>64||!Array.isArray(jobs.flat_jobs)||jobs.flat_jobs.length!==jobs.jobCount||
   jobs.flat_jobs.some(row=>!validJob(row))||new Set(jobs.flat_jobs.map(row=>row.job_id)).size!==jobs.jobCount)throw Error('岗位枚举或完整引用覆盖不完整');
  const allCurrentKnown=jobs.flat_jobs.every(row=>Number.isFinite(row.current_workforce));
  const total=allCurrentKnown?Math.round(jobs.flat_jobs.reduce((sum,row)=>sum+row.current_workforce,0)*100000)/100000:null;
  return {...data,native_total_workforce:data.total_workforce,total_workforce:total,flat_jobs:jobs.flat_jobs.map(row=>({...row})),
   flat_jobs_coverage:{known:true,source,complete:true,stableRead:true,worldScopeVerified:true,worldGeneration:worldScope.world_generation,jobCount:jobs.jobCount,observedAt:now()},
   coverageKnown:true,coverageReason:undefined,coverageEvidence:undefined,
   note:'只读进程补充的完整岗位列表；未伪造普通阶层。限额0及哨兵保留原值，不据此单独推断岗位已禁用。'};
 }catch(error){return unknown(error.message||'读取失败');}
}
