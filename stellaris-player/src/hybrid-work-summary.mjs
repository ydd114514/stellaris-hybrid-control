export function hybridWorkSummary(checkpoint,{actorActive=false}={}){
 const state=checkpoint?.state||{},current=r=>r&&typeof checkpoint?.sessionId==='string'&&r.sessionId===checkpoint.sessionId;
 const rows=x=>Array.isArray(x)?x:[];
 const monthly=rows(state.monthlyControl?.records).filter(current).filter(r=>r.released!==true);
 const allColonies=rows(state.colonyControl?.records).filter(current),allUpgrades=rows(state.colonyUpgradeControl?.records).filter(current);
 const colonies=allColonies.filter(r=>['active','waiting','blocked','paused'].includes(r.status));
 const upgrades=allUpgrades.filter(r=>['active','waiting','blocked','paused'].includes(r.status));
 const active=actorActive&&checkpoint?.stopped===false;
 const retained=records=>new Set(records.filter(r=>(!active||['stopped','reclaimed'].includes(r.status))&&r.actions?.some(a=>a.status==='queued')).map(r=>r.planetId).filter(n=>Number.isSafeInteger(n)&&n>=0&&n<0xffffffff)).size;
 const counts=state.monthlyControl?.sessionId===checkpoint?.sessionId?state.monthlyControl?.counts:null;
 const valid=n=>Number.isInteger(n)&&n>=0&&n<=256;
 const registered=valid(counts?.registered)?counts.registered:monthly.filter(r=>['order_registered','order_replaced'].includes(r.status)).length;
 const uncertain=valid(counts?.uncertain)?counts.uncertain:monthly.filter(r=>!['already_absent','already_present','order_removed','order_registered','order_replaced'].includes(r.status)).length;
 return {scope:'session_records',monthlyRegistered:active?registered:0,
  monthlyUncertain:uncertain+(!active?registered:0),
  monthlyRecoveryRequired:valid(state.monthlyControl?.recovery?.count)?state.monthlyControl.recovery.count:0,
  monthlyLifecyclePilotEnabled:state.monthlyControl?.lifecyclePilotEnabled===true,
  monthlyConditional:active&&valid(counts?.conditional)?counts.conditional:0,
  monthlyPolicyCompleted:valid(counts?.policyCompleted)?counts.policyCompleted:0,
  colonyRetainedQueues:retained(allColonies),upgradeRetainedQueues:retained(allUpgrades),
  localColonies:active?colonies.length:0,colonyPaused:active?colonies.filter(r=>r.status==='paused').length:0,colonyQueued:active?colonies.filter(r=>r.actions?.some(a=>a.status==='queued')).length:0,colonyBlocked:colonies.filter(r=>r.status==='blocked'||r.reviewRequired).length,
  upgradePilotEnabled:state.colonyUpgradeControl?.enabled===true,upgradeColonies:active?upgrades.length:0,upgradeQueued:active?upgrades.filter(r=>r.actions?.some(a=>a.status==='queued')).length:0,upgradeBlocked:upgrades.filter(r=>r.status==='blocked'||r.reviewRequired).length,stopped:!active};
}

export function campaignWorkSummary(checkpoint,{actorActive=false}={}){
 const c=checkpoint?.state?.gestalt?.campaign;
 if(!c||!['prepare','muster','declare','combat','peace','recover','completed','terminated'].includes(c.phase))return;
 const r=c.result,ids=r?.gainedPlanets,systems=r?.gainedSystems??[];
 const systemsKnown=Array.isArray(systems)&&systems.length<=64&&systems.every(n=>Number.isSafeInteger(n)&&n>=0&&n<0xffffffff)&&new Set(systems).size===systems.length;
 const gainKnown=systemsKnown&&r?.warEnded===true&&Array.isArray(ids)&&ids.length<=64&&ids.every(n=>Number.isSafeInteger(n)&&n>=0&&n<0xffffffff)&&new Set(ids).size===ids.length&&(r.success===true&&(ids.length>0||systems.length>0)||r.success===false&&ids.length===0&&systems.length===0);
 const evidence=Object.values(c.observedEvidence||{});
 return {phase:c.phase,active:actorActive&&checkpoint.stopped===false&&c.enabled===true&&!['completed','terminated'].includes(c.phase),
  goal:typeof c.reason==='string'?c.reason.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,200):'核对当前战役目标',
  battleObserved:evidence.some(x=>['fleet_combat','ground_combat'].includes(x?.kind)),occupationObserved:evidence.some(x=>['occupation','system_occupation'].includes(x?.kind)),
  gainKnown,gainedPlanets:gainKnown?ids.length:null,gainedSystems:gainKnown?systems.length:null,warEnded:r?.warEnded===true,nextReviewRequired:c.nextCampaignReview?.required===true,
  needsAttention:['blocked','review_required'].includes(c.status)&&typeof c.nextCheck==='string'?c.nextCheck.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,200):undefined};
}
