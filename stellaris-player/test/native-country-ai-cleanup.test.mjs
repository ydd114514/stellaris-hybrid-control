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
