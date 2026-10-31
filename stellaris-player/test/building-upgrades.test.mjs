import test from 'node:test';
import assert from 'node:assert/strict';
import {buildingUpgradeProblem,verifyBuildingUpgrade,captureUpgradeBaseline,captureUpgradeQueueWitness} from '../src/building-upgrades.mjs';
const args={planet_id:0,building_id:33554432,upgrade_key:'building_capital_2'};
const snapshot=()=>({success:true,planet_id:0,colony_id:0,queue_id:0,candidates:[{building_id:33554432,zone_id:0,current_key:'building_capital',upgrade_key:'building_capital_2',can_upgrade:true,cost:{minerals:500},build_days:360}]});
test('upgrade candidates preserve zero IDs and bind planet, full building ID and real upgrade path',()=>{
  assert.equal(buildingUpgradeProblem(snapshot(),args),null);
  assert.match(buildingUpgradeProblem(snapshot(),{...args,planet_id:1}),/不可用/);
  assert.match(buildingUpgradeProblem(snapshot(),{...args,building_id:0}),/升级路径/);
  assert.match(buildingUpgradeProblem(snapshot(),{...args,upgrade_key:'invented'}),/升级路径/);
  const s=snapshot();s.candidates[0].can_upgrade=false;s.candidates[0].reason='需要人口';assert.match(buildingUpgradeProblem(s,args),/需要人口/);
  s.candidates=[];assert.match(buildingUpgradeProblem(s,args),/升级路径/);
});

test('engine replacement requires original slot, exclusive witnessed queue and unchanged neighboring instances',()=>{
 const source={planet_id:0,colony_id:0,construction_queue:[],districts:[{zones:[{slot_index:0,buildings_known:true,buildings:[{id:args.building_id,key:'building_capital',slot_index:0,status:'built'},{id:2,key:'building_other',slot_index:1,status:'built'}]}]}]};
 const native={known:true,enabled:false,planet_id:0,colony_id:0,owner_id:0,queue:{known:true,queue_id:0,items:[]}};
 const baseline=captureUpgradeBaseline(source,args,native);assert.ok(baseline);
 const queued=structuredClone(source);queued.construction_queue=[{item_id:0,type:'building_upgrade',building_id:args.building_id,key:args.upgrade_key}];
 const busy=structuredClone(native);busy.queue.items=[{item_id:0}];const queueWitness=captureUpgradeQueueWitness(baseline,args,queued,busy);assert.ok(queueWitness);
 const after=structuredClone(source);after.districts[0].zones[0].buildings[0]={id:41,key:args.upgrade_key,slot_index:0,status:'built'};
 const context={baseline,queueWitness,native};const proof=verifyBuildingUpgrade(after,args,{},context);assert.equal(proof.completed,true);assert.equal(proof.originalBuildingId,args.building_id);assert.equal(proof.building.id,41);
 assert.equal(verifyBuildingUpgrade(after,args).completed,false);
 for(const change of [
  f=>f.context.queueWitness=null,
  f=>f.context.queueWitness.sourceId=4,
  f=>f.context.native.enabled=true,
  f=>f.context.native.queue.items=[{item_id:8}],
  f=>f.after.districts[0].zones[0].slot_index=1,
  f=>f.after.districts[0].zones[0].buildings[0].slot_index=3,
  f=>f.after.districts[0].zones[0].buildings[1].id=9,
  f=>f.after.districts[0].zones[0].buildings.push({id:args.building_id,key:'building_capital',slot_index:4,status:'built'})
 ]){const f={after:structuredClone(after),context:structuredClone(context)};change(f);assert.equal(verifyBuildingUpgrade(f.after,args,{},f.context).completed,false);}
});
test('queue proof requires matching upgrade identity, never the same name alone or queue ID as item ID',()=>{
  const planet={planet_id:0,construction_queue:[{item_id:0,type:'building_upgrade',building_id:33554432,key:args.upgrade_key}]};
  assert.equal(verifyBuildingUpgrade(planet,args).phase,'construction_queue');
  assert.equal(verifyBuildingUpgrade(planet,args).completed,false);
  planet.construction_queue[0].building_id=9;
  assert.equal(verifyBuildingUpgrade(planet,args,{queue_id:0}).verified,false);
  assert.equal(verifyBuildingUpgrade(planet,args,{queue_item_id:0}).verified,true);
  assert.equal(verifyBuildingUpgrade({...planet,planet_id:9},args,{queue_item_id:0}).verified,false);
});
test('the upgraded instance proves completion, an empty or incomplete building list does not',()=>{
  const planet={planet_id:0,districts:[{zones:[{buildings:[{id:33554432,key:args.upgrade_key,status:'built'}]}]}]};
  assert.equal(verifyBuildingUpgrade(planet,args).completed,true);
  planet.districts[0].zones[0].buildings=[];assert.equal(verifyBuildingUpgrade(planet,args).verified,false);
  assert.match(buildingUpgradeProblem({...snapshot(),queue_id:0xffffffff},args),/队列未知/);
});
