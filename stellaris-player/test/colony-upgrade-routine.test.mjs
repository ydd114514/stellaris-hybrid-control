// Written during implementation-only work. Run in the next unified acceptance.
import test from 'node:test';import assert from 'node:assert/strict';
import {ColonyUpgradeRoutine,validateColonyUpgradePolicy} from '../src/colony-upgrade-routine.mjs';
const policy={planetId:0,goal:'在预算内升级已批准的科研设施',allowedUpgradeKeys:['building_lab_2'],maxBuilds:1,budget:{minerals:250},reviewDays:30};
function fixture(){
 const records=[],writes=[];let stopped=false;
 const s={date:'2200.01.01',status:{resources:{minerals:{stockpile:1000,net:10}}},native:{known:true,enabled:false,owner_id:0,colony_id:0,planet_id:0,queue:{known:true,queue_id:0,items:[]}},planet:{planet_id:0,colony_id:0,designation_key:'col_research',construction_queue:[],districts:[{zones:[{buildings:[{id:0,key:'building_lab_1',status:'built'}]}]}]},upgrades:{success:true,planet_id:0,colony_id:0,queue_id:0,candidates:[{building_id:0,zone_id:0,current_key:'building_lab_1',upgrade_key:'building_lab_2',can_upgrade:true,cost:{minerals:100}}]}};
 const actor=new ColonyUpgradeRoutine({store:()=>records,save:async()=>{},snapshot:async()=>structuredClone(s),sessionId:'s',assertActive:()=>{if(stopped)throw Error('stopped');},execute:async({order})=>{writes.push(order);s.planet.construction_queue=[{item_id:0,type:'building_upgrade',building_id:0,key:'building_lab_2'}];s.native.queue.items=[{item_id:0}];return {status:'posted'};}});
 return {actor,records,writes,s,stop:()=>stopped=true};
}
test('approved engine upgrade path posts once and confirms queue identity zero',async()=>{
 const f=fixture();await f.actor.delegate(policy);await f.actor.advance({force:true});
 assert.equal(f.writes.length,1);assert.deepEqual(f.writes[0].arguments,{planet_id:0,building_id:0,upgrade_key:'building_lab_2'});assert.equal(f.records[0].actions[0].status,'queued');assert.equal(f.records[0].actions[0].queueItemId,0);assert.equal(f.records[0].remainingBudget.minerals,150);
 await f.actor.advance({force:true});assert.equal(f.writes.length,1);
});
test('a real-style upgraded replacement ID closes the original witnessed action without another dispatch',async()=>{
 const f=fixture(),zone=f.s.planet.districts[0].zones[0];zone.slot_index=0;zone.buildings_known=true;zone.buildings[0].slot_index=0;
 await f.actor.delegate(policy);await f.actor.advance({force:true});assert.ok(f.records[0].actions[0].queueWitness);
 zone.buildings[0]={id:41,key:'building_lab_2',slot_index:0,status:'built'};f.s.planet.construction_queue=[];f.s.native.queue.items=[];
 await f.actor.advance({force:true,reconcileOnly:true});assert.equal(f.records[0].status,'completed');assert.equal(f.records[0].actions[0].proof.building.id,41);assert.equal(f.writes.length,1);
});
test('read-only upgrade reconciliation completes the original instance without dispatching another upgrade',async()=>{
 const f=fixture();await f.actor.delegate({...policy,maxBuilds:2});await f.actor.advance({force:true});
 f.s.planet.construction_queue=[];f.s.native.queue.items=[];f.s.planet.districts[0].zones[0].buildings[0].key='building_lab_2';
 await f.actor.advance({force:true,reconcileOnly:true});assert.equal(f.records[0].actions[0].status,'completed');assert.equal(f.records[0].status,'active');assert.equal(f.writes.length,1);assert.equal(f.records[0].remainingBudget.minerals,150);
});
test('actual upgraded instance proves completion; another building with the same key does not',async()=>{
 const f=fixture();await f.actor.delegate(policy);await f.actor.advance({force:true});f.s.planet.construction_queue=[];f.s.native.queue.items=[];
 f.s.planet.districts[0].zones[0].buildings.push({id:1,key:'building_lab_2',status:'built'});await f.actor.advance({force:true});assert.equal(f.records[0].status,'blocked');
 f.s.planet.districts[0].zones[0].buildings[0].key='building_lab_2';await f.actor.advance({force:true});assert.equal(f.records[0].status,'completed');assert.equal(f.writes.length,1);
});
test('pause/resume retains allowance and queued construction; stop only releases dispatch ownership',async()=>{
 const f=fixture();await f.actor.delegate(policy);await f.actor.advance({force:true});await f.actor.pause(0);await f.actor.advance({force:true});assert.equal(f.writes.length,1);
 assert.throws(()=>f.actor.assertManual(f.writes[0]),/先收回/);await f.actor.resume(0);assert.equal(f.records[0].remainingBudget.minerals,150);
 await f.actor.reclaim(0,{stop:true});f.stop();assert.equal(f.s.planet.construction_queue.length,1);assert.equal(f.records[0].status,'stopped');assert.doesNotThrow(()=>f.actor.assertManual(f.writes[0]));
});
test('new target keys, changed owner/role, unknown cost and insufficient cash never produce upgrades',async()=>{
 const f=fixture();await assert.rejects(f.actor.delegate({...policy,allowedUpgradeKeys:['invented']}),/真实候选/);
 for(const change of [x=>x.s.native.owner_id=1,x=>x.s.planet.designation_key='col_mining',x=>x.s.upgrades.candidates[0].cost={},x=>x.s.status.resources.minerals.stockpile=1]){const x=fixture();await x.actor.delegate(policy);change(x);await x.actor.advance({force:true});assert.equal(x.writes.length,0);assert.equal(x.records[0].status,'blocked');}
});
test('replacement queue identity is not adopted and an unknown result is never replayed',async()=>{
 const f=fixture();await f.actor.delegate(policy);await f.actor.advance({force:true});f.s.planet.construction_queue[0].item_id=3;f.s.native.queue.items[0].item_id=3;
 await f.actor.advance({force:true});await f.actor.advance({force:true});assert.equal(f.records[0].status,'blocked');assert.equal(f.writes.length,1);
});
test('known local refusal restores only its own allowance and freezes automatic retries',async()=>{
 const f=fixture();f.actor.execute=async()=>{f.writes.push('attempt');return {status:'deferred',nativeWriteAttempted:false};};await f.actor.delegate(policy);await f.actor.advance({force:true});
 assert.equal(f.records[0].remainingBudget.minerals,250);assert.equal(f.records[0].reviewRequired,true);await f.actor.advance({force:true});assert.equal(f.writes.length,1);
});
test('unknown transport can be resolved by later actual queue observation, without a second write',async()=>{
 const f=fixture();f.actor.execute=async()=>{f.writes.push('attempt');return {status:'unknown'};};await f.actor.delegate(policy);await f.actor.advance({force:true});
 f.s.planet.construction_queue=[{item_id:2,type:'building_upgrade',building_id:0,key:'building_lab_2'}];f.s.native.queue.items=[{item_id:2}];await f.actor.advance({force:true});assert.equal(f.records[0].status,'waiting');assert.equal(f.writes.length,1);
});
test('policy rejects unbounded scope, duplicate keys and malformed limits',()=>{
 for(const p of [{...policy,allPlanets:true},{...policy,planetId:-1},{...policy,allowedUpgradeKeys:['building_lab_2','building_lab_2']},{...policy,maxBuilds:10},{...policy,budget:{}}])assert.throws(()=>validateColonyUpgradePolicy(p));
});
test('a definitely unsent upgrade cannot adopt a concurrent matching queue after returning its budget',async()=>{
 const f=fixture();let reads=0;f.actor.snapshot=async()=>{reads++;return structuredClone(f.s);};
 f.actor.execute=async()=>{f.s.planet.construction_queue=[{item_id:77,type:'building_upgrade',building_id:0,key:'building_lab_2'}];f.s.native.queue.items=[{item_id:77}];return {status:'deferred',nativeWriteAttempted:false};};
 await f.actor.delegate(policy);await f.actor.advance({force:true});assert.equal(reads,2);assert.equal(f.records[0].remainingBudget.minerals,250);assert.equal(f.records[0].actions[0].status,'rejected');assert.equal(f.records[0].actions[0].queueItemId,undefined);
});

test('explicitly unknown stock or net flags reject delegation and block dispatch after an accepted policy',async()=>{
 for(const flag of ['stockpile_known','net_known']){
  const unknown=fixture();unknown.s.status.resources.minerals[flag]=false;await assert.rejects(unknown.actor.delegate(policy));assert.equal(unknown.writes.length,0);
  const changed=fixture();await changed.actor.delegate(policy);changed.s.status.resources.minerals[flag]=false;await changed.actor.advance({force:true});assert.equal(changed.writes.length,0);assert.equal(changed.records[0].status,'blocked');assert.equal(changed.records[0].remainingBudget.minerals,250);assert.equal(changed.records[0].actions.length,0);
 }
});
