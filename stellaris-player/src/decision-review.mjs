import {researchChoices} from './candidate-feedback.mjs';
// A compact index into the just-returned observation, not new authority to act.
// Freshness, full session identity and actual engine child orders are required
// before suggesting that another routine inspection is unnecessary.
export function decisionReview(state,{sessionId,observedAt,now=Date.now()}={}){
 const age=now-observedAt,fresh=Number.isFinite(observedAt)&&age>=0&&age<=10000;
 const eventKnown=Array.isArray(state.pendingEvents);
 const reasons=Array.isArray(state.wakeReasons)?state.wakeReasons:[];
 const native=[];
 for(const r of Object.values(state.surveyControl?.records||{})){
  const a=r?.observation,age=now-r?.observedAt;
  if(typeof sessionId==='string'&&sessionId.length>0&&Number.isSafeInteger(r?.fleetId)&&r.fleetId>=0&&r.fleetId<0xffffffff&&r.sessionId===sessionId&&r.owner==='native'&&r.desired===true&&!r.pending&&r.enableUnconfirmed!==true&&
   Number.isFinite(r.observedAt)&&age>=0&&age<=10000&&a?.known===true&&a.order_chain_complete===true&&a.automation_enabled===true&&
   Array.isArray(a.orders)&&a.orders.some(x=>x.automation===false))native.push(r.fleetId);
 }
 const choices=fresh?researchChoices(state,{observedAt}):[];
 const rows=x=>Array.isArray(x)?x:[],current=r=>typeof sessionId==='string'&&r.sessionId===sessionId;
 const monthly=rows(state.monthlyControl?.records).filter(current).filter(r=>!r.released);
 const uncertainMonthly=monthly.filter(r=>['prepared','issued','unknown','old_order_removed_new_unconfirmed','cancellation_unconfirmed','cancellation_not_submitted','ownership_unconfirmed'].includes(r.status));
 const count=n=>Number.isInteger(n)&&n>=0?n:0;
 const monthlyUncertain=Math.max(count(state.monthlyControl?.sessionId===sessionId?state.monthlyControl.counts?.uncertain:0),uncertainMonthly.length);
 const oldMonthlyRecovery=count(state.monthlyControl?.recovery?.count);
 const colonies=[...rows(state.colonyControl?.records),...rows(state.colonyUpgradeControl?.records)].filter(current).filter(r=>['active','waiting','blocked','paused'].includes(r.status));
 const blockedColonies=colonies.filter(r=>r.status==='blocked'||r.reviewRequired===true);
 const evidence=state.localWorkWait,localAge=now-evidence?.observedAt;
 const localWorkObserved=fresh&&evidence?.enabled===true&&evidence.trusted===true&&evidence.sessionId===sessionId&&Number.isFinite(evidence.observedAt)&&localAge>=0&&localAge<=5000&&evidence.gameDate===state.date&&colonies.some(r=>r.planetId===evidence.planetId&&r.status==='waiting'&&!r.reviewRequired&&rows(r.actions).some(a=>a.status==='queued'&&a.queueItemId===evidence.queueItemId));
 const unresolvedDelegation=monthlyUncertain>0||oldMonthlyRecovery>0||blockedColonies.length>0;
 const routineOnly=choices.length===0&&reasons.every(x=>x==='scheduled_review')&&!state.decisionAttention&&!state.uncertain&&!state.terminal&&state.paused!==true&&!state.needsAttention&&!state.stopped&&!state.runtimeComplete&&!unresolvedDelegation;
 const nativeWorkObserved=fresh&&native.length>0;
 const workObserved=nativeWorkObserved||localWorkObserved;
 return {snapshotId:state.snapshotId,observedAt,fresh,eventCount:eventKnown?state.pendingEvents.length:null,
  nativeWorkingFleetIds:fresh?native:[],wakeReasons:reasons,
  localWorkObserved,
  delegationReview:{monthlyUncertain,oldMonthlyRecovery,blockedPlanets:blockedColonies.map(r=>r.planetId).slice(0,4),unresolvedMonthlyRequests:uncertainMonthly.slice(0,4).map(r=>({requestId:r.requestId,status:r.status,orderId:r.orderId})),observedOnly:true},
  researchChoices:choices,
  routineWaitSuggested:workObserved&&eventKnown&&state.pendingEvents.length===0&&!state.warGoalsWindow&&routineOnly,
  instruction:!fresh?'回读已过期或时间未知，先刷新；未知控制权仍须核对。':
   unresolvedDelegation?'存在未确认月度请求、旧会话收回或被阻断的托管；先按原requestId和控制记录核对，不重发、不把旧记录当新授权。':
   state.paused===true||state.needsAttention?'游戏已暂停或需要接管；先处理暂停原因，不把已有施工或原生订单当作自动恢复授权。':
   workObserved&&eventKnown&&state.pendingEvents.length===0&&routineOnly&&!state.warGoalsWindow?
   '本次回读已确认原生子任务或本地施工队列且无中央事件；无其他新决策时可按工具上限直接watch，不再为相同事实重复查询。watch仍会重新核对事件、资源、控制权和剩余授权时长。':
   '使用本次完整状态或delta中的已知事实处理实际变化；缺字段、unknown、过期或需要新候选时再查询。'};
}
