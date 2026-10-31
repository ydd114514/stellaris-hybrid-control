import test from 'node:test';
import assert from 'node:assert/strict';
import {ColonyRoutine,validateColonyRoutine} from '../src/colony-routine.mjs';
const policy={planetId:0,goal:'补充住房缓冲',districtKey:'district_city',housingTarget:10,maxBuilds:2,budget:{minerals:250},reviewDays:30};
function fixture(){
 const records=[],writes=[];let stopped=false,saves=0;
 const s={date:'2200.01.01',status:{resources:{minerals:{stockpile:1000,net:10}}},native:{known:true,enabled:false,owner_id:0,colony_id:0,planet_id:0,queue:{known:true,queue_id:0,items:[]}},planet:{planet_id:0,colony_id:0,kpi:{housing:2},designation_key:'col_capital',construction_queue:[]},districts:{success:true,planet_id:0,colony_id:0,current:[{key:'district_city',built:0}],buildable:[{key:'district_city',can_build:true,cost:{minerals:100}}]}};
 const actor=new ColonyRoutine({store:()=>records,save:async()=>{saves++;},snapshot:async()=>structuredClone(s),sessionId:'s',assertActive:()=>{if(stopped)throw Error('stopped');},execute:async({record,action,order})=>{
  assert.ok(saves>1);assert.equal(record.remainingBudget.minerals,150);assert.equal(action.status,'issued');writes.push(order);
  s.native.queue.items=[{item_id:0}];s.planet.construction_queue=[{item_id:0,key:'district_city'}];return {status:'posted'};
 }});
 return {actor,records,writes,s,stop:()=>stopped=true};
}
test('local housing delegation submits an ordinary order once and confirms full queue ID zero',async()=>{
 const f=fixture();await f.actor.delegate(policy);await f.actor.advance();
 assert.equal(f.writes.length,1);assert.equal(f.records[0].actions[0].status,'queued');assert.equal(f.records[0].actions[0].queueItemId,0);
 assert.equal(f.records[0].remainingBudget.minerals,150);await f.actor.advance({force:true});assert.equal(f.writes.length,1);
 assert.throws(()=>f.actor.assertManual(f.writes[0]),/先colony_control reclaim/);
 assert.doesNotThrow(()=>f.actor.assertManual({command:'select_research',arguments:{slot:'physics'}}));
});
test('read-only completion reconciliation never dispatches the next budgeted construction',async()=>{
 const f=fixture();await f.actor.delegate(policy);await f.actor.advance({force:true});
 f.s.native.queue.items=[];f.s.planet.construction_queue=[];f.s.districts.current[0].built=1;f.s.date='2200.03.01';
 await f.actor.advance({force:true,reconcileOnly:true});
 assert.equal(f.records[0].actions[0].status,'completed');assert.equal(f.records[0].status,'active');assert.equal(f.writes.length,1);assert.equal(f.records[0].remainingBudget.minerals,150);
 await f.actor.advance({force:true,reconcileOnly:true});assert.equal(f.writes.length,1);
});
test('housing target, existing queue and review interval prevent repetitive construction',async()=>{
 const f=fixture();f.s.planet.kpi.housing=11;await f.actor.delegate(policy);await f.actor.advance();assert.equal(f.writes.length,0);
 f.s.planet.kpi.housing=2;await f.actor.advance();assert.equal(f.writes.length,0);
 f.s.date='2200.02.01';f.s.planet.construction_queue=[{key:'another',item_id:2}];f.s.native.queue.items=[{item_id:2}];await f.actor.advance();assert.equal(f.writes.length,0);
});
test('unknown ownership, enabled native AI and unknown costs fail before delegation',async()=>{
 for(const change of [f=>f.s.native.known=false,f=>f.s.native.enabled=true,f=>f.s.districts.buildable[0].cost={},f=>f.s.status.resources.minerals.net=undefined]){
  const f=fixture();change(f);await assert.rejects(f.actor.delegate(policy));assert.equal(f.writes.length,0);
 }
});
test('price changes, strategy change and stock shortage block before writes',async()=>{
 for(const change of [f=>f.s.districts.buildable[0].cost.minerals=300,f=>f.s.planet.designation_key='col_mining',f=>f.s.status.resources.minerals.stockpile=1]){
  const f=fixture();await f.actor.delegate(policy);change(f);await f.actor.advance();assert.equal(f.records[0].status,'blocked');assert.equal(f.writes.length,0);
 }
});
test('completion is observed before another action and the count limit closes the routine',async()=>{
 const f=fixture();await f.actor.delegate({...policy,maxBuilds:1});await f.actor.advance();
 f.s.native.queue.items=[];f.s.planet.construction_queue=[];f.s.districts.current[0].built=1;
 await f.actor.advance({force:true});assert.equal(f.records[0].status,'completed');assert.equal(f.writes.length,1);
});
test('reclaim and stop release control while preserving queued construction',async()=>{
 const f=fixture();await f.actor.delegate(policy);await f.actor.advance();await f.actor.reclaim(0,{stop:true});
 f.stop();assert.equal(f.records[0].status,'stopped');assert.equal(f.s.planet.construction_queue.length,1);
 assert.doesNotThrow(()=>f.actor.assertManual(f.writes[0]));assert.equal(f.actor.view().queuedWorkCancelled,false);
});
test('one colony only; unknown in-flight outcomes are queried and never blindly replayed',async()=>{
 const f=fixture();await f.actor.delegate(policy);await assert.rejects(f.actor.delegate(policy),/一颗/);await f.actor.advance();
 f.s.native.queue.items=[];f.s.planet.construction_queue=[];await f.actor.advance({force:true});await f.actor.advance({force:true});assert.equal(f.writes.length,1);assert.equal(f.records[0].status,'blocked');
});
test('bounded policy rejects foreign categories, missing limits, extra fields and invalid IDs',()=>{
 for(const p of [{...policy,planetId:-1},{...policy,maxBuilds:10},{...policy,budget:{}},{...policy,districtKey:'district_farming'},{...policy,allPlanets:true},{...policy,reviewDays:1}])assert.throws(()=>validateColonyRoutine(p));
 assert.equal(validateColonyRoutine(policy).planetId,0);
});
test('scheduled polling is bounded to five seconds; completion still closes without another command',async()=>{
 const f=fixture();let clock=1,reads=0;f.actor.now=()=>clock;f.actor.snapshot=async()=>{reads++;return structuredClone(f.s);};
 await f.actor.delegate({...policy,maxBuilds:1});await f.actor.advance();const first=reads;
 f.s.native.queue.items=[];f.s.planet.construction_queue=[];f.s.districts.current[0].built=1;
 clock=4000;await f.actor.advance();assert.equal(reads,first);assert.equal(f.records[0].status,'waiting');
 clock=5001;await f.actor.advance();assert.ok(reads>first);assert.equal(f.records[0].status,'completed');assert.equal(f.writes.length,1);
});
test('two routine construction cycles debit the original budget once each and stop at the action limit',async()=>{
 const f=fixture();let serial=0;
 f.actor.execute=async()=>{f.writes.push('build');f.s.native.queue.items=[{item_id:serial}];f.s.planet.construction_queue=[{item_id:serial++,key:'district_city'}];return {status:'posted'};};
 await f.actor.delegate(policy);await f.actor.advance({force:true});
 assert.equal(f.records[0].remainingBudget.minerals,150);
 f.s.date='2200.02.01';f.s.native.queue.items=[];f.s.planet.construction_queue=[];f.s.districts.current[0].built=1;f.s.planet.kpi.housing=3;
 await f.actor.advance({force:true});assert.equal(f.records[0].remainingBudget.minerals,50);assert.equal(f.writes.length,2);
 f.s.date='2200.03.01';f.s.native.queue.items=[];f.s.planet.construction_queue=[];f.s.districts.current[0].built=2;
 await f.actor.advance({force:true});assert.equal(f.records[0].status,'completed');assert.equal(f.writes.length,2);
});
test('pause and same-session resume preserve remaining budget and original queue identity',async()=>{
 const f=fixture();await f.actor.delegate(policy);await f.actor.advance({force:true});await f.actor.pause(0);
 assert.equal(f.records[0].status,'paused');assert.equal(f.records[0].remainingBudget.minerals,150);
 await f.actor.advance({force:true});assert.equal(f.writes.length,1);assert.throws(()=>f.actor.assertManual(f.writes[0]),/reclaim/);
 await f.actor.resume(0);assert.equal(f.records[0].status,'waiting');assert.equal(f.records[0].remainingBudget.minerals,150);assert.equal(f.records[0].actions.length,1);
 f.s.planet.construction_queue[0].item_id=9;f.s.native.queue.items[0].item_id=9;
 await f.actor.pause(0);await assert.rejects(f.actor.resume(0),/队列已变化/);assert.equal(f.records[0].status,'paused');assert.equal(f.writes.length,1);
});
test('explicitly local refusal releases budget but freezes automatic retry; ambiguous refusal retains its allowance',async()=>{
 for(const [receipt,remaining] of [[{status:'deferred',nativeWriteAttempted:false},250],[{status:'rejected'},150]]){
  const f=fixture();f.actor.execute=async()=>{f.writes.push('attempt');return receipt;};
  await f.actor.delegate(policy);await f.actor.advance({force:true});assert.equal(f.records[0].remainingBudget.minerals,remaining);assert.equal(f.records[0].reviewRequired,true);
  await f.actor.advance({force:true});assert.equal(f.writes.length,1);await f.actor.pause(0);await assert.rejects(f.actor.resume(0),/不能通过恢复绕过/);
 }
});
test('a replaced queue cannot be adopted as the previously confirmed owned construction',async()=>{
 const f=fixture();await f.actor.delegate(policy);await f.actor.advance({force:true});f.s.planet.construction_queue[0].item_id=9;f.s.native.queue.items[0].item_id=9;
 await f.actor.advance({force:true});assert.equal(f.records[0].status,'blocked');assert.equal(f.records[0].actions[0].queueItemId,0);assert.equal(f.writes.length,1);
});
test('resume may resolve a lost receipt from readback but cannot resend an unresolved action',async()=>{
 const f=fixture();f.actor.execute=async()=>{f.writes.push('attempt');return {status:'unconfirmed'};};
 await f.actor.delegate(policy);await f.actor.advance({force:true});await f.actor.pause(0);
 await assert.rejects(f.actor.resume(0),/队列已变化或消失/);assert.equal(f.writes.length,1);assert.equal(f.records[0].status,'paused');
 f.s.native.queue.items=[{item_id:7}];f.s.planet.construction_queue=[{item_id:7,key:'district_city'}];
 await f.actor.resume(0);assert.equal(f.records[0].status,'waiting');assert.equal(f.records[0].actions[0].queueItemId,7);assert.equal(f.records[0].remainingBudget.minerals,150);assert.equal(f.writes.length,1);
});
test('resume recognizes completion at the original action cap without demanding another budget',async()=>{
 const f=fixture();await f.actor.delegate({...policy,maxBuilds:1,budget:{minerals:100}});
 f.actor.execute=async()=>{f.writes.push('build');f.s.native.queue.items=[{item_id:1}];f.s.planet.construction_queue=[{item_id:1,key:'district_city'}];return {status:'posted'};};
 await f.actor.advance({force:true});await f.actor.pause(0);f.s.native.queue.items=[];f.s.planet.construction_queue=[];f.s.districts.current[0].built=1;
 await f.actor.resume(0);assert.equal(f.records[0].status,'completed');assert.equal(f.records[0].remainingBudget.minerals,0);assert.equal(f.writes.length,1);
});
test('decimal multi-cycle costs tolerate machine rounding without creating extra allowance',async()=>{
 const f=fixture();let next=0;f.s.districts.buildable[0].cost.minerals=0.1;
 f.actor.execute=async()=>{f.writes.push('build');f.s.native.queue.items=[{item_id:next}];f.s.planet.construction_queue=[{item_id:next++,key:'district_city'}];return {status:'posted'};};
 await f.actor.delegate({...policy,budget:{minerals:0.3}});await f.actor.advance({force:true});
 f.s.date='2200.02.01';f.s.native.queue.items=[];f.s.planet.construction_queue=[];f.s.districts.current[0].built=1;f.s.districts.buildable[0].cost.minerals=0.2;
 await f.actor.advance({force:true});assert.equal(f.writes.length,2);assert.equal(f.records[0].remainingBudget.minerals,0);
});

// New implementation-only regressions; not executed yet.
test('a definitely unsent construction never adopts a concurrent same-key queue after restoring its allowance',async()=>{
 const f=fixture();let reads=0;f.actor.snapshot=async()=>{reads++;return structuredClone(f.s);};
 f.actor.execute=async()=>{f.s.native.queue.items=[{item_id:77}];f.s.planet.construction_queue=[{item_id:77,key:'district_city'}];return {status:'deferred',nativeWriteAttempted:false};};
 await f.actor.delegate(policy);await f.actor.advance({force:true});assert.equal(reads,2);assert.equal(f.records[0].remainingBudget.minerals,250);assert.equal(f.records[0].actions[0].status,'rejected');assert.equal(f.records[0].actions[0].queueItemId,undefined);assert.equal(f.s.planet.construction_queue[0].item_id,77);
});
test('housing completion cannot be inferred when the native queue still contains unaccounted work',async()=>{
 const f=fixture();await f.actor.delegate(policy);await f.actor.advance({force:true});f.s.planet.construction_queue=[];f.s.districts.current[0].built=1;f.s.native.queue.items=[{item_id:99}];
 await f.actor.advance({force:true});assert.equal(f.records[0].status,'blocked');assert.equal(f.records[0].actions[0].status,'queued');assert.equal(f.writes.length,1);
});
test('failed prerequisite read blocks local dispatch with an explicit reason instead of leaving an active-looking routine',async()=>{
 const f=fixture();await f.actor.delegate(policy);f.actor.snapshot=async()=>{throw Error('current colony read failed');};await f.actor.advance({force:true});
 assert.equal(f.records[0].status,'blocked');assert.match(f.records[0].reason,/read failed/);assert.equal(f.records[0].actions.length,0);assert.equal(f.records[0].remainingBudget.minerals,250);
});

test('explicitly unknown stock or net flags reject delegation and block dispatch after an accepted policy',async()=>{
 for(const flag of ['stockpile_known','net_known']){
  const unknown=fixture();unknown.s.status.resources.minerals[flag]=false;await assert.rejects(unknown.actor.delegate(policy));assert.equal(unknown.writes.length,0);
  const changed=fixture();await changed.actor.delegate(policy);changed.s.status.resources.minerals[flag]=false;await changed.actor.advance({force:true});assert.equal(changed.writes.length,0);assert.equal(changed.records[0].status,'blocked');assert.equal(changed.records[0].remainingBudget.minerals,250);assert.equal(changed.records[0].actions.length,0);
 }
});
