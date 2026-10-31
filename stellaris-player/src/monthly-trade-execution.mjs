import {previewMonthlyChange,reconcileMonthlyChange,validateMonthlyChange} from './monthly-trade-changes.mjs';
import {monthlyTradeAccounting} from './monthly-trade-accounting.mjs';
import {setTimeout as delay} from 'node:timers/promises';
import {validateMonthlyLifecyclePolicy,assertMonthlyLifecycleAdmission} from './monthly-trade-lifecycle.mjs';
import {UPGRADE_PATH_BRIDGE_VERSION,TRADE_BUDGET_BRIDGE_VERSION,CLAIM_BUDGET_BRIDGE_VERSION,assertBridgeCapabilities} from './bridge-capabilities.mjs';

export const MONTHLY_EXECUTION_BRIDGE='cyberfish-0.6.9-monthly-read-r2';
export const MONTHLY_QUOTE_BRIDGE='cyberfish-0.6.10-monthly-quotes-r1';
export const MONTHLY_EXECUTION_BRIDGES=[MONTHLY_EXECUTION_BRIDGE,MONTHLY_QUOTE_BRIDGE,UPGRADE_PATH_BRIDGE_VERSION,TRADE_BUDGET_BRIDGE_VERSION,CLAIM_BUDGET_BRIDGE_VERSION];
export function monthlyQuoteCondition(quote,change){
 if(quote?.success!==true||quote.price_basis!=='engine_monthly_transaction_total'||quote.resource!==change.resource||quote.action!==change.action||quote.units!==change.amount||quote.includes_fee!==true||quote.settlement_rounding!=='ceil_to_whole_currency'||!Number.isInteger(quote.total)||quote.total<1||quote.total>0x7fffffff)throw Error('月度整笔报价来源、数量或取整规则不匹配');
 const limitTotal=change.amount*change.priceLimit;
 return {quotedTotal:quote.total,includesFee:true,rounding:'ceil_to_whole_currency',priceLimitTotal:limitTotal,priceConditionMet:change.priceLimit===0|| (change.action==='buy'?quote.total<=limitTotal:quote.total>=limitTotal),futurePriceGuaranteed:false};
}
const terminal=new Set(['order_registered','order_replaced','order_removed','already_present','already_absent','rejected','old_order_removed_new_not_submitted']);
const notApplied=s=>['not_sent','rejected_native'].includes(s.status);
const pendingCleanup=r=>['issued','not_sent'].includes(r.cleanupIntent?.status);
const operationalStatus=r=>!r.released&&pendingCleanup(r)?r.cleanupIntent.status==='not_sent'?'cancellation_not_submitted':'cancellation_unconfirmed':!r.released&&r.ownership?.known===false?'ownership_unconfirmed':r.status;
const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a.localeCompare(b))):x);
const equal=(a,b)=>canonical(a)===canonical(b);
const matches=(a,b)=>a.order_id===b.order_id&&a.resource===b.resource&&a.action===b.action&&a.amount===b.amount&&a.price_limit===b.price_limit;
export function monthlyReservationRisks(status,records,{sessionId,commitments={},floors={}}={}){
 const owned=records.filter(r=>r.sessionId===sessionId&&!r.released&&(r.ownedOrder||r.steps?.length));
 const keys=new Set(owned.flatMap(r=>Object.keys(r.reservation||{})));
 const risks=owned.filter(r=>['issued','unknown','old_order_removed_new_unconfirmed'].includes(r.status)||pendingCleanup(r)||r.ownership?.known===false).map(r=>({requestId:r.requestId,reason:r.cleanupIntent?.status==='not_sent'?'cleanup_not_submitted':'unknown_order_state'}));
 for(const resource of keys){
  const row=status.resources?.[resource],reserved=commitments[resource]??0,floor=floors[resource]??0;
  if(row?.stockpile_known!==true||row.net_known!==true||row.net_basis!=='engine_total_including_monthly_trade'||!Number.isFinite(row.stockpile)||!Number.isFinite(row.net)||!Number.isFinite(reserved)||reserved<0||!Number.isFinite(floor)||floor<0){risks.push({resource,reason:'unknown_budget'});continue;}
  if(row.stockpile+Math.min(0,row.net)*3-reserved-floor<0)risks.push({resource,reason:'reserve_shortfall',stockpile:row.stockpile,reserved,floor,observedNet:row.net});
 }
 return risks;
}

// One durable intent per request. A transport error is never an instruction to
// repeat a command. Confirmation comes only from complete, same-session lists.
export class MonthlyTradeExecution {
 constructor({store,save,snapshot,rpc,sessionId,budgetOptions=()=>({}),assertActive=()=>{},allowLifecyclePolicies=false}){Object.assign(this,{store,save,snapshot,rpc,sessionId,budgetOptions,assertActive,allowLifecyclePolicies});}
 async execute({requestId,change,policy}){
  change=validateMonthlyChange(change);
  if(policy!==undefined&&!this.allowLifecyclePolicies)throw Error('月度库存/期限条件尚待统一验收，默认关闭');
  const lifecyclePolicy=validateMonthlyLifecyclePolicy(policy,change);
  if(typeof requestId!=='string'||! /^[a-zA-Z0-9_-]{1,100}$/.test(requestId))throw Error('月度执行需要1..100字符requestId');
  const records=this.store();const prior=records.find(r=>r.requestId===requestId&&r.sessionId===this.sessionId);
  if(prior){if(!equal(prior.change,change)||!equal(prior.policy??null,lifecyclePolicy))throw Error('同一requestId的月度变更或持续条件内容不能改变');return this.result(prior);}
  if(records.length>=256)throw Error('月度变更记录达到上限，需要先归档');
  if(change.operation!=='cancel'&&records.some(r=>!r.released&&(!terminal.has(r.status)||pendingCleanup(r)||r.ownership?.known===false)))throw Error('有月度写入结果未确认，请先reconcile或撤销，不自动叠加');
  if(change.operation==='cancel'&&records.some(r=>r.sessionId===this.sessionId&&!r.released&&(r.cleanupIntent?.status==='issued'&&r.ownedOrder?.order_id===change.orderId||r.change?.operation==='cancel'&&r.change.orderId===change.orderId&&!terminal.has(r.status)&&r.steps?.some(s=>s.params.cancel===true))))throw Error('该月度撤销仍在途，先reconcile；不能更换requestId重发');
  this.assertActive();
  const before=await this.snapshot();
  assertMonthlyLifecycleAdmission(before,change,lifecyclePolicy);
  const ping=await this.rpc('ping');
  if([TRADE_BUDGET_BRIDGE_VERSION,CLAIM_BUDGET_BRIDGE_VERSION].includes(ping?.bridge_version))assertBridgeCapabilities(ping,{tradeBudget:true});
  if(!MONTHLY_EXECUTION_BRIDGES.includes(ping?.bridge_version)||!Array.isArray(ping.features)||!ping.features.includes('monthly_trade_read_coverage_candidate'))throw Error('月度执行需要已核对的月度桥及完整读取能力；旧桥不写入');
  if([MONTHLY_QUOTE_BRIDGE,UPGRADE_PATH_BRIDGE_VERSION].includes(ping.bridge_version)&&!ping.features.includes('engine_monthly_trade_quotes'))throw Error('月度报价桥功能标记不完整，拒绝继续写入');
  if(ping.bridge_version===UPGRADE_PATH_BRIDGE_VERSION&&!ping.features.includes('building_upgrade_string_paths'))throw Error('升级路径桥功能标记不完整，拒绝继续写入');
  const plan=previewMonthlyChange(before.market,change,before);
  if(!['creation_preview','two_phase_replace_preview','cancellation_preview','already_present','already_absent'].includes(plan.status))throw Error(`月度变更被拒绝：${plan.status}`);
  if(lifecyclePolicy&&!plan.steps.length)throw Error('现有订单不能通过重复设置附加条件；条件只随明确新建或实际调整登记，不接管手工旧单');
  const reservation=change.operation==='cancel'||!plan.steps.length?{}:this.admit(before,change);
  const quote=change.operation!=='cancel'&&plan.steps.length&&ping.features.includes('engine_monthly_trade_quotes')?monthlyQuoteCondition(await this.rpc('get_monthly_trade_quote',{resource:change.resource,action:change.action,units:change.amount}),change):null;
  const record={requestId,sessionId:this.sessionId,change,policy:lifecyclePolicy,before,sourceFingerprint:plan.sourceFingerprint,reservation,quote,status:plan.steps.length?'prepared':plan.status,steps:[]};
  records.push(record);await this.save();
  if(!plan.steps.length){
   if(change.operation==='cancel'&&plan.status==='already_absent'){
    for(const r of records)if(r!==record&&r.sessionId===this.sessionId&&r.ownedOrder?.order_id===change.orderId){r.released=true;r.reservation={};r.termination={reason:'already_absent',confirmed:true,gameDate:before.scope.gameDate};}
    await this.save();
   }
   return this.result(record);
  }
  let activeStep,attempted=false;
  try{
   for(const step of plan.steps){
    activeStep=undefined;attempted=false;
    this.assertActive();
    // Before phase two, verify phase one's exact removal. No create fallback.
    if(record.steps.length){
     const mid=await this.snapshot();
     const removed=reconcileMonthlyChange(before.market,mid.market,{operation:'cancel',orderId:change.orderId},{countryId:before.countryId,sourceFingerprint:previewMonthlyChange(before.market,{operation:'cancel',orderId:change.orderId},before).sourceFingerprint,beforeScope:before.scope,afterScope:mid.scope});
     if(removed.status!=='order_removed')throw Error('调整旧单撤销未确认，禁止新增');
     record.confirmedRemovalScope=mid.scope;
     this.releaseReplacedOrder(record,mid.scope);
     this.admit(mid,change,record);
     assertMonthlyLifecycleAdmission(mid,change,lifecyclePolicy);
    }
    activeStep={params:step.params,status:'issued'};record.status='issued';record.steps.push(activeStep);await this.save();
    this.assertActive();
    attempted=true;
    const receipt=await this.rpc(step.method,step.params);
    activeStep.receipt=receipt;activeStep.nativeWriteAttempted=true;
    if(receipt?.success!==true){const error=Error(receipt?.message||'原生桥未接受月度命令');if(receipt?.success===false)error.rejected=true;throw error;}
    activeStep.status='submitted';await this.save();activeStep=undefined;
   }
  }catch(error){
   record.error=error.message;
   if(activeStep&&(!attempted||error.nativeWriteAttempted===false||error.rejected===true)){
    activeStep.nativeWriteAttempted=attempted&&error.nativeWriteAttempted!==false;activeStep.status=error.rejected===true?'rejected_native':'not_sent';activeStep.error=error.message;
   }
   if(record.steps.every(notApplied)){
    record.status='rejected';record.released=true;record.reservation={};record.termination={reason:'not_submitted_or_rejected',confirmed:true,orderRegistrationConfirmed:false};await this.save();return this.result(record);
   }
   if(record.change.operation==='replace'&&record.confirmedRemovalScope&&!record.steps.some(s=>s.params.cancel===false&&!notApplied(s))){
    this.finishPartialReplacement(record,record.confirmedRemovalScope);await this.save();return this.result(record);
   }
  }
  return this.confirm(record);
 }
 finishPartialReplacement(record,scope){
  record.status='old_order_removed_new_not_submitted';record.released=true;record.reservation={};record.termination={reason:'replacement_creation_not_submitted',confirmed:true,oldOrderRemoved:true,newOrderRegistered:false,gameDate:scope.gameDate};
  this.releaseReplacedOrder(record,scope);
 }
 releaseReplacedOrder(record,scope){
  for(const r of this.store())if(r!==record&&r.sessionId===this.sessionId&&r.ownedOrder?.order_id===record.change.orderId){r.reservation={};r.released=true;r.termination={reason:'replacement_old_order_removed',confirmed:true,gameDate:scope.gameDate};}
 }
 admit(snapshot,change,excludeMonthlyRecord){
  const a=monthlyTradeAccounting(snapshot.status,snapshot.market,{countryId:snapshot.countryId,...this.budgetOptions({excludeMonthlyRecord})});
  if(!a.budgetKnown)throw Error('月度贸易库存、总净收支、预留或订单覆盖未知');
  if(change.action==='buy'&&change.priceLimit===0)throw Error('月度买入需要非零限价，禁止无限价持续支出');
  if(!snapshot.market.resources?.some(r=>r.key===change.resource))throw Error('资源不在当前市场候选中');
  if(change.resource===a.settlementCurrency)throw Error('不能买卖结算货币自身');
  const resource=change.action==='buy'?a.settlementCurrency:change.resource;
  // Exact-build monthly predicate compares the fee-inclusive, rounded total
  // against amount * limit. Adding a second fee would reserve it twice.
  const monthly=change.amount*(change.action==='buy'?change.priceLimit:1);
  if(!Number.isSafeInteger(monthly))throw Error('月度预留超出安全数值范围');
  const balance=a.projections.find(p=>p.resource===resource);
  // Existing engine net already includes old orders. Positive future income and
  // future sale proceeds are never admitted as current funds.
  if(!balance?.known||balance.reserveStressBalance<monthly*a.months)throw Error('月度支出不足以覆盖复查期和共享预留底线');
  return {[resource]:monthly};
 }
 async confirm(record,{cleanup=false,allowRunning=false}={}){
  try{
   let after,result;
   // Commands may reach the engine one tick after their posting receipt. Poll
   // reads only; never re-post a command while waiting for the engine.
   for(let attempt=0;attempt<3;attempt++){
    after=await this.snapshot({cleanup,allowRunning});
    const confirmedRemovals=this.store().filter(r=>r.sessionId===this.sessionId&&r.released&&r.ownedOrder&&r.termination?.confirmed===true&&r.lastCleanupScope&&r.cleanupWitnessedRequests?.length).map(r=>({kind:'owned_cleanup_readback',countryId:r.cleanupCountryId,scope:r.lastCleanupScope,order:r.ownedOrder,pendingRequests:r.cleanupWitnessedRequests}));
    const noCreation=record.change.operation==='replace'&&!record.steps.some(s=>s.params.cancel===false&&!notApplied(s));
    const observedChange=noCreation?{operation:'cancel',orderId:record.change.orderId}:record.change;
    result=reconcileMonthlyChange(record.before.market,after.market,observedChange,{countryId:record.before.countryId,sourceFingerprint:record.sourceFingerprint,beforeScope:record.before.scope,afterScope:after.scope,requestId:record.requestId,confirmedRemovals});
    if(noCreation&&result.status==='order_removed'){this.finishPartialReplacement(record,after.scope);result={...result,status:record.status};}
    if(!['unknown','old_order_removed_new_unconfirmed'].includes(result.status))break;
    if(attempt<2)await delay(50);
   }
   Object.assign(record,result);record.after=after;
   if(['order_registered','order_replaced'].includes(result.status))record.ownedOrder=monthlyTradeAccounting(after.status,after.market,{countryId:after.countryId}).observedOrders.find(o=>o.order_id===result.orderId);
   if(result.status==='order_removed')record.reservation={};
   if(['order_removed','order_replaced'].includes(result.status))for(const r of this.store())if(r.sessionId===this.sessionId&&r.ownedOrder?.order_id===record.change.orderId){r.reservation={};r.released=true;}
  }catch(error){record.status='unknown';record.error=error.message;}
  await this.save();return this.result(record);
 }
 async reconcile(requestId){
  const r=this.store().find(r=>r.requestId===requestId&&r.sessionId===this.sessionId);if(!r)throw Error('当前会话没有该月度请求');
  if(r.cleanupIntent?.status==='issued'){await this.cleanup({requestIds:[requestId],reason:r.cleanupIntent.reason});return this.result(r);}
  if(r.ownedOrder&&!r.released&&terminal.has(r.status)){
   try{
    const observed=await this.snapshot(),a=monthlyTradeAccounting(observed.status,observed.market,{countryId:observed.countryId});
    if(!a.ordersKnown)throw Error('当前订单归属或覆盖未知');
    const current=a.observedOrders.find(o=>o.order_id===r.ownedOrder.order_id);
    r.ownership={known:true,present:!!current,gameDate:observed.scope.gameDate,currentOrder:current};
    if(!current||!matches(current,r.ownedOrder)){
     r.released=true;r.reservation={};r.termination={reason:current?'external_order_changed':'external_order_absent',controlReleased:true,orderRemoved:!current,confirmed:true,gameDate:observed.scope.gameDate};
    }
   }catch(error){r.ownership={known:false,reason:error.message};}
   await this.save();return this.result(r);
  }
  return terminal.has(r.status)?this.result(r):this.confirm(r);
 }
 result(r){const pause=r.after??(['already_present','already_absent'].includes(r.status)?r.before:null);return {requestId:r.requestId,status:operationalStatus(r),orderId:r.orderId,ownedOrder:r.ownedOrder,released:r.released===true,ownership:r.ownership,quote:r.quote,policy:r.policy??null,termination:r.termination,acknowledgedCleanupIds:r.acknowledgedCleanupIds,error:r.error??r.cleanupError,readOnly:false,automaticRetryAllowed:false,settlementConfirmed:false,paused:typeof pause?.status?.is_paused==='boolean'?pause.status.is_paused:null,pauseObservedDate:pause?.scope?.gameDate??null,pauseObservationOnly:true};}
 async cleanup({requestIds,allowRunning=false,reason='controller_stop',lateReadback=true}={}){
  if(requestIds!==undefined&&(!Array.isArray(requestIds)||!requestIds.every(x=>typeof x==='string')))throw Error('订单收回范围无效');
  const results=[];
  const selected=this.store().filter(r=>r.sessionId===this.sessionId&&!r.released&&(requestIds===undefined||requestIds.includes(r.requestId)));
  // Resolve delayed creation receipts before this cleanup changes any lists.
  for(const r of selected)if(!terminal.has(r.status)&&r.steps?.length)await this.confirm(r,{cleanup:true,allowRunning});
  for(const r of selected){
   if(r.released)continue;
   if(r.status==='prepared'&&r.steps?.length===0){r.status='rejected';r.released=true;r.reservation={};r.termination={reason:'not_submitted',confirmed:true};await this.save();results.push({requestId:r.requestId,status:'removed'});continue;}
   if(r.status==='old_order_removed_new_unconfirmed'&&!r.steps.some(s=>s.params.cancel===false)){
    r.released=true;r.reservation={};await this.save();results.push({requestId:r.requestId,status:'removed'});continue;
   }
   if(!r.ownedOrder){if(!terminal.has(r.status))results.push({requestId:r.requestId,status:'unknown'});continue;}
   try{
    const current=await this.snapshot({cleanup:true,allowRunning});let observed=current;
    const a=monthlyTradeAccounting(current.status,current.market,{countryId:current.countryId});
    if(!a.ordersKnown)throw Error('停止时订单覆盖未知');
    const actual=a.observedOrders.find(o=>o.order_id===r.ownedOrder.order_id);
    if(actual&&!matches(actual,r.ownedOrder))throw Error('订单内容已改变，拒绝按旧ID撤销');
    if(actual){
     if(r.cleanupIntent?.status==='issued')throw Error('月度撤销在途未确认，只核对，不重复派发');
     if(this.store().some(other=>other!==r&&other.sessionId===this.sessionId&&!other.released&&other.change?.operation==='cancel'&&other.change.orderId===actual.order_id&&!terminal.has(other.status)&&other.steps?.some(step=>step.params.cancel===true)))throw Error('已有明确撤销仍在途，仅核对，不由停止清理重复派发');
     r.cleanupIntent={orderId:actual.order_id,status:'issued',reason};await this.save();
     let receipt;
     try{receipt=await this.rpc('set_monthly_trade',{cancel:true,order_id:actual.order_id});}
     catch(error){if(error.nativeWriteAttempted===false||error.rejected===true){r.cleanupIntent.status='not_sent';r.cleanupIntent.nativeWriteAttempted=error.nativeWriteAttempted!==false;await this.save();}throw error;}
     if(receipt?.success===false){r.cleanupIntent.status='not_sent';r.cleanupIntent.nativeWriteAttempted=true;await this.save();throw Error(receipt.message||'原生桥明确拒绝月度撤销');}
     let confirmed=false;
     for(let attempt=0;attempt<3;attempt++){
      observed=await this.snapshot({cleanup:true,allowRunning});
      const check=monthlyTradeAccounting(observed.status,observed.market,{countryId:observed.countryId});
      if(check.ordersKnown&&!check.observedOrders.some(o=>o.order_id===actual.order_id)){confirmed=true;break;}
      if(attempt<2)await delay(50);
     }
     if(!confirmed)throw Error('月度撤销尚未回读确认');
    }
    r.released=true;r.reservation={};r.lastCleanupScope=observed.scope;r.cleanupCountryId=observed.countryId;
    r.cleanupWitnessedRequests=this.store().filter(p=>p!==r&&p.sessionId===this.sessionId&&!p.released&&!terminal.has(p.status)&&p.steps?.length&&typeof p.sourceFingerprint==='string').map(p=>({sessionId:p.sessionId,requestId:p.requestId,sourceFingerprint:p.sourceFingerprint}));
    r.termination={reason,gameDate:observed.scope.gameDate,confirmed:true};delete r.cleanupError;if(r.cleanupIntent)r.cleanupIntent.status='confirmed';await this.save();results.push({requestId:r.requestId,status:'removed'});
   }catch(error){r.cleanupError=error.message;await this.save();results.push({requestId:r.requestId,status:'unknown',error:error.message});}
  }
  // A delayed creation can become visible while another owned order is being
  // removed. One bounded extra read/cleanup pass uses the durable witnesses;
  // it never re-posts the original creation or an in-flight cancellation.
  const late=selected.filter(r=>!r.released&&!r.ownedOrder&&!terminal.has(r.status)&&r.steps?.some(s=>s.params.cancel===false));
  if(lateReadback&&late.length&&results.some(r=>r.status==='removed')){
   const followup=await this.cleanup({requestIds:late.map(r=>r.requestId),allowRunning,reason,lateReadback:false});
   for(const next of followup.orders){const index=results.findIndex(r=>r.requestId===next.requestId);if(index>=0)results[index]=next;else results.push(next);}
  }
  return {confirmed:results.every(r=>r.status==='removed'),orders:results};
 }
 owns(orderId){return this.store().some(r=>r.sessionId===this.sessionId&&!r.released&&r.ownedOrder?.order_id===orderId);}
 view(){
  const records=this.store().filter(r=>r.sessionId===this.sessionId),active=records.filter(r=>!r.released);
  const uncertain=r=>!r.released&&(!terminal.has(r.status)||pendingCleanup(r)||r.ownership?.known===false);
  const priority=r=>uncertain(r)?0:!r.released&&r.ownedOrder?1:2;
  const visible=records.map((r,index)=>({r,index})).sort((a,b)=>priority(a.r)-priority(b.r)||b.index-a.index).slice(0,8).map(x=>x.r);
  return {scope:'session_order_records',sessionId:this.sessionId,lifecyclePilotEnabled:this.allowLifecyclePolicies,settlementConfirmed:false,recordCount:records.length,detailsTruncated:records.length>visible.length,detailOrder:'unresolved_then_owned_then_recent',counts:{registered:active.filter(r=>['order_registered','order_replaced'].includes(r.status)&&!pendingCleanup(r)&&r.ownership?.known!==false).length,uncertain:active.filter(uncertain).length,conditional:active.filter(r=>r.policy).length,policyCompleted:records.filter(r=>r.termination?.reason==='policy_complete'&&r.termination.confirmed).length},records:visible.map(r=>({sessionId:r.sessionId,requestId:r.requestId,status:operationalStatus(r),orderId:r.orderId,released:r.released===true,reservation:r.reservation,policy:r.policy??null,termination:r.termination,observedDate:r.lastCleanupScope?.gameDate??r.ownership?.gameDate??r.after?.scope?.gameDate??r.before?.scope?.gameDate}))};
 }
}
