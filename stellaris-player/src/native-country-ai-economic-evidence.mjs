const handle=x=>Number.isSafeInteger(x)&&x>=0&&x<0xffffffff;
const raw=x=>{
 if(typeof x!=='string'||! /^-?[0-9]{1,19}$/.test(x))return null;
 try{const n=BigInt(x);return n>=-(1n<<63n)&&n<(1n<<63n)?n:null;}catch{return null;}
};
// Validate native effects; never choose jobs, amounts or colony specializations.
export function nativeEconomicWitnesses(events,ownCountry){
 if(!handle(ownCountry))throw Error('经济证据需要有效本国完整ID');
 const resolved=new Set(events.filter(e=>e.stage==='native_command_resolved'&&Number.isSafeInteger(e.tracking_id)&&e.tracking_id>=0).map(e=>e.tracking_id));
 const entered=new Map(),witnesses=[];
 for(const event of events){
  if(!Number.isSafeInteger(event.tracking_id)||event.tracking_id<0||!Number.isSafeInteger(event.instance_address)||event.instance_address<0x10000)continue;
  const key=event.tracking_id+':'+event.instance_address;
  if(event.stage==='native_execute_entered'){entered.set(key,event);continue;}
  if(event.stage!=='native_execute_returned'||!resolved.has(event.tracking_id)||event.payload_country_id!==ownCountry)continue;
  const first=entered.get(key);entered.delete(key);
  const before=first?.effect_readback,after=event.effect_readback;
  if(!before?.known||!after?.known||first.payload_country_id!==ownCountry||first.domain!==event.domain||
    !handle(event.colony_reference)||before.colony_reference!==event.colony_reference||after.colony_reference!==event.colony_reference)continue;
  if(event.domain==='workforce'){
   if(!handle(event.job_reference)||before.job_reference!==event.job_reference||after.job_reference!==event.job_reference)continue;
   const desired=raw(event.desired_workforce_limit_raw),maximum=raw(before.max_workforce_raw),old=raw(before.workforce_limit_raw),actual=raw(after.workforce_limit_raw);
   if([desired,maximum,old,actual].includes(null)||maximum<0n)continue;
   const expected=desired<0n?0n:desired>maximum?maximum:desired;
   if(actual!==expected||old===actual)continue;
   witnesses.push({domain:'workforce',trackingId:event.tracking_id,colonyReference:event.colony_reference,jobReference:event.job_reference,
    beforeRaw:old.toString(),afterRaw:actual.toString()});
  }else if(event.domain==='colony_designation'){
   if(typeof event.designation_key!=='string'||!event.designation_key||after.designation_key!==event.designation_key||
    typeof before.designation_key!=='string'||before.designation_key===after.designation_key)continue;
   witnesses.push({domain:'colony_designation',trackingId:event.tracking_id,colonyReference:event.colony_reference,
    beforeKey:before.designation_key,afterKey:after.designation_key});
  }
 }
 return witnesses;
}

// Proves a new native shipyard queue item, never a completed ship or a local
// choice of design. Full queue/item refs and execution-boundary snapshots must
// agree; an old queue item, entry-only receipt, or unresolved Clone is excluded.
export function nativeShipProductionWitnesses(events,ownCountry){
 if(!handle(ownCountry))throw Error('生产证据需要有效本国完整ID');
 const resolved=new Set(events.filter(e=>e.stage==='native_command_resolved'&&Number.isSafeInteger(e.tracking_id)).map(e=>e.tracking_id));
 const entered=new Map(),witnesses=[];
 const queueValid=(effect,queue)=>effect?.known===true&&effect.owner_id===ownCountry&&effect.queue_id===queue&&
  Array.isArray(effect.items)&&effect.items.length<=200&&effect.items.every(i=>handle(i.item_id)&&i.queue_id===queue)&&
  new Set(effect.items.map(i=>i.item_id)).size===effect.items.length;
 for(const event of events){
  if(event.domain!=='ship_production'||event.payload_country_id!==ownCountry||
   !Number.isSafeInteger(event.tracking_id)||event.tracking_id<0||
   !Number.isSafeInteger(event.instance_address)||event.instance_address<0x10000)continue;
  const key=event.tracking_id+':'+event.instance_address;
  if(event.stage==='native_execute_entered'){entered.set(key,event);continue;}
  if(event.stage!=='native_execute_returned')continue;
  const first=entered.get(key);entered.delete(key);
  if(!resolved.has(event.tracking_id)||!first||!handle(event.queue_id)||!handle(event.design_reference)||
   !handle(event.starbase_reference)||!['ship','colony_ship'].includes(event.buildable_kind)||
   event.orbitable_type!==2||event.orbitable_has_extra!==false||
   ['queue_id','design_reference','starbase_reference','buildable_kind'].some(k=>first[k]!==event[k])||
   !queueValid(first.effect_readback,event.queue_id)||!queueValid(event.effect_readback,event.queue_id))continue;
  const oldIds=new Set(first.effect_readback.items.map(i=>i.item_id));
  const additions=event.effect_readback.items.filter(i=>!oldIds.has(i.item_id));
  if(additions.length!==1)continue;
  const item=additions[0];
  if(item.paying_country!==ownCountry||item.buildable_kind!==event.buildable_kind||item.design_reference!==event.design_reference||
   item.starbase_reference!==event.starbase_reference||item.orbitable_type!==2||item.orbitable_has_extra!==false)continue;
  witnesses.push({domain:'ship_production',stage:'queued',trackingId:event.tracking_id,queueId:event.queue_id,
   itemId:item.item_id,designReference:event.design_reference,starbaseReference:event.starbase_reference,buildableKind:event.buildable_kind});
 }
 return witnesses;
}
