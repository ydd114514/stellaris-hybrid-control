import {reachableSurveyCandidate} from './survey-candidates.mjs';
import {delegationResourceRisks} from './delegation-budget.mjs';

export function validateManualSurveyReason(value){
 if(value!==undefined&&(typeof value!=='string'||!value.trim()||value.trim().length>300))throw Error('manualSurveyReason需要1..300字的具体手动调查理由');
 return value?.trim();
}

// Preference feedback only: never enables AI, cancels an order, or posts a move.
// Explicit strategic manual choice cannot bypass unknown/native control ownership.
export async function manualSurveyRoute({fleetId,referenceSystemId,status,budget={},manualSurveyReason,rpc}){
 const reason=validateManualSurveyReason(manualSurveyReason);
 const current=await rpc('get_fleet_automation',{fleet_id:fleetId});
 if(current?.fleet_id!==fleetId||current.known!==true||current.order_chain_complete!==true||!Array.isArray(current.orders)||typeof current.automation_enabled!=='boolean')
  return {decision:'inspect',reason:'科研船实际控制权或订单链未知，先核对，不能覆盖',nextCall:{tool:'survey_control',arguments:{operation:'inspect',fleetId}}};
 if(current.automation_enabled)
  return {decision:'reclaim',reason:'科研船仍由原生自动化控制；需要改方向时先显式收回，不能用手动理由覆盖',nextCall:{tool:'survey_control',arguments:{operation:'reclaim',fleetId},needsSnapshotId:true}};
 if(reason)return {decision:'manual',basis:'explicit_strategic_manual_reason',reason};
 if(current.orders.length)
  return {decision:'wait',reason:'科研船已有有效手动订单，先等待实际完成；若确需改变目标，请明确manualSurveyReason，不为启用自动化打断任务'};
 const risks=delegationResourceRisks(status,budget);
 if(risks.length)return {decision:'manual',basis:'delegation_reserve_unconfirmed',nativeDelegationAvailable:false,risks};
 let candidate;
 try{candidate=await reachableSurveyCandidate(rpc,fleetId,{referenceSystemId});}
 catch(error){return {decision:'manual',basis:'native_candidate_unconfirmed',nativeDelegationAvailable:false,reason:error.message};}
 return {decision:'delegate',reason:'本轮已确认空闲手动科研船与可达、已探索的调查候选。优先申请原生重复调查；精确战略调查仍可带manualSurveyReason选择手动。',candidateSystemId:candidate.target.id,
  nextCall:{tool:'survey_control',arguments:{operation:'delegate',fleetId},needsSnapshotId:true},manualOverride:{field:'manualSurveyReason',scope:'apply_orders或tasks run的顶层参数，理由不改变订单身份或绕过权限'},finalDelegationRecheckRequired:true};
}
