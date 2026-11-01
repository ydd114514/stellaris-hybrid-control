import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeCountryAI,COUNTRY_AI_P1_BRIDGE_VERSION,COUNTRY_AI_P1_FEATURES} from '../src/native-country-ai.mjs';
import {NativeGame} from '../src/native-game.mjs';
const make=()=>{
 let phase='idle',paused=true,on=false,generation=0;const calls=[];
 const state=()=>({success:true,paused,single_local_human_guard:true,global_flags:{human_ai:on,force_human_ai:on},precondition:{world_generation:0,country_id:0,country_address:1}});
 const c=new NativeCountryAI({assertBinding:async()=>{},setDispatchFence:()=>{},wait:async()=>{},rpc:async(m,p={})=>{
  calls.push({m,p});if(m==='ping')return {bridge_version:COUNTRY_AI_P1_BRIDGE_VERSION,features:[...COUNTRY_AI_P1_FEATURES,'country_ai_full_with_reserved']};
  if(m==='get_country_ai_state')return state();
  if(p.action==='prepare'){phase='prepared';generation++;}if(p.action==='enable'){on=true;phase='ready_paused';}
  if(p.action==='run'){paused=false;phase='running';}if(p.action==='stop'){on=false;paused=true;phase='stopped';}
  return {success:true,phase,generation,last_native_state:state(),routine_gate:{armed:!['idle','stopped'].includes(phase),reserved_policy:'full_with_reserved',protected_targets:{jobs:[],colonies:[],shipyards:[]},command_counts:{queue_fleet_order_command:{admitted:2,blocked:0}}},observation:{armed:!['idle','stopped'].includes(phase),commands_drained:true}};
 }});return {c,calls,state};
};
test('full native default keeps routine dispatch fenced, admits reserved player decisions and stops AI',async()=>{
 const f=make();await f.c.delegate();assert.equal(f.calls.find(x=>x.p.action==='prepare').p.policy,'full_with_reserved');
 assert.equal(f.c.view().commandCounts.queue_fleet_order_command.admitted,2);
 const host={nativeCountryAIFence:true,countryAI:f.c};
 for(const m of ['declare_war','offer_peace','diplomacy_action','respond_diplomacy'])assert.doesNotThrow(()=>NativeGame.prototype.assertRpcAllowed.call(host,m,{}));
 assert.doesNotThrow(()=>NativeGame.prototype.assertRpcAllowed.call(host,'toggle_edict',{edict_key:'cfsteer_economy_research',enabled:true}));
 for(const m of ['build_ship','select_research','move_fleet','set_job_workforce_limit'])assert.throws(()=>NativeGame.prototype.assertRpcAllowed.call(host,m,{}),/封口/);
 assert.throws(()=>NativeGame.prototype.assertRpcAllowed.call(host,'toggle_edict',{edict_key:'unknown',enabled:true}));
 await f.c.takeover();assert.equal(f.state().global_flags.human_ai,false);assert.equal(f.state().paused,true);
});
test('explicit pre-lease refusal restores human state only after fresh idle, off and unarmed readback',async()=>{
 for(const ambiguous of [false,true]){
  const f=make(),original=f.c.rpc;
  f.c.rpc=async(m,p={})=>{
   if(m==='country_ai_lease'&&p.action==='prepare'){
    if(ambiguous)throw Error('pipe timeout');
    return {success:false,error:'routine_gate_existing_native_queue_not_proven_empty'};
   }
   return original(m,p);
  };
  await assert.rejects(f.c.delegate());
  assert.equal(f.c.active,ambiguous);assert.equal(f.c.view().owner,ambiguous?'unconfirmed':'human');
  assert.equal(f.calls.some(x=>x.p.action==='enable'||x.p.action==='stop'),false);
 }
});
test('watch renews native supervision even when a strategy review is already pending',async()=>{
 let heartbeats=0;
 const host={nativeCountryAIEnabled:true,countryAI:{active:true,view:()=>({owner:'native'})},nativeStrategicReviewDue:true,
  monitorDecision:async()=>{heartbeats++;},observe:async()=>({date:'2200.02.01'})};
 const result=await NativeGame.prototype.watch.call(host,5);
 assert.equal(heartbeats,1);assert.equal(result.waitPolicy.modelRoutineOrders,0);
 assert.deepEqual(result.wakeReasons,['native_country_ai_review_due']);
});
test('StrategyContract changes direction and issues a reserved action while native AI stays on; request IDs do not replay',async()=>{
 const f=make();await f.c.delegate();const active=new Set(),orders=[];
 const host={countryAI:f.c,nativeCountryAIEnabled:true,strategyReceipts:new Map(),now:()=>1,
  lastState:{date:'2200.01.01'},commandScope:async()=>{},checkpoint:async()=>{},strategyReview:{acknowledge(){}},
  rpc:async(m,p)=>{assert.equal(f.state().global_flags.human_ai,true);if(m==='get_edicts')return {active_edicts:[...active].map(key=>({key}))};assert.equal(m,'toggle_edict');p.enabled?active.add(p.edict_key):active.delete(p.edict_key);return {success:true};},
  observe:async()=>({snapshotId:'current'}),apply:async input=>{assert.equal(f.c.view().owner,'native');orders.push(input);return {orders:[{status:'posted'}]};}};
 const input={requestId:'strategy-1',contract:{economyFocus:'research',expansionStance:'consolidate',militaryStance:'peaceful',reason:'以科研为主并改善关系',oneOffActions:[{type:'diplo_propose',arguments:{country_id:0,action:'improve_relations'}}]}};
 assert.equal((await NativeGame.prototype.strategyControl.call(host,input)).status,'applied');
 await NativeGame.prototype.strategyControl.call(host,input);assert.equal(orders.length,1);
 assert.equal(f.calls.some(x=>x.p.action==='stop'),false);assert.equal(f.c.view().owner,'native');
 assert.equal(host.strategyContract.steeringConfirmed,true);
});
