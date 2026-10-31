import {surveyGameDay} from './survey-idle-policy.mjs';
import {MonthlyTradeExecution} from './monthly-trade-execution.mjs';
const key=s=>typeof s==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(s);
export function monthlyRecoveryCandidates(records,sessionId){
 const old=records.filter(r=>r.sessionId!==sessionId&&!r.released&&(r.ownedOrder||r.steps?.length||r.status==='prepared'));
 const unresolved=r=>['issued','not_sent'].includes(r.cleanupIntent?.status)||r.ownership?.known===false||!['order_registered','order_replaced'].includes(r.status);
 const visible=old.map((r,index)=>({r,index})).sort((a,b)=>Number(unresolved(b.r))-Number(unresolved(a.r))||b.index-a.index).slice(0,16).map(x=>x.r);
 return {scope:'bound_process_persisted_records',count:old.length,detailsTruncated:old.length>visible.length,detailOrder:'unresolved_then_recent',records:visible.map(r=>({sessionId:r.sessionId,requestId:r.requestId,status:r.cleanupIntent?.status==='issued'?'cancellation_unconfirmed':r.cleanupIntent?.status==='not_sent'?'cancellation_not_submitted':r.ownership?.known===false?'ownership_unconfirmed':r.status,orderId:r.ownedOrder?.order_id,reservation:r.reservation,requiresExplicitRecovery:true,automaticResume:false}))};
}
export function assertMonthlyRecoveryBinding(record,current){
 const scope=record.before?.scope,day=surveyGameDay(current.scope?.gameDate),before=surveyGameDay(scope?.gameDate);
 if(!scope||scope.sessionId!==record.sessionId||scope.pid!==current.scope?.pid||scope.creationTime!==current.scope?.creationTime||record.before.countryId!==current.countryId||day===null||before===null||day<before)throw Error('旧月度记录的进程、玩家或日期绑定不匹配，不能按旧ID清理');
}
export function recoveryOwnsOrder(records,sessionId,orderId){
 return records.some(r=>r.sessionId!==sessionId&&r.recoveryOwnerSessionId===sessionId&&!r.released&&r.ownedOrder?.order_id===orderId);
}
async function cleanupRecord({records,record,snapshot,rpc,save,reason}){
 const actor=new MonthlyTradeExecution({store:()=>records,save,rpc,sessionId:record.sessionId,snapshot:async()=>{
  const current=await snapshot({cleanup:true});assertMonthlyRecoveryBinding(record,current);
  return {...current,scope:{...current.scope,sessionId:record.sessionId}};
 }});
 // A manually changed/deleted order releases old control through fresh reads.
 // An in-flight cancellation is different: it must remain unresolved until
 // absence is observed; do not reclassify or re-post it.
 if(record.ownedOrder&&!record.released&&record.cleanupIntent?.status!=='issued'&&['order_registered','order_replaced'].includes(record.status))await actor.reconcile(record.requestId);
 return actor.cleanup({requestIds:[record.requestId],reason});
}
export async function recoverMonthlyRecord({records,previousSessionId,requestId,sessionId,snapshot,rpc,save,assertActive=()=>{}}){
 if(!key(previousSessionId)||!key(requestId)||previousSessionId===sessionId)throw Error('恢复需要旧sessionId和原requestId；当前会话使用reconcile');
 const matches=records.filter(r=>r.sessionId===previousSessionId&&r.requestId===requestId);
 if(matches.length!==1)throw Error('旧月度请求不存在或不唯一，先inspect读取持久记录');
 const record=matches[0];assertActive();
 const current=await snapshot({cleanup:true});assertMonthlyRecoveryBinding(record,current);assertActive();
 if(record.released)return {confirmed:true,orders:[],alreadyReleased:true,controlReleased:true,termination:record.termination,automaticResume:false,settlementConfirmed:false,worldLineageVerified:false};
 // This annotation grants only cancellation of the explicitly selected old
 // record during stop/supervisor cleanup; it never transfers creation rights.
 record.recoveryOwnerSessionId=sessionId;await save();
 const result=await cleanupRecord({records,record,snapshot,rpc,save,reason:'explicit_old_session_recovery'});
 return {...result,previousSessionId,requestId,controlReleased:record.released===true,termination:record.termination,automaticResume:false,settlementConfirmed:false,worldLineageVerified:false};
}
export async function cleanupRecoveredMonthlyRecords({records,sessionId,snapshot,rpc,save}){
 const selected=records.filter(r=>r.sessionId!==sessionId&&r.recoveryOwnerSessionId===sessionId&&!r.released);
 const results=[];
 for(const record of selected){
  try{results.push({sessionId:record.sessionId,requestId:record.requestId,...await cleanupRecord({records,record,snapshot,rpc,save,reason:'recovery_controller_stop'})});}
  catch(error){results.push({sessionId:record.sessionId,requestId:record.requestId,confirmed:false,error:error.message});}
 }
 return {confirmed:results.every(r=>r.confirmed===true),records:results,automaticResume:false};
}
