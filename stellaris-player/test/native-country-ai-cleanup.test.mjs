import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanupNativeCountryAI} from '../src/native-country-ai-cleanup.mjs';
const scope={country_id:0,world_generation:0};
function fixture(){
 let closed=false,world=0,drained=true,fail=false;
 const calls=[];
 const rpc=async(m,p)=>{
  calls.push({m,p});
  if(m==='get_country_ai_state')return {success:true,single_local_human_guard:true,world_generation_tracking:true,paused:true,
   precondition:{...scope,world_generation:world},global_flags:{human_ai:!closed,force_human_ai:!closed}};
  if(m==='country_ai_routine_gate')return {success:true,armed:!closed};
  if(m==='country_ai_observation')return {success:true,armed:!closed,commands_drained:drained};
  if(p.action==='stop'){if(fail)throw Error('timeout');closed=true;}
  return {success:true,phase:closed?'stopped':'running',generation:1,baseline:scope,
   routine_gate:{armed:!closed},observation:{armed:!closed,commands_drained:drained}};
 };
 return {rpc,calls,expectedScope:scope,expectedGeneration:1,wait:async()=>{},attempts:2,
  set:o=>{if('closed'in o)closed=o.closed;if('world'in o)world=o.world;if('drained'in o)drained=o.drained;if('fail'in o)fail=o.fail;}};
}
test('supervisor stops only its durably recorded lease and confirms actual closure',async()=>{
 const f=fixture();const result=await cleanupNativeCountryAI(f);assert.equal(result.confirmed,true);assert.equal(result.owner,'human');
 assert.equal(f.calls.filter(c=>c.p?.action==='stop').length,1);
 assert.ok(f.calls.every(c=>c.m==='get_country_ai_state'||c.m==='country_ai_lease'));
});
test('an already closed lease is verified without another mutation',async()=>{
 const f=fixture();f.set({closed:true});assert.equal((await cleanupNativeCountryAI({...f,expectedGeneration:undefined})).confirmed,true);
 assert.equal(f.calls.some(c=>c.p?.action==='stop'),false);
});
test('unknown ownership, different generation and reloads never guess a stop target',async()=>{
 for(const update of [{expectedGeneration:undefined},{expectedGeneration:2}]){
  const f=fixture();await assert.rejects(cleanupNativeCountryAI({...f,...update}),/持久化/);
  assert.equal(f.calls.some(c=>c.p?.action==='stop'),false);
 }
 const f=fixture();f.set({world:1});await assert.rejects(cleanupNativeCountryAI(f),/世界代次/);
 assert.equal(f.calls.some(c=>c.p?.action==='stop'),false);
});
test('off flags cannot hide an unresolved command, and unknown stop is not replayed',async()=>{
 const f=fixture();f.set({drained:false});await assert.rejects(cleanupNativeCountryAI(f),/排空尚未确认/);
 assert.equal(f.calls.filter(c=>c.p?.action==='stop').length,1);
 const timeout=fixture();timeout.set({fail:true});await assert.rejects(cleanupNativeCountryAI(timeout),/timeout/);
 assert.equal(timeout.calls.filter(c=>c.p?.action==='stop').length,1);
});

function noLeaseFixture(options={}){
 const {phase='stopped',state={},afterLease,cachedGate}=options;
 const routine=Object.hasOwn(options,'routine')?options.routine:false;
 const observation=Object.hasOwn(options,'observation')?options.observation:false;
 const calls=[];let reads=0;
 return {calls,expectedScope:scope,expectedGeneration:undefined,rpc:async(m,p)=>{
  calls.push({m,p});
  if(m==='get_country_ai_state')return {success:true,single_local_human_guard:true,world_generation_tracking:true,paused:true,
   precondition:scope,global_flags:{human_ai:false,force_human_ai:false},...state};
  assert.equal(p.action,'status');
  if(m==='country_ai_routine_gate')return {success:true,armed:routine};
  if(m==='country_ai_observation')return {success:true,armed:observation};
  const lease={success:true,phase,generation:47,routine_gate:cachedGate??{armed:routine},observation:{armed:observation}};
  return ++reads===2&&afterLease?{...lease,...afterLease}:lease;
 }};
}
test('a refused prepare with no acquired generation confirms fresh idle or stopped unarmed state without stopping an old generation',async()=>{
 for(const phase of ['idle','stopped'])for(const expectedGeneration of [undefined,null]){
  const f=noLeaseFixture({phase});
  const result=await cleanupNativeCountryAI({...f,expectedGeneration});
  assert.equal(result.confirmed,true);assert.equal(result.noAcquiredLease,true);assert.equal(result.owner,'human');
  assert.equal(result.generation,null);assert.equal(result.nativePhase,phase);
  assert.equal(f.calls.filter(c=>c.m==='country_ai_lease'&&c.p?.action==='status').length,2);
  assert.equal(f.calls.some(c=>c.p?.action==='stop'),false);
 }
});
test('missing generation never clears an active lease, unknown armed state, enabled AI, missing pause or a different world',async()=>{
 for(const options of [
  {phase:'prepared'},{phase:'ready_paused'},{phase:'running'},{phase:'stop_unconfirmed'},
  {routine:true},{observation:true},{routine:undefined},{observation:null},
  {state:{global_flags:{human_ai:true,force_human_ai:false}}},
  {state:{global_flags:{human_ai:false,force_human_ai:true}}},
  {state:{global_flags:{human_ai:false}}},{state:{paused:false}},
  {state:{success:false}},{state:{world_generation_tracking:false}},
  {state:{precondition:{country_id:0,world_generation:1}}},
  {state:{precondition:{country_id:1,world_generation:0}}}
 ]){
  const f=noLeaseFixture(options);
  await assert.rejects(cleanupNativeCountryAI(f));
  assert.equal(f.calls.some(c=>c.p?.action==='stop'),false);
 }
});
test('an intervening lease acquisition stays unconfirmed and is never stopped without a recorded generation',async()=>{
 const f=noLeaseFixture({afterLease:{phase:'running',routine_gate:{armed:true},observation:{armed:true}}});
 await assert.rejects(cleanupNativeCountryAI(f),/出现活动/);
 assert.equal(f.calls.some(c=>c.p?.action==='stop'),false);
});
test('a failed prepare cache is resolved only by successful independent read-only gate and observation status',async()=>{
 const f=noLeaseFixture({cachedGate:{success:false,error:'protected_target_not_proven_owned'}});
 const result=await cleanupNativeCountryAI(f);
 assert.equal(result.noAcquiredLease,true);assert.equal(result.confirmed,true);
 assert.equal(f.calls.filter(c=>c.m==='country_ai_routine_gate').length,2);
 assert.equal(f.calls.filter(c=>c.m==='country_ai_observation').length,2);
 assert.ok(f.calls.every(c=>c.m==='get_country_ai_state'||c.p?.action==='status'));
 for(const method of ['country_ai_routine_gate','country_ai_observation']){
  const unknown=noLeaseFixture({cachedGate:{success:false,error:'protected_target_not_proven_owned'}}),rpc=unknown.rpc;
  unknown.rpc=async(m,p)=>m===method?{success:false,error:'unreadable'}:rpc(m,p);
  await assert.rejects(cleanupNativeCountryAI(unknown),/状态不可读/);
  assert.equal(unknown.calls.some(c=>c.p?.action==='stop'),false);
 }
 const armed=noLeaseFixture({cachedGate:{success:false,error:'protected_target_not_proven_owned'},routine:true});
 await assert.rejects(cleanupNativeCountryAI(armed),/持久化/);
 assert.equal(armed.calls.some(c=>c.p?.action==='stop'),false);
});
