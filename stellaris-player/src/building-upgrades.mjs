const validId=x=>Number.isSafeInteger(x)&&x>=0&&x<0xffffffff;
const key=x=>typeof x==='string'&&/^[a-zA-Z0-9_]{1,100}$/.test(x);

export function captureUpgradeBaseline(planet,args,native){
  if(planet?.planet_id!==args.planet_id||native?.known!==true||native.enabled!==false||native.planet_id!==args.planet_id||planet.colony_id!==native.colony_id||!validId(native.owner_id)||!validId(native.queue?.queue_id)||native.queue.known!==true||native.queue.items?.length!==0||!Array.isArray(planet.construction_queue)||planet.construction_queue.length)return null;
  const zones=(planet.districts||[]).flatMap(d=>d.zones||[]),matches=zones.filter(z=>z.buildings?.some(b=>b.id===args.building_id));
  if(matches.length!==1)return null;const zone=matches[0],zoneId=zone.zone_id??zone.slot_index;
  if(!validId(zoneId)||zone.buildings_known!==true||zone.buildings.length>256||!zone.buildings.every(b=>validId(b.id)&&validId(b.slot_index)&&key(b.key)&&b.status==='built'))return null;
  const source=zone.buildings.find(b=>b.id===args.building_id);
  return {planetId:planet.planet_id,colonyId:planet.colony_id,ownerId:native.owner_id,queueId:native.queue.queue_id,zoneId,sourceId:source.id,sourceKey:source.key,sourceSlot:source.slot_index,members:zone.buildings.map(b=>({id:b.id,key:b.key,slot:b.slot_index}))};
}

export function captureUpgradeQueueWitness(baseline,args,planet,native){
  if(!baseline||planet?.planet_id!==baseline.planetId||planet.colony_id!==baseline.colonyId||native?.known!==true||native.enabled!==false||native.owner_id!==baseline.ownerId||native.colony_id!==baseline.colonyId||native.queue?.known!==true||native.queue.queue_id!==baseline.queueId||native.queue.items?.length!==1||planet.construction_queue?.length!==1)return null;
  const q=planet.construction_queue[0];
  if(q.type!=='building_upgrade'||q.building_id!==args.building_id||q.key!==args.upgrade_key||!validId(q.item_id)||native.queue.items[0].item_id!==q.item_id)return null;
  return {queueItemId:q.item_id,planetId:baseline.planetId,colonyId:baseline.colonyId,queueId:baseline.queueId,sourceId:args.building_id,upgradeKey:args.upgrade_key,exclusive:true};
}

// A live engine upgrade path, not a static capital-name map, is the authority.
export function buildingUpgradeProblem(snapshot,args) {
  if(!validId(args?.planet_id)||!validId(args?.building_id)||!key(args?.upgrade_key))return '建筑升级需要当前真实星球、完整建筑ID和升级目标key';
  if(snapshot?.success!==true||snapshot.planet_id!==args.planet_id||!Array.isArray(snapshot.candidates))return '当前建筑升级候选不可用，请重新 inspect upgrades；不能猜升级路径';
  if(!validId(snapshot.colony_id)||!validId(snapshot.queue_id))return '当前殖民地或地表建造队列未知，不能提交升级';
  const matches=snapshot.candidates.filter(x=>x.building_id===args.building_id&&x.upgrade_key===args.upgrade_key);
  if(matches.length!==1)return '目标不是此星球这座建筑的唯一当前升级路径，请重新 inspect upgrades';
  const candidate=matches[0];
  if(candidate.can_upgrade!==true)return `当前建筑不能升级：${typeof candidate.reason==='string'?candidate.reason.slice(0,200):'引擎前提未满足'}`;
  if(!validId(candidate.zone_id)||!key(candidate.current_key))return '升级建筑所属特区或当前类型未确认，先重新查询';
  return null;
}

export function verifyBuildingUpgrade(planet,args,response={},context={}) {
  if(planet?.planet_id!==args.planet_id)return {verified:false,phase:'upgrade_pending_observation',completed:false};
  const zones=(planet.districts||[]).flatMap(x=>x.zones||[]);
  const building=zones.flatMap(x=>x.buildings||[]).find(x=>x.id===args.building_id&&x.key===args.upgrade_key&&x.status==='built');
  if(building)return {verified:true,phase:'upgrade_completed',completed:true,building:{id:building.id,key:building.key}};
  const {baseline:b,queueWitness:w,native:n}=context;
  if(b&&w?.exclusive===true&&w.planetId===args.planet_id&&w.colonyId===b.colonyId&&w.queueId===b.queueId&&w.sourceId===args.building_id&&w.upgradeKey===args.upgrade_key&&validId(w.queueItemId)&&b.sourceId===args.building_id&&b.planetId===args.planet_id&&planet.colony_id===b.colonyId&&n?.known===true&&n.enabled===false&&n.planet_id===b.planetId&&n.colony_id===b.colonyId&&n.owner_id===b.ownerId&&n.queue?.known===true&&n.queue.queue_id===b.queueId&&n.queue.items?.length===0&&Array.isArray(planet.construction_queue)&&planet.construction_queue.length===0&&!zones.some(z=>z.buildings?.some(x=>x.id===args.building_id))){
    const z=zones.find(z=>(z.zone_id??z.slot_index)===b.zoneId),members=z?.buildings;
    const replacement=z?.buildings_known===true&&Array.isArray(members)&&members.length===b.members.length&&members.find(x=>x.slot_index===b.sourceSlot&&x.key===args.upgrade_key&&x.status==='built'&&validId(x.id)&&!b.members.some(old=>old.id===x.id));
    if(replacement&&b.members.filter(old=>old.id!==b.sourceId).every(old=>members.some(x=>x.id===old.id&&x.key===old.key&&x.slot_index===old.slot&&x.status==='built')))return {verified:true,phase:'upgrade_completed_replacement',completed:true,building:{id:replacement.id,key:replacement.key},originalBuildingId:b.sourceId,queueItemId:w.queueItemId,basis:'confirmed_exclusive_upgrade_queue_and_unchanged_zone_membership',atomicObservation:false};
  }
  const entries=Array.isArray(planet.construction_queue)?planet.construction_queue:[];
  const entry=entries.find(x=>x.key===args.upgrade_key&&(
    x.type==='building_upgrade'&&x.building_id===args.building_id||
    validId(response.queue_item_id)&&x.item_id===response.queue_item_id));
  return {verified:!!entry,phase:entry?'construction_queue':'upgrade_pending_observation',completed:false,entry};
}
