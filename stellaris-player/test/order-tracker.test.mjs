import test from 'node:test';
import assert from 'node:assert/strict';
import {OrderTracker,captureBaseline,makeOrderBaseline} from '../src/order-tracker.mjs';

const state=()=>({date:'2324.01.01',player:{country_id:0},colonies:[{colonies_summary:[]}],research:{},civilian:{construction_ships:[{fleet_id:2}]}});
const order=(command,args)=>({command,arguments:args});
function fixture(options={}) {
  let now=1000;const calls=[];
  const tracker=new OrderTracker({sessionId:'same-game',binding:{pid:42,creationTime:'same-process'},now:()=>now,...options});
  const submit=(o,extra={})=>tracker.register({requestId:'request-1',order:o,response:{success:true},beforeState:state(),...extra});
  const poll=async(result,s=state())=>tracker.poll({state:s,rpc:async(method,params)=>{calls.push({method,params});return typeof result==='function'?result(method,params):result;}});
  const advance=()=>{now+=60001;};
  return {tracker,calls,submit,poll,advance};
}

test('ordinary upgrade tracker binds replacement to the witnessed original slot and survives same-session restore',()=>{
 const f=fixture(),o=order('upgrade_building',{planet_id:3,building_id:0,upgrade_key:'building_major_capital'});
 const before={planet_id:3,colony_id:0,construction_queue:[],districts:[{zones:[{slot_index:0,buildings_known:true,buildings:[{id:0,key:'building_capital',slot_index:0,status:'built'},{id:2,key:'building_other',slot_index:1,status:'built'}]}]}]};
 const native={known:true,enabled:false,planet_id:3,colony_id:0,owner_id:0,queue:{known:true,queue_id:0,items:[]}};
 const baseline=makeOrderBaseline(o,{state:state(),planet:before,nativeColony:native});assert.ok(baseline.upgradeBaseline);
 const rowId=f.submit(o,{baseline}).id,row=f.tracker.records.get(rowId);
 const queued=structuredClone(before);queued.construction_queue=[{item_id:0,type:'building_upgrade',building_id:0,key:'building_major_capital'}];
 const busy=structuredClone(native);busy.queue.items=[{item_id:0}];
 f.tracker.applyRead(row,'get_planet_details',queued);f.tracker.applyRead(row,'get_colony_automation',busy);assert.ok(row.upgradeWitness);
 const restored=new OrderTracker({sessionId:'same-game',binding:{pid:42,creationTime:'same-process'},now:()=>1001});assert.equal(restored.restore(f.tracker.serialize(),{state:state()}).restored,1);
 const current=restored.records.get(rowId),after=structuredClone(before);after.districts[0].zones[0].buildings[0]={id:41,key:'building_major_capital',slot_index:0,status:'built'};
 restored.applyRead(current,'get_planet_details',after);assert.notEqual(current.status,'completed');
 restored.applyRead(current,'get_colony_automation',native);assert.equal(current.status,'completed');assert.equal(current.proof.buildingId,41);assert.equal(current.proof.originalBuildingId,0);
});

test('historical colony posted receipt stays unknown until an established own colony appears',()=>{
  const {tracker,submit}=fixture();
  // 2026-10-28 r63-colonize: accepted, but immediate read-back was unverified.
  const first=submit(order('colonize',{fleet_id:533,planet_id:215}),{response:{success:true,message:'Colonization order posted'},verification:{verified:false,phase:'posted_pending_observation'}});
  assert.equal(first.status,'submitted');
  const s=state();s.colonies[0].colonies_summary=[{planet_id:215,is_colonizing:true,status:'colonizing'}];tracker.updateState(s);
  assert.equal(tracker.view()[0].status,'executing');
  s.colonies[0].colonies_summary=[{planet_id:215,is_colonizing:false,status:'established',pops:10}];tracker.updateState(s);
  assert.equal(tracker.view()[0].status,'completed');assert.equal(tracker.view()[0].proof.kind,'colony_established');
});

test('historical building queue evidence is queued, never completed merely because the queue disappears',async()=>{
  const f=fixture(),o=order('build_building',{planet_id:298,building_key:'building_research_lab_1',district_type:'district_city',slot_index:16777325});
  f.submit(o,{verification:{verified:true,phase:'construction_queue',entry:{item_id:352321566,key:'building_research_lab_1',remaining_days:360}},baseline:{buildingKnown:true,buildingCount:2}});
  assert.equal(f.tracker.view()[0].status,'queued');
  f.advance();await f.poll({planet_id:298,construction_queue:[],districts:[]});
  assert.equal(f.tracker.view()[0].status,'queued');
  f.advance();await f.poll({planet_id:298,construction_queue:[],districts:[{zones:[{buildings:Array.from({length:3},(_,id)=>({id,key:'building_research_lab_1',status:'built'}))}]}]});
  assert.equal(f.tracker.view()[0].status,'completed');
});

test('conflicting incomplete building detail arrays cannot establish a zero-building baseline',async()=>{
  const o=order('build_building',{planet_id:298,building_key:'building_research_lab_1'});
  const b=makeOrderBaseline(o,{state:state(),planet:{districts:[{zones:[{slot_index:135,buildings:[]}]}]},buildingCandidates:{zones:[{zone_id:135,buildings:3}]}});
  assert.equal(b.buildingKnown,false);assert.equal(b.buildingCount,undefined);
  const f=fixture();f.submit(o,{baseline:b});f.advance();await f.poll({planet_id:298,construction_queue:[],districts:[{zones:[{buildings:[{key:'building_research_lab_1',status:'built'}]}]}]});
  assert.equal(f.tracker.view()[0].status,'submitted');
});

test('district completion needs a proven count increase and overlapping orders reserve distinct effects',async()=>{
  const f=fixture(),o=order('build_district',{planet_id:3,district_key:'district_city'});
  f.submit(o,{baseline:{districtCount:7}});f.submit(o,{requestId:'request-2',baseline:{districtCount:7}});
  f.advance();await f.poll({planet_id:3,districts:[{type:'district_city',built:8}],construction_queue:[]});
  assert.deepEqual(f.tracker.view().map(x=>x.status),['completed','submitted']);
  f.advance();await f.poll({planet_id:3,districts:[{type:'district_city',built:9}],construction_queue:[]});
  assert.deepEqual(f.tracker.view().map(x=>x.status),['completed','completed']);
});

test('baseline already includes a previous unpolled completion without double-reserving it',()=>{
  const f=fixture(),o=order('build_district',{planet_id:3,district_key:'district_city'});
  f.submit(o,{baseline:{districtCount:7}});
  f.submit(o,{requestId:'request-2',baseline:{districtCount:8}});
  assert.deepEqual(f.tracker.view().map(x=>x.expectedCount),[8,9]);
});

test('an upgrade finishes only when the original building entity has the requested new key',async()=>{
  const f=fixture(),o=order('upgrade_building',{planet_id:3,building_id:0,upgrade_key:'building_major_capital'});
  f.submit(o,{verification:{verified:true,phase:'construction_queue',entry:{item_id:111,key:'building_major_capital'}},baseline:{oldBuildingKey:'building_capital'}});
  f.advance();await f.poll({planet_id:3,construction_queue:[],districts:[{zones:[{buildings:[{id:0,key:'building_capital',status:'built'},{id:1,key:'building_major_capital',status:'built'}]}]}]});
  assert.equal(f.tracker.view()[0].status,'queued');
  f.advance();await f.poll({planet_id:3,construction_queue:[],districts:[{zones:[{buildings:[{id:0,key:'building_major_capital',status:'built'}]}]}]});
  assert.equal(f.tracker.view()[0].status,'completed');
});

test('queue item progress is execution, explicit cancellation is failure, missing queue is neither',async()=>{
  const f=fixture();f.submit(order('build_district',{planet_id:3,district_key:'district_city'}),{verification:{verified:true,phase:'construction_queue',entry:{item_id:7}}});
  f.advance();await f.poll({planet_id:3,construction_queue:[{item_id:7,progress_percent:50}]});assert.equal(f.tracker.view()[0].status,'executing');
  f.advance();await f.poll({planet_id:3,construction_queue:[]});assert.equal(f.tracker.view()[0].status,'executing');
  f.advance();await f.poll({planet_id:3,construction_queue:[{item_id:7,status:'cancelled'}]});assert.equal(f.tracker.view()[0].status,'failed');
});

test('idle fleet text is not arrival or survey completion; authoritative target facts are required',async()=>{
  const f=fixture();f.submit(order('move_fleet',{fleet_id:3,system_id:5}),{verification:{verified:true,phase:'fleet_order'}});
  f.advance();await f.poll({id:5,fleets:[{id:99,own:true,status:'无指令'}]});assert.equal(f.tracker.view()[0].status,'executing');
  f.advance();await f.poll({id:5,fleets:[{id:3,own:true,status:'无指令'}]});assert.equal(f.tracker.view()[0].status,'completed');
  f.submit(order('survey',{fleet_id:1,system_id:5}),{requestId:'survey'});
  f.advance();await f.poll({id:5,surveyed:false,fleets:[{id:1,own:true,status:'无指令'}]});assert.equal(f.tracker.view()[1].status,'submitted');
  f.advance();await f.poll({id:5,surveyed:true});assert.equal(f.tracker.view()[1].status,'completed');
});

test('outposts need actual own-system and starbase evidence, and read responses for another entity are ignored',async()=>{
  const f=fixture();f.submit(order('build_outpost',{fleet_id:2,system_id:31}),{baseline:{countryId:0}});
  f.advance();await f.poll({id:31,owner_id:0,starbase:null});assert.equal(f.tracker.view()[0].status,'submitted');
  f.advance();await f.poll({id:32,owner_id:0,starbase:{id:1}});assert.equal(f.tracker.view()[0].status,'submitted');
  f.advance();await f.poll({id:31,owner_id:0,starbase:{id:1}});assert.equal(f.tracker.view()[0].status,'completed');
});

test('new station effects do not prove the entire multi-station order completed',async()=>{
  const f=fixture();f.submit(order('build_stations',{fleet_id:2,system_id:31,station_type:'mining'}),{baseline:{stationIdsKnown:true,stationIds:[1]}});
  f.advance();await f.poll({id:31,fleets:[{id:1,own:true,ship_class:'shipclass_mining_station'},{id:2,own:true,ship_class:'shipclass_mining_station'}]});
  assert.equal(f.tracker.view()[0].status,'executing');assert.match(f.tracker.view()[0].reason,/尚无证据.*全部完工/);
});

test('reinforcement completion uses actual design counts from the submitted template, not idle or zero current deficit alone',async()=>{
  const f=fixture();f.submit(order('reinforce_fleet',{fleet_id:3}),{baseline:{fleetTargets:[{designId:4,count:10},{designId:5,count:2}]}});
  f.advance();await f.poll({fleets:[{fleet_id:3,can_reinforce:false,status:'无指令',designs:[{design_id:4,actual_count:10},{design_id:5,actual_count:1}]}]});assert.equal(f.tracker.view()[0].status,'submitted');
  f.advance();await f.poll({fleets:[{fleet_id:3,designs:[{design_id:4,actual_count:10},{design_id:5,actual_count:2}]}]});assert.equal(f.tracker.view()[0].status,'completed');
});

test('shipyard queue does not prove a ship exists, while observed new civilian vessels satisfy count goals',()=>{
  const f=fixture();f.submit(order('build_ship',{system_id:1,design_id:1852,count:2}),{baseline:{civilianClass:'construction_ships',civilianCount:1},verification:{verified:true,phase:'shipyard_queue',entry:{item_id:7}}});
  assert.equal(f.tracker.view()[0].status,'queued');
  const s=state();s.civilian.construction_ships=[{fleet_id:2},{fleet_id:3}];f.tracker.updateState(s);assert.equal(f.tracker.view()[0].status,'queued');
  s.civilian.construction_ships.push({fleet_id:4});f.tracker.updateState(s);assert.equal(f.tracker.view()[0].status,'completed');
});

test('research selection confirms selection, never the completion of the technology',()=>{
  const f=fixture();f.submit(order('select_research',{slot:'physics',tech_key:'tech_x'}));
  const s=state();s.research.physics={current:{key:'tech_other',is_researching:true}};f.tracker.updateState(s);assert.equal(f.tracker.view()[0].status,'submitted');
  s.research.physics.current.key='tech_x';f.tracker.updateState(s);
  assert.equal(f.tracker.view()[0].status,'completed');assert.equal(f.tracker.view()[0].proof.kind,'research_selection');assert.match(f.tracker.view()[0].reason,/不代表.*研发完成/);
});

test('diplomacy waits for an observed treaty; a consumed response is not treaty acceptance',async()=>{
  const f=fixture();f.submit(order('diplomacy',{country_id:5,action:'research_agreement'}),{verification:{verified:false,phase:'proposal_pending_acceptance'}});
  f.advance();await f.poll({empires:[{country_id:5,treaties:{research_agreement:false}}]});assert.equal(f.tracker.view()[0].status,'queued');
  f.advance();await f.poll({empires:[{country_id:5,treaties:{research_agreement:true}}]});assert.equal(f.tracker.view()[0].status,'completed');
  f.submit(order('respond_diplomacy',{proposal:'18446744073709551615',accept:true}),{requestId:'answer'});
  f.advance();await f.poll({pending:[]});assert.equal(f.tracker.view()[1].status,'completed');assert.match(f.tracker.view()[1].reason,/不代表.*接受/);
});

test('captureBaseline has a hard read budget and stores only limited factual fields',async()=>{
  const calls=[];const o=order('build_building',{planet_id:0,building_key:'lab'});
  const b=await captureBaseline(o,async(method,params)=>{calls.push({method,params});return method==='get_planet_details'?{planet_id:0,PRIVATE_SECRET:'never',districts:[{zones:[{slot_index:0,buildings:[{id:0,key:'lab'}]}]}]}:{zones:[{zone_id:0,buildings:1}]};},state());
  assert.equal(calls.length,2);assert.equal(b.buildingKnown,true);assert.equal(b.buildingCount,1);assert.doesNotMatch(JSON.stringify(b),/PRIVATE_SECRET|never/);
  calls.length=0;await captureBaseline(o,async()=>{calls.push(1);return {};},state(),{maxQueries:1});assert.equal(calls.length,1);
});

test('polling shares reads, respects global intervals and has a total query/attempt limit without replay',async()=>{
  const f=fixture({maxPolls:2});
  for(let i=1;i<=4;i++)f.submit(order('build_district',{planet_id:i<4?3:4,district_key:'district_city'}),{requestId:`r${i}`,baseline:{districtCount:7}});
  f.advance();await f.poll((method,params)=>({planet_id:params.planet_id,construction_queue:[]}));assert.equal(f.calls.length,2);
  await f.poll({});assert.equal(f.calls.length,2);
  f.advance();await f.poll((method,params)=>({planet_id:params.planet_id,construction_queue:[]}));
  assert.equal(f.calls.length,4);assert.ok(f.tracker.view().every(x=>x.status==='expired_unknown'));
  assert.ok(f.calls.every(x=>x.method.startsWith('get_')));
});

test('only same-session same-binding persisted records restore; dates and player changes invalidate unknown work',()=>{
  const f=fixture();f.submit(order('colonize',{fleet_id:2,planet_id:3}));const snapshot=f.tracker.serialize();
  const same=fixture();assert.equal(same.tracker.restore(snapshot,{state:state()}).restored,1);
  const other=new OrderTracker({sessionId:'new-session',binding:{pid:42,creationTime:'same-process'}});assert.equal(other.restore(snapshot).restored,0);
  assert.equal(fixture().tracker.restore({...snapshot,binding:'different'}).restored,0);
  const old=state();old.date='2200.01.01';assert.equal(fixture().tracker.restore(snapshot,{state:old}).restored,0);
  const foreign=state();foreign.player.country_id=1;same.tracker.updateState(foreign);assert.equal(same.tracker.view()[0].status,'expired_unknown');
});

test('malformed persisted private data is not echoed and read failures remain unknown until expiry',async()=>{
  const f=fixture({maxPolls:1});f.submit(order('survey',{fleet_id:1,system_id:3}));
  const saved=f.tracker.serialize();saved.records[0].PRIVATE_SECRET='do-not-save';saved.records[0].baseline.PRIVATE_SECRET='do-not-save';
  const other=fixture();other.tracker.restore(saved,{state:state()});assert.doesNotMatch(JSON.stringify(other.tracker.serialize()),/PRIVATE_SECRET|do-not-save/);
  f.advance();await f.poll(()=>{throw new Error('transport unavailable');});
  assert.equal(f.tracker.view()[0].status,'expired_unknown');assert.doesNotMatch(f.tracker.view()[0].reason,/失败$/);
});
test('overlapping polls share the same in-flight read and never turn an idle upgraded fleet into completion',async()=>{
  const f=fixture();f.submit(order('upgrade_fleet',{fleet_id:3}));f.advance();
  let finish;const response=new Promise(resolve=>{finish=resolve;});let calls=0;
  const args={state:state(),rpc:async()=>{calls++;return response;}};
  const a=f.tracker.poll(args),b=f.tracker.poll(args);assert.equal(calls,1);
  finish({fleets:[{fleet_id:3,status:'无指令'}]});await Promise.all([a,b]);assert.equal(f.tracker.view()[0].status,'submitted');
});
test('clearing blockers and creating zones use explicit target changes and never absent data',async()=>{
  const f=fixture();f.submit(order('clear_blocker',{planet_id:3,deposit_id:7}),{baseline:{blockerPresent:true}});
  f.advance();await f.poll({planet_id:3});assert.equal(f.tracker.view()[0].status,'submitted');
  f.advance();await f.poll({planet_id:3,blockers:[]});assert.equal(f.tracker.view()[0].status,'completed');
  f.submit(order('set_district_zone',{planet_id:3,district_id:128,zone_slot:2,zone_key:'zone_research'}),{requestId:'zone'});
  f.advance();await f.poll({planet_id:3,districts:[{district_id:128,slots:[{slot:2,zone:null}]}]});assert.equal(f.tracker.view()[1].status,'submitted');
  f.advance();await f.poll({planet_id:3,districts:[{district_id:128,slots:[{slot:2,zone:'zone_research'}]}]});assert.equal(f.tracker.view()[1].status,'completed');
});
test('close ends tracking as unknown, does not claim cancellation, and suppresses later reads and registration',async()=>{
  const f=fixture();f.submit(order('colonize',{fleet_id:2,planet_id:3}));
  f.tracker.close('用户停止');assert.equal(f.tracker.view()[0].status,'expired_unknown');assert.match(f.tracker.view()[0].reason,/不表示游戏已取消或操作失败/);
  assert.equal(f.tracker.drainEvents().at(-1).proof.kind,'tracking_stopped');
  f.advance();await f.poll({});assert.equal(f.calls.length,0);assert.equal(f.submit(order('colonize',{fleet_id:2,planet_id:4})),null);
  assert.equal(f.tracker.restore(f.tracker.serialize(),{state:state()}).restored,0);
});
test('close during a read cannot complete an order or start another queued read',async()=>{
  const f=fixture();f.submit(order('survey',{fleet_id:1,system_id:3}));f.submit(order('survey',{fleet_id:1,system_id:4}),{requestId:'other'});f.advance();
  let finish;const response=new Promise(resolve=>{finish=resolve;});let calls=0;
  const work=f.tracker.poll({state:state(),rpc:async()=>{calls++;return response;}});
  f.tracker.close();finish({id:3,surveyed:true});await work;
  assert.equal(calls,1);assert.ok(f.tracker.view().every(x=>x.status==='expired_unknown'));
});
test('a missing transport receipt remains submission-unknown and may only become confirmed through actual effects',()=>{
  const f=fixture();f.submit(order('colonize',{fleet_id:2,planet_id:3}),{response:{}});
  assert.equal(f.tracker.view()[0].submissionConfirmed,false);assert.match(f.tracker.view()[0].reason,/是否提交未知/);
  const s=state();s.colonies[0].colonies_summary=[{planet_id:3,status:'established',is_colonizing:false,pops:100}];f.tracker.updateState(s);
  assert.equal(f.tracker.view()[0].status,'completed');assert.equal(f.tracker.view()[0].proof.kind,'colony_established');
});
