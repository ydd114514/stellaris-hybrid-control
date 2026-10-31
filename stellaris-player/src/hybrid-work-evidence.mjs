// Offline journal analysis only. This module never grants game authority.
const completedProofs={
 build_building:'building_count_increased',build_district:'district_count_increased',upgrade_building:'building_upgraded',clear_blocker:'blocker_removed',set_district_zone:'zone_installed',
 survey:'system_surveyed',move_fleet:'fleet_at_destination',build_outpost:'outpost_exists',build_ship:'ship_design_count_increased',reinforce_fleet:'reinforcement_arrived',colonize:'colony_established',recruit_planet_army:'army_recruited',select_research:'research_selection'
};
const domains={build_building:'colony_construction',build_district:'colony_construction',upgrade_building:'colony_construction',clear_blocker:'colony_construction',set_district_zone:'colony_construction',survey:'survey',move_fleet:'movement',build_outpost:'expansion_construction',build_stations:'expansion_construction',build_ship:'shipbuilding',reinforce_fleet:'shipbuilding',recruit_planet_army:'army_recruitment'};
const id=n=>Number.isSafeInteger(n)&&n>=0&&n<0xffffffff;
const at=row=>Date.parse(row?.at);
function nativeSurveyWork(record,sessionId,when){
 const s=record?.observation,automation=s?.orders?.filter(o=>o.automation===true);
 return record?.sessionId===sessionId&&record.owner==='native'&&record.pending===false&&Number.isFinite(record.observedAt)&&when-record.observedAt>=0&&when-record.observedAt<=3000&&s?.known===true&&s.automation_enabled===true&&s.order_chain_complete===true&&s.automation_order_count===1&&automation?.length===1&&[2,0x402].includes(automation[0].settings_bits)&&automation[0].action_option_count===0&&s.orders.some(o=>o.automation===false);
}
export function analyzeHybridWorkEvidence(events){
 const metas=events.filter(r=>r.type==='session_meta'),sessionIds=[...new Set(metas.map(r=>r.sessionId))];
 if(sessionIds.length!==1||typeof sessionIds[0]!=='string')return {sessionKnown:false,completed:null,sampledCoexistence:null,nativeSurveyAlongsideQueue:null,interventionCycles:null,acceptancePassed:false,reason:'缺少唯一控制器会话，不能拼接工作证据'};
 const sessionId=sessionIds[0],completed=new Map(),coexistence=[],nativeAlongside=[],interventions=[],owners=new Map(),intents=new Map();
 for(const event of events){
  const when=at(event);if(!Number.isFinite(when))continue;
  if(event.type==='intent'&&typeof event.requestId==='string')intents.set(event.requestId,event.orders);
  if(event.type==='order_lifecycle'&&event.sessionId===sessionId&&event.status==='completed'&&typeof event.trackingId==='string'&&completedProofs[event.command]===event.proof?.kind){
   completed.set(event.trackingId,{trackingId:event.trackingId,requestId:event.requestId,command:event.command,at:event.at,proof:event.proof});
  }
  if(event.type==='survey_control'&&id(event.fleetId)&&event.control?.sessionId===sessionId&&event.control.pending===false){
   const record=event.control,old=owners.get(event.fleetId),s=record.observation;
   if(record.owner==='manual'&&old?.native===true&&s?.known===true&&s.automation_enabled===false&&s.order_chain_complete===true)owners.set(event.fleetId,{native:false,reclaimedAt:event.at});
   if(record.owner==='native'&&s?.known===true&&s.automation_enabled===true&&s.order_chain_complete===true){
    if(old?.reclaimedAt&&old?.manualSubmitted)interventions.push({fleetId:event.fleetId,reclaimedAt:old.reclaimedAt,manualSubmitted:old.manualSubmitted,reDelegatedAt:event.at});
    owners.set(event.fleetId,{native:true});
   }
  }
  if(event.type==='receipt'&&event.response?.success===true&&['move_fleet','survey'].includes(event.command)){
   const matching=(intents.get(event.requestId)||[]).filter(o=>o.command===event.command);
   // Multiple same-command actions in one request cannot identify this receipt.
   if(matching.length===1){const old=owners.get(matching[0].arguments?.fleet_id);if(old?.reclaimedAt)old.manualSubmitted={at:event.at,requestId:event.requestId,command:event.command};}
  }
  if(event.type!=='state'||event.state?.paused!==false)continue;
  const recent=event.state.orderTracking?.recent||[],fresh=recent.filter(r=>['queued','executing'].includes(r.status)&&['queue_observed','fleet_order_observed'].includes(r.proof?.kind)&&Number.isFinite(r.updatedAt)&&when-r.updatedAt>=0&&when-r.updatedAt<=5000);
  const workDomains=[...new Set(fresh.map(r=>domains[r.command]).filter(Boolean))];
  if(workDomains.length>1)coexistence.push({at:event.at,gameDate:event.state.date,domains:workDomains});
  const native=Object.values(event.state.surveyControl?.records||{}).filter(r=>nativeSurveyWork(r,sessionId,when));
  const queues=fresh.filter(r=>r.proof.kind==='queue_observed');
  if(native.length&&queues.length)nativeAlongside.push({at:event.at,gameDate:event.state.date,fleetIds:native.map(r=>r.fleetId),trackingIds:queues.map(r=>r.id)});
 }
 const records=[...completed.values()],counts={};for(const r of records)counts[r.command]=(counts[r.command]||0)+1;
 return {sessionKnown:true,sessionId,completed:{count:records.length,byCommand:counts,records},sampledCoexistence:{count:coexistence.length,examples:coexistence.slice(0,10)},nativeSurveyAlongsideQueue:{count:nativeAlongside.length,examples:nativeAlongside.slice(0,10)},interventionCycles:interventions,acceptancePassed:false,
  limitations:['只汇总当前日志中带匹配proof的完成，不把posted、queued或队列消失当完工；research_selection只表示选题，不表示科技研发完成。','工作共存仅为未暂停快照中的近期证明，不是引擎原子或整段连续并行证明；有界recent列表与旧updatedAt可能漏计，未观察到不代表未发生。','干预候选仅证明已确认原生收回、手动命令接受及重新委派；手动目标是否完成、战略理由和收益仍须另查。','日志证据不能单独证明模型请求减半、效率提升、原生调查新增天体数量或整体长测通过。']};
}

// Independent gameplay gate. Duration and API counts can never satisfy it.
// modelActions must come from paired, complete successful DSH tool results.
export function assessConquestEvidence({events=[],modelActions=[],realModelRequests=0,sourceUnchanged=false}={}){
 const metas=events.filter(x=>x.type==='session_meta'),session=metas.length===1?metas[0].sessionId:null;
 const states=events.filter(x=>x.type==='state'),candidates=states.filter(x=>x.state?.gestalt?.campaign?.phase==='completed'&&x.state.gestalt.campaign.result?.success===true);
 let best={};
 for(const completed of candidates){
  const c=completed.state.gestalt.campaign;if(typeof c.id!=='string'||!id(c.warId))continue;
  const campaignStates=states.filter(x=>x.state?.gestalt?.campaign?.id===c.id),evidence=Object.values(c.observedEvidence||{}),gainIds=c.result.gainedPlanets||[],systemIds=c.result.gainedSystems||[];
  const selected=modelActions.some(a=>a.kind==='campaign'&&a.operation==='select'&&a.campaignId===c.id&&a.target===c.target);
  const configured=modelActions.some(a=>a.kind==='campaign'&&a.operation==='start'&&a.campaignId===c.id)&&events.some(x=>x.type==='campaign_decision'&&x.sessionId===session&&x.campaignId===c.id&&x.operation==='start'&&x.executionConfigured===true);
  const declared=events.some(x=>x.type==='order_lifecycle'&&x.sessionId===session&&x.trackingId===c.actions?.declare?.trackingId&&x.status==='completed'&&x.proof?.kind==='war_created'&&x.proof.warId===c.warId);
  const battled=evidence.some(x=>['fleet_combat','ground_combat'].includes(x.kind));
  const occupied=evidence.some(x=>x.kind==='occupation'&&gainIds.includes(x.entity)||x.kind==='system_occupation'&&systemIds.includes(x.entity));
  const ended=campaignStates.some(x=>x.state.wars?.some(w=>w.war_id===c.warId))&&c.result.warEnded===true&&Array.isArray(completed.state.wars)&&!completed.state.wars.some(w=>w.war_id===c.warId);
  const gained=(gainIds.length>0||systemIds.length>0)&&systemIds.every(systemId=>c.baseline?.systems?.some(b=>b.systemId===systemId&&b.ownerId===c.target)&&c.result.systems?.some(o=>o.systemId===systemId&&o.ownerId===completed.state.player?.country_id))&&gainIds.every(planetId=>c.baseline?.objectives?.some(b=>b.planetId===planetId&&b.ownerId===c.target)&&c.result.objectives?.some(o=>o.planetId===planetId&&o.ownerId===completed.state.player?.country_id));
  const recovery=c.recoveryEvidence,restored=recovery?.homePresenceConfirmed===true&&recovery.maintenanceFloorsChecked===true&&Number.isFinite(recovery.ships)&&Number.isFinite(recovery.requiredShips)&&recovery.ships>=recovery.requiredShips;
  const nextSelection=events.some(x=>x.type==='campaign_decision'&&x.operation==='select'&&x.campaignId!==c.id&&at(x)>at(completed)&&modelActions.some(a=>a.kind==='campaign'&&a.operation==='select'&&a.campaignId===x.campaignId));
  const nativeTargetReads=events.filter(x=>x.type==='inspect'&&x.topic==='targets'),modelTargetReads=modelActions.filter(x=>x.kind==='targets');
  const nextAssessment=nextSelection||nativeTargetReads.length===modelTargetReads.length&&nativeTargetReads.some(x=>at(x)>at(completed));
  const checks={modelSelectedTarget:selected,modelConfiguredPreparation:configured,realWarCreated:declared,realBattleObserved:battled,occupationObserved:occupied,warEndObserved:ended,verifiedTerritorialGain:gained,postwarRecoveryObserved:restored,nextTargetAssessmentObserved:nextAssessment};
  if(Object.values(checks).filter(Boolean).length>Object.values(best.checks||{}).filter(Boolean).length)best={campaignId:c.id,target:c.target,warId:c.warId,gainedPlanets:gainIds,gainedSystems:systemIds,checks};
 }
 const gameplayPassed=best.checks&&Object.values(best.checks).every(Boolean);
 return {scope:'proactive_conquest_and_postwar_continuation_v1',sessionKnown:!!session,sourceUnchanged,realModelRequests,...best,gameplayPassed:!!gameplayPassed,conquestEvidencePassed:!!session&&sourceUnchanged&&Number.isSafeInteger(realModelRequests)&&realModelRequests>0&&!!gameplayPassed,acceptancePassed:false,
 limitations:['只读核对单会话实际战役与完整工具结果，不接受时长、posted或模拟代替战果。','议和提案类型不等于实际和平条款；这里只核对战争已结束及目标所有权真实改变。','停止、资源和控制边界仍须独立核对，不由本玩法门槛替代。']};
}
