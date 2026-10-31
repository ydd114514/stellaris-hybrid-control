import {compareSurveyBranches} from './survey-benchmark.mjs';
import {surveyedBodyDelta} from './survey-benchmark-cohort.mjs';
const stable=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const decisions=new Set(['select_research','adopt_tradition','adopt_ascension_perk','resolve_event','hire_leader','assign_scientist','assign_councilor','set_council_agenda','launch_council_agenda','diplomacy','respond_diplomacy','select_leader_trait']);
const completedProofs={build_building:'building_count_increased',build_district:'district_count_increased',upgrade_building:'building_upgraded',clear_blocker:'blocker_removed',set_district_zone:'zone_installed',build_outpost:'outpost_exists',build_ship:'ship_design_count_increased',reinforce_fleet:'reinforcement_arrived',colonize:'colony_established',recruit_planet_army:'army_recruited'};
const housekeeping=new Set(['set_speed','set_fleet_stance']);
const intermediate=new Set(['survey','move_fleet','follow_fleet']);
// The ledger gives logical order arguments; journal transitions give the last
// observed state before stopping. Stopping's expired_unknown is not a failure.
export function normalWorkEvidence(events,ledger){
 const metas=events.filter(r=>r.type==='session_meta'),session=metas.length===1?metas[0].sessionId:null,stop=events.findIndex(r=>r.type==='stop_requested'),failures=[];
 if(!session||ledger?.sessionId!==session||!Array.isArray(ledger.records)||stop<0)return {known:false,failures:['完整同会话订单账本或停止边界缺失']};
 const before=events.slice(0,stop),states=before.filter(r=>r.type==='state'),status=new Map(),decisionCounts={},work=[];
 if(!states.length||states.some(r=>!Array.isArray(r.state?.wars)||r.state.wars.length))failures.push('本协议只比较起点和平的常规经营，战争状态未知或已变化');
 for(const row of before){
  if(row.type==='order_lifecycle'&&row.sessionId===session)status.set(row.trackingId,row);
  if(row.type==='unknown')failures.push('存在未知写入，不计算减少比例');
  if(row.type==='receipt'&&row.response?.success===true&&!decisions.has(row.command)&&!intermediate.has(row.command)&&!housekeeping.has(row.command)&&!Object.hasOwn(completedProofs,row.command))failures.push('尚未覆盖的真实操作：'+row.command);
  if(row.type==='receipt'&&decisions.has(row.command)&&row.response?.success===true){
   if(row.verification?.verified!==true)failures.push('关键决策接受后缺少结果回读：'+row.command);
   else decisionCounts[row.command]=(decisionCounts[row.command]??0)+1;
  }
  if(row.type==='rpc_write'&&row.method==='set_monthly_trade')failures.push('本协议尚无逐笔月结工作量口径，出现月度写入需另行核对');
 }
 const seen=new Set();
 for(const record of ledger.records){
  if(record?.sessionId!==session||typeof record.id!=='string'||seen.has(record.id)){failures.push('订单账本会话或唯一身份不完整');continue;}seen.add(record.id);
  if(intermediate.has(record.command)||decisions.has(record.command))continue;
  const proof=status.get(record.id),s=proof?.status;
  if(record.submissionConfirmed!==true||!record.arguments||!['completed','queued','executing','failed'].includes(s)){failures.push('订单提交/结束前状态未确认：'+record.command);continue;}
  if(s==='failed')continue;
  if(proof.command!==record.command||!Object.hasOwn(completedProofs,record.command)||(s==='completed'?proof.proof?.kind!==completedProofs[record.command]:!['queue_observed','fleet_order_observed'].includes(proof.proof?.kind))){failures.push('工作量缺少真实证明：'+record.command);continue;}
  const args=Object.fromEntries(Object.entries(record.arguments).filter(([k])=>k!=='queue'));
  work.push(stable({command:record.command,arguments:args,state:s==='completed'?'completed':'pending'}));
 }
 for(const [trackingId,row] of status)if(!seen.has(trackingId)&&!intermediate.has(row.command)&&!decisions.has(row.command))failures.push('订单账本已缺失历史工作，不能只比较剩余记录');
 for(const row of before.filter(x=>x.type==='receipt'&&x.response?.success===true&&Object.hasOwn(completedProofs,x.command)))if(!ledger.records.some(r=>r.requestId===row.requestId&&r.command===row.command))failures.push('真实操作缺少对应订单账本：'+row.command);
 return {known:failures.length===0,failures:[...new Set(failures)],work:work.sort(),decisionCounts};
}

// Separate, predeclared protocol. Historical single-ship reports keep their
// original interpretation and are never upgraded by this comparator.
export function compareNormalHybridBranches(a,b){
 const base=a?.spec?.mode==='baseline'?a:b,mix=a?.spec?.mode==='hybrid'?a:b,foundation=compareSurveyBranches(a,b),failures=[...foundation.failures];
 for(const branch of [base,mix]){
  if(branch?.spec?.comparisonProtocol!=='normal_production_v3'||branch.spec.scope!=='normal_hybrid_gameplay')failures.push('需要预先声明的普通经营v3协议，不能套用旧调查报告');
  if(branch?.sourceUnchanged!==true||!branch.spec?.adapterRevision)failures.push('运行期间源码和原生桥一致性未确认');
  for(const key of ['colonyUpgrade','monthlyLifecycle','localWait'])if(branch?.run?.controlEvidence?.featureFlags?.[key]!==true)failures.push('普通经营功能实际开关不完整');
  if(branch?.normalWork?.known!==true)failures.push('非调查工作量或关键决策覆盖未知');
  if(branch?.normalWork?.work?.some(x=>{try{return JSON.parse(x).state==='pending';}catch{return true;}}))failures.push('仍有在途工作，缺少精确进度，不能视为等量完成');
 }
 const bodies=branch=>{const rows=branch?.trackedSystems||[],parts=rows.map(r=>surveyedBodyDelta(r.before,r.after));if(!rows.length||parts.some(x=>x===null))return null;const flat=parts.flat();return new Set(flat).size===flat.length?flat.sort((x,y)=>x-y):null;};
 const ba=bodies(base),bb=bodies(mix),bodyMatch=ba!==null&&bb!==null&&ba.length>0&&stable(ba)===stable(bb);
 const workMatch=base?.normalWork?.known===true&&mix?.normalWork?.known===true&&stable(base.normalWork.work)===stable(mix.normalWork.work)&&stable(base.normalWork.decisionCounts)===stable(mix.normalWork.decisionCounts);
 if(!bodyMatch)failures.push('调查天体的实际完成集合不同、为空或未知');
 if(!workMatch)failures.push('其他完成/在途工作及关键决策数量不匹配');
 const eligible=failures.length===0,percent=eligible?(base.run.modelRequests-mix.run.modelRequests)/base.run.modelRequests*100:null;
 return {protocol:'normal_production_v3',comparisonEligible:eligible,matchedObservedStart:foundation.matchedObservedStart,failures:[...new Set(failures)],baseline:foundation.baseline,hybrid:foundation.hybrid,workload:{sameBodies:bodyMatch,sameOtherWorkAndDecisionCounts:workMatch},requestReductionPercent:percent,request50PercentTargetMet:percent!==null&&percent>=50,acceptancePassed:false,
  limitations:['本协议独立于旧版单船调查统计，不重新解释旧报告。','只在预先固定范围的相同天体集合、其他工作与关键决策匹配时计算请求比例。','月度逐笔结算、战争、未知或未覆盖工作会阻止比例计算，不将预览/提交当完成。','不据请求数估算费用，也不替代慢响应暂停、战略质量、直播呈现或60分钟持续验收。']};
}
