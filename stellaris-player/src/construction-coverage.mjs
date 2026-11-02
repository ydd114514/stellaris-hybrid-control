const finite=Number.isFinite;
const number=x=>finite(x)?x:null;
const unknown=(reason,evidence,nextCheck)=>({known:false,reason,evidence,...(nextCheck?{nextCheck}:{})});
/** Structural success is not proof that an empty native enumeration is complete. */
export function constructionCandidateCoverage(section,data,planet={}){
 if(data?.coverageKnown===false)return unknown(data.coverageReason||'本次候选覆盖未知',data.coverageEvidence);
 if(section==='jobs'){
  if(data?.flat_jobs_coverage?.known===true){
   const proof=data.flat_jobs_coverage,jobs=data.flat_jobs;
   if(proof.source!=='bound_readonly_process_memory'||proof.complete!==true||proof.stableRead!==true||proof.worldScopeVerified!==true||!Number.isSafeInteger(proof.worldGeneration)||
    !Number.isSafeInteger(proof.jobCount)||proof.jobCount<0||proof.jobCount>64||!Array.isArray(jobs)||jobs.length!==proof.jobCount||
    jobs.some(row=>!Number.isSafeInteger(row?.job_id)||row.job_id<0||row.job_id>=0xffffffff||typeof row.job_key!=='string')||new Set(jobs.map(row=>row.job_id)).size!==jobs.length)
    return unknown('只读岗位补充缺少完整进程/世界/实体覆盖证明');
   const total=number(data.total_workforce),sum=jobs.every(row=>finite(row.current_workforce))?jobs.reduce((n,row)=>n+row.current_workforce,0):null;
   if(total!==null&&sum!==null&&Math.abs(total-sum)>0.0001)return unknown('只读岗位劳动力合计不一致，不能认定完整填充');
   return {known:true,evidence:{enumeratedJobs:jobs.length,reportedWorkforce:total,source:proof.source,worldGeneration:proof.worldGeneration}};
  }
  if(!Array.isArray(data?.strata)||data.strata.some(s=>!Array.isArray(s?.jobs)))return unknown('岗位阶层覆盖不完整，不能当成没有岗位');
  const jobs=data.strata.flatMap(s=>s.jobs),active=number(planet.workforce_summary?.active_jobs_count),employed=number(planet.workforce_summary?.total_employed_workforce),total=number(data.total_workforce);
  const evidence={enumeratedJobs:jobs.length,activeJobs:active,employedWorkforce:employed,reportedWorkforce:total};
  if(!jobs.length&&(active>0||employed>0||total>0))return unknown('实际存在岗位或劳动力，但阶层列表为空；岗位枚举覆盖未知，不能判定空岗位、无劳动力或已满员',evidence);
  if(!jobs.length&&!(active===0&&employed===0&&total===0))return unknown('空岗位列表缺少完整的零岗位/零劳动力依据，不能把未知当成0',evidence);
  if(jobs.length&&jobs.every(j=>finite(j?.current_workforce))&&total!==null&&jobs.reduce((n,j)=>n+j.current_workforce,0)!==total)
   return unknown('枚举岗位劳动力之和与同次总劳动力不符，可能遗漏阶层；不能据此判断完整岗位填充',evidence);
  return {known:true,evidence};
 }
 if(section==='buildings'){
  if(!Array.isArray(data?.zones)||data.zones.some(z=>!Array.isArray(z?.buildable)))return unknown('建筑候选特区覆盖不完整');
  const candidates=data.zones.reduce((n,z)=>n+z.buildable.length,0),availableSlots=data.zones.reduce((n,z)=>n+(z.buildings_known!==false&&finite(z.buildings)&&finite(z.max_buildings)?Math.max(0,z.max_buildings-z.buildings):0),0);
  const constructionAlert=Array.isArray(planet.status_alerts)&&planet.status_alerts.some(a=>a?.id==='construction_available'||a?.type==='construction_available');
  const evidence={zones:data.zones.length,enumeratedCandidates:candidates,availableSlots,constructionAlert};
  if(!candidates&&(!data.zones.length||availableSlots>0||constructionAlert))return unknown(
   '当前有空建筑容量/建设提示或特区覆盖缺失，但可建列表为空；不能判定无合法建筑，更不能推断缺首府升级或科技；可能是当前费用条件，需定向引擎核验',evidence,
   {tool:'inspect',topic:'buildings',method:'get_buildable_buildings',readOnly:true,requires:['当前己方planet id','已核实的building_key','当前真实zone_id'],engineCanBuild:true});
  return {known:true,evidence};
 }
 return {known:true};
}

export function withConstructionCoverage(section,data,planet){
 const coverage=constructionCandidateCoverage(section,data,planet);
 return {...data,coverageKnown:coverage.known,...(!coverage.known?{coverageReason:coverage.reason,coverageEvidence:coverage.evidence,nextCoverageCheck:coverage.nextCheck}:{})};
}
