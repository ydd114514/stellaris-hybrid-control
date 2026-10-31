import {surveyGameDay} from './survey-idle-policy.mjs';
const id=n=>Number.isInteger(n)&&n>=0&&n<0xffffffff;
// A saved intention, a monthly order or an arbitrary busy colony is not work proof.
export function localWaitTarget(records,sessionId){
 const active=records.filter(r=>r.sessionId===sessionId&&['active','waiting','blocked','paused'].includes(r.status));
 if(active.length!==1)return null;
 const r=active[0],pending=(r.actions||[]).filter(a=>['issued','unknown','queued'].includes(a.status));
 if(r.status!=='waiting'||r.reviewRequired||pending.length!==1||pending[0].status!=='queued'||!id(pending[0].queueItemId))return null;
 return {record:r,action:pending[0]};
}
export function localQueueWaitProof({record:r,action:a,native,planet,status,sessionId,commitments={},floors={}}){
 const fail=reason=>({trusted:false,reason});
 if(r.sessionId!==sessionId||r.status!=='waiting'||r.reviewRequired||a.status!=='queued')return fail('local_control_changed');
 const day=surveyGameDay(status?.date?.formatted),created=surveyGameDay(a.date??r.createdDate);
 if(day===null||created===null||day<created)return fail('local_date_unknown');
 if(native?.known!==true||native.enabled!==false||native.planet_id!==r.planetId||native.colony_id!==r.colonyId||native.owner_id!==r.ownerId||native.queue?.known!==true||native.queue.queue_id!==r.queueId||!Array.isArray(native.queue.items)||!native.queue.items.every(q=>id(q.item_id)))return fail('local_ownership_unknown');
 if(planet?.planet_id!==r.planetId||planet.colony_id!==r.colonyId||(planet.designation_key??null)!==r.designation||!Array.isArray(planet.construction_queue))return fail('local_colony_changed');
 const q=planet.construction_queue.find(q=>q.item_id===a.queueItemId);
 if(!q||!native.queue.items.some(q=>q.item_id===a.queueItemId))return fail('local_queue_changed');
 if(a.order?.command==='upgrade_building'){
  if(q.type!=='building_upgrade'||q.key!==a.order.arguments.upgrade_key||q.building_id!==a.order.arguments.building_id)return fail('local_queue_changed');
 }else if(q.key!==r.districtKey)return fail('local_queue_changed');
 for(const key of new Set([...Object.keys(a.cost||{}),...Object.keys(commitments),...Object.keys(floors)])){
  const row=status.resources?.[key],reserved=commitments[key]??0,floor=floors[key]??0;
  if(!Number.isFinite(row?.stockpile)||!Number.isFinite(row.net)||row.stockpile_known===false||row.net_known===false||![reserved,floor].every(n=>Number.isFinite(n)&&n>=0)||row.stockpile+Math.min(0,row.net)*3-reserved-floor<0)return fail('local_reserve_unknown_or_short');
 }
 return {trusted:true,reason:'confirmed_local_queue',planetId:r.planetId,queueItemId:a.queueItemId,gameDate:status.date.formatted};
}
