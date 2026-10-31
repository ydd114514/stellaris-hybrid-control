import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeCountryAI,COUNTRY_AI_P1_BRIDGE_VERSION,COUNTRY_AI_P1_FEATURES} from '../src/native-country-ai.mjs';
import {COUNTRY_AI_ECONOMY_CANDIDATE_VERSION,COUNTRY_AI_ECONOMY_FEATURES,normalizeCountryAIProtection} from '../src/native-country-ai-economic-policy.mjs';
function fixture({allowEconomyCandidate=false,ping,prepareHook}={}){
 let phase='idle',generation=0,paused=true,flags={human_ai:false,force_human_ai:false},world=0,gate=false,observation=false;
 const calls=[],fences=[];let failEnable=false,denyStop=false,policy='',protection={};
 const nativeState=()=>({success:true,paused,single_local_human_guard:true,global_flags:{...flags},precondition:{world_generation:world,country_id:0,country_address:123,global_flags:{...flags},sequence:0,date:'2200.01.01'}});
 const native=()=>({success:true,phase,generation,last_native_state:nativeState(),routine_gate:{armed:gate,coverage_faults:0,
  protected_targets:protection,economic_administration_allowed:policy.startsWith('economy'),ship_production_allowed:policy==='economy_and_ship_production'},observation:{armed:observation}});
 const ctl=new NativeCountryAI({allowEconomyCandidate,polls:2,wait:async()=>{},assertBinding:async()=>{},setDispatchFence:v=>fences.push(v),rpc:async(m,p={})=>{
  calls.push({m,p});
  if(m==='ping')return ping??{bridge_version:COUNTRY_AI_P1_BRIDGE_VERSION,features:COUNTRY_AI_P1_FEATURES};
  if(m==='get_country_ai_state')return nativeState();
  if(p.action==='prepare'){generation++;phase='prepared';gate=observation=true;policy=p.policy;protection=structuredClone(p.protected_targets??{});if(prepareHook)return prepareHook(native());}
  if(p.action==='enable'){flags={human_ai:true,force_human_ai:true};phase='ready_paused';if(failEnable)throw Error('pipe timeout');}
  if(p.action==='run'){paused=false;phase='running';}
  if(p.action==='stop'){paused=true;if(!denyStop){flags={human_ai:false,force_human_ai:false};phase='stopped';gate=observation=false;}}
  return native();
 }});
 return {ctl,calls,fences,change:o=>{if('failEnable'in o)failEnable=o.failEnable;if('denyStop'in o)denyStop=o.denyStop;if('world'in o)world=o.world;if('generation'in o)generation=o.generation;},native};
}
test('native delegation, supervision, whole-country takeover and new-generation resume',async()=>{
 const f=fixture();assert.equal((await f.ctl.delegate()).owner,'native');assert.deepEqual(f.fences,[true]);
 await f.ctl.heartbeat();assert.equal((await f.ctl.takeover()).owner,'human');assert.deepEqual(f.fences,[true,false]);
 await f.ctl.resume();assert.equal(f.native().generation,2);
 assert.ok(f.calls.every(c=>['ping','get_country_ai_state','country_ai_lease'].includes(c.m)),'no routine work commands');
});

const economyPing={bridge_version:COUNTRY_AI_ECONOMY_CANDIDATE_VERSION,features:[...COUNTRY_AI_P1_FEATURES,...COUNTRY_AI_ECONOMY_FEATURES]};
test('economic candidate needs explicit host opt-in and exact complete capability handshake',async()=>{
 for(const config of [{ping:economyPing},{allowEconomyCandidate:true},
  {allowEconomyCandidate:true,ping:{...economyPing,features:economyPing.features.filter(f=>f!=='country_ai_ship_queue_effect_readback')}}]){
  const f=fixture(config);await assert.rejects(f.ctl.delegate({policy:'economy_and_ship_production'}));
  assert.equal(f.calls.some(c=>c.p.action==='prepare'||c.p.action==='enable'),false);
 }
});
test('economic key protection is normalized, copied, read back and retained through takeover/resume',async()=>{
 const f=fixture({allowEconomyCandidate:true,ping:economyPing});const requested={jobs:[0x1000000,0,0],colonies:[0],shipyards:[3]};
 const view=await f.ctl.delegate({policy:'economy_and_ship_production',protectedTargets:requested});
 requested.jobs.length=0;
 assert.deepEqual(view.domains,['research','planet_construction','workforce','colony_designation','ship_production']);
 assert.deepEqual(f.ctl.saved.protectedTargets.jobs,[0,0x1000000]);view.protectedTargets.jobs.length=0;
 await f.ctl.takeover();await f.ctl.resume();
 assert.deepEqual(f.calls.filter(c=>c.p.action==='prepare').at(-1).p.protected_targets.jobs,[0,0x1000000]);
});
test('native arm must prove constraints before enabling; mismatch closes its acquired generation',async()=>{
 const f=fixture({allowEconomyCandidate:true,ping:economyPing,prepareHook:n=>({...n,routine_gate:{...n.routine_gate,protected_targets:{}}})});
 await assert.rejects(f.ctl.delegate({policy:'economy',protectedTargets:{colonies:[0]}}),/未真实回读/);
 assert.equal(f.calls.some(c=>c.p.action==='enable'),false);assert.equal(f.calls.filter(c=>c.p.action==='stop').length,1);
 assert.equal(f.ctl.active,false);
});
test('economic constraints reject truncated/foreign-format references and unknown categories',()=>{
 for(const value of [{jobs:[-1]},{jobs:[0xffffffff]},{jobs:['0']},{jobs:[1.5]},{jobs:null},{jobs:Array(257).fill(0)},
  {fleets:[1]},[],null])assert.throws(()=>normalizeCountryAIProtection(value));
 assert.deepEqual(normalizeCountryAIProtection({}),{jobs:[],colonies:[],shipyards:[]});
});
test('strategic protection needs actual takeover, reason, durable record and fresh revalidation on return',async()=>{
 const f=fixture({allowEconomyCandidate:true,ping:economyPing});
 await assert.rejects(f.ctl.protect({protectedTargets:{colonies:[0]},reason:'保留工业定位'}),/接管/);
 await f.ctl.delegate({policy:'economy_and_ship_production'});
 await assert.rejects(f.ctl.protect({protectedTargets:{colonies:[0]},reason:'保留工业定位'}),/接管/);
 await f.ctl.takeover();
 await assert.rejects(f.ctl.protect({protectedTargets:{colonies:[0]},reason:' '}),/战略理由/);
 await assert.rejects(f.ctl.protect({reason:'不可隐式清空'}),/明确给出/);
 const before=f.calls.filter(c=>c.p.action==='prepare').length;
 const intent=await f.ctl.protect({protectedTargets:{colonies:[0],shipyards:[0]},reason:'保留工业定位和造船预算'});
 assert.equal(intent.protectionStatus,'pending_native_revalidation');assert.equal(intent.owner,'human');
 assert.equal(f.calls.filter(c=>c.p.action==='prepare').length,before);
 const returned=await f.ctl.resume();assert.equal(returned.protectionStatus,'native_arm_confirmed');
 assert.deepEqual(f.calls.filter(c=>c.p.action==='prepare').at(-1).p.protected_targets,{jobs:[],colonies:[0],shipyards:[0]});
 await f.ctl.takeover();assert.equal(f.ctl.view().protectionStatus,'inactive');
 const previous=structuredClone(f.ctl.saved.protectedTargets);
 f.ctl.record=async()=>{throw Error('checkpoint unavailable');};
 await assert.rejects(f.ctl.protect({protectedTargets:{},reason:'明确解除工业保护'}),/checkpoint/);
 assert.deepEqual(f.ctl.saved.protectedTargets,previous);
});
test('foreign generation or world readback cannot release an active dispatch fence',async()=>{
 for(const changed of [{generation:99},{world:1}]){
  const f=fixture();await f.ctl.delegate();f.change(changed);
  await assert.rejects(f.ctl.state(),/代次或本国世界改变/);
  assert.equal(f.ctl.active,true);assert.equal(f.fences.at(-1),true);
 }
});
test('unknown enable is never replayed; explicit stop closes its known lease',async()=>{
 const f=fixture();f.change({failEnable:true});await assert.rejects(f.ctl.delegate(),/timeout/);
 assert.equal(f.calls.filter(c=>c.p.action==='enable').length,1);assert.equal(f.calls.filter(c=>c.p.action==='stop').length,1);
 assert.equal(f.ctl.active,false);assert.equal(f.fences.at(-1),false);
});
test('unconfirmed takeover keeps every ordinary dispatcher fenced',async()=>{
 const f=fixture();await f.ctl.delegate();f.change({denyStop:true});await assert.rejects(f.ctl.takeover(),/尚未确认/);
 assert.equal(f.ctl.active,true);assert.equal(f.fences.at(-1),true);assert.equal(f.ctl.view().owner,'unconfirmed');
});
test('changed native world generation cannot resume the previous strategy',async()=>{
 const f=fixture();await f.ctl.delegate();await f.ctl.takeover();f.change({world:1});
 await assert.rejects(f.ctl.resume(),/世界或玩家已改变/);assert.equal(f.calls.filter(c=>c.p.action==='prepare').length,1);
});
test('work sources are never inferred from the switch or admission counters',async()=>{
 const f=fixture();await f.ctl.delegate();assert.equal(f.ctl.view().autonomousWorkVerified,false);assert.equal(f.ctl.view().hardNativeBudget,false);
});

test('a candidate without the final Post boundary and clone lifetime is rejected before gameplay writes',async()=>{
 for(const ping of [
  {bridge_version:'cyberfish-0.6.16-country-ai-p1-r1',features:COUNTRY_AI_P1_FEATURES},
  {bridge_version:COUNTRY_AI_P1_BRIDGE_VERSION,features:COUNTRY_AI_P1_FEATURES.filter(x=>x!=='country_ai_command_clone_lifetime')}
 ]){
  const calls=[];
  const control=new NativeCountryAI({rpc:async method=>{calls.push(method);return ping;},assertBinding:async()=>{},setDispatchFence:()=>{}});
  await assert.rejects(control.delegate(),/当前桥不具备/);assert.deepEqual(calls,['ping']);
 }
});
