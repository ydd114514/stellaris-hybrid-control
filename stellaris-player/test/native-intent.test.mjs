import test from 'node:test';
import assert from 'node:assert/strict';
import {compileNativeIntent,NativeIntentExecution} from '../src/native-intent.mjs';
import {NativeCountryAI,COUNTRY_AI_P1_BRIDGE_VERSION,COUNTRY_AI_P1_FEATURES} from '../src/native-country-ai.mjs';
import {nativeOwnerPolicy,normalizeCountryAIProtection} from '../src/native-country-ai-economic-policy.mjs';
import {NativeGame} from '../src/native-game.mjs';
import {NativeStrategyReview} from '../src/native-strategy-review.mjs';
import {validateStrategyContract} from '../src/strategy-contract.mjs';

const owner={version:1,source:'user-current-chat',updatedAt:1,priority:'unity_first',economyFocus:'unity_traditions',resourcePolicy:'deficit_only',militaryPolicy:'exploration_until_threat',civilianFleetPolicy:'use_existing_explorers',note:'持续主攻凝聚力，其他资源补缺，使用现有舰队探索'};
const contract={economyFocus:'research',expansionStance:'aggressive',militaryStance:'prepare_war',oneOffActions:[],reason:'科研发展'};
const state=(date='2200.01.01',unity=20)=>({date,economyObservedAt:1000,resources:{unity:{net:unity},energy:{net:2,stockpile:10}},wars:[],userEconomicPolicy:{...owner},traditions:{unlocked_traditions_count:0}});
const context={binding:'world-one',steeringConfirmed:true,ownerPolicyConfirmed:true,now:1000};

test('owner, accepted advice and model share one compiler with owner priority and recoverable emergencies',()=>{
 const s=state(),i=compileNativeIntent(s,contract);
 assert.equal(i.source,'owner');assert.equal(i.contract.economyFocus,'unity_traditions');assert.equal(i.contract.militaryStance,'peaceful');
 assert.deepEqual(i.ownerPolicy,{peaceful_exploration:true,use_existing_science:true});
 s.resources.energy={net:-2,stockpile:4};const rescue=compileNativeIntent(s,contract);
 assert.equal(rescue.emergency,true);assert.equal(rescue.key,i.key);assert.equal(rescue.requestedFocus,'unity_traditions');
 delete s.userEconomicPolicy;s.resources.energy={net:2,stockpile:4};s.operationalGoal={targetResource:'unity',text:'已采纳的观众凝聚力建议'};
 assert.equal(compileNativeIntent(s,contract).source,'advice');assert.equal(compileNativeIntent(s,contract).targetResource,'unity');
 delete s.operationalGoal;assert.equal(compileNativeIntent(s,contract).source,'model');
 assert.deepEqual(nativeOwnerPolicy(s),{peaceful_exploration:false,use_existing_science:false});
});
test('setting receipt never completes the intent, actual effects drive progress and stagnation, stale readings stay unknown',()=>{
 const tracker=new NativeIntentExecution(),s=state(),i=compileNativeIntent(s,contract);
 assert.equal(tracker.observe(i,s,context).status,'applied');
 const flat=tracker.observe(i,state('2200.07.01'),context);assert.equal(flat.status,'stalled');assert.equal(flat.progress.netDelta,0);
 const growing=tracker.observe(i,state('2201.01.01',30),context);assert.equal(growing.status,'progressing');assert.equal(growing.progress.netDelta,10);
 const tradition=state('2201.07.01',25);tradition.traditions.unlocked_traditions_count=1;
 assert.equal(tracker.observe(i,tradition,context).status,'progressing');
 assert.equal(tracker.observe(i,tradition,{...context,now:40000}).status,'blocked');
 const other=new NativeIntentExecution();assert.equal(other.restore(tracker.serialize(),'world-two'),false);
 assert.equal(other.restore(tracker.serialize(),'world-one'),true);
 assert.equal(other.observe(i,state('2199.01.01',5),context).baseline.net,5);
});
test('model rephrasing cannot erase a stalled same-resource intent and review acknowledgement does not cause a polling storm',()=>{
 const s=state();delete s.userEconomicPolicy;
 const a=compileNativeIntent(s,contract),b=compileNativeIntent(s,{...contract,reason:'同一科研目标换句话'});
 assert.equal(a.key,b.key);
 const review=new NativeStrategyReview();s.nativeIntent={status:'stalled',targetResource:'unity',requestedFocus:'unity_traditions'};
 review.acknowledge(s);assert.deepEqual(review.due(s),[]);
});
test('a model can translate accepted advice to native constraints but cannot weaken explicit owner constraints',()=>{
 const model=validateStrategyContract({...contract,nativePolicy:{peaceful_exploration:true,use_existing_science:true}});
 const s=state();delete s.userEconomicPolicy;
 assert.deepEqual(compileNativeIntent(s,model).ownerPolicy,{peaceful_exploration:true,use_existing_science:true});
 assert.deepEqual(compileNativeIntent(state(),{...model,nativePolicy:{peaceful_exploration:false,use_existing_science:false}}).ownerPolicy,{peaceful_exploration:true,use_existing_science:true});
 assert.throws(()=>validateStrategyContract({...contract,nativePolicy:{arbitrary_command:true}}));
 const tracker=new NativeIntentExecution(),view=tracker.observe(compileNativeIntent(state(),model),state(),{...context,steeringConfirmed:false,controlError:'当前方针原生回读失败'});
 assert.equal(view.status,'blocked');assert.match(view.reason,/原生回读失败/);
});
test('a stalled intent cannot be silently renewed while the native economy remains running',async()=>{
 let acknowledgements=0;
 const game=Object.assign(Object.create(NativeGame.prototype),{nativeCountryAIEnabled:true,lastState:{nativeIntent:{status:'stalled',reason:'无增长'}},
  countryAI:{view:()=>({owner:'native'}),acknowledgeReview:async()=>acknowledgements++}});
 const result=await game.countryAIControl({operation:'continue'});
 assert.equal(result.status,'attention');assert.equal(result.control.owner,'native');assert.equal(acknowledgements,0);
});
test('native lease must read back owner policy before enabling and can update it without taking down ordinary operations',async()=>{
 let generation=0,phase='idle',paused=true,enabled=false,policy={},protection={},updates=0;
 const flags=()=>({human_ai:enabled,force_human_ai:enabled});
 const current=()=>({success:true,paused,single_local_human_guard:true,global_flags:flags(),precondition:{world_generation:1,country_id:0,country_address:123}});
 const snapshot=()=>({success:true,generation,phase,last_native_state:current(),routine_gate:{owner_policy:policy,protected_targets:protection,reserved_policy:'full_with_reserved',armed:enabled},observation:{armed:enabled}});
 const ai=new NativeCountryAI({polls:2,wait:async()=>{},assertBinding:async()=>{},setDispatchFence:()=>{},rpc:async(method,p)=>{
  if(method==='ping')return {bridge_version:COUNTRY_AI_P1_BRIDGE_VERSION,features:[...COUNTRY_AI_P1_FEATURES,'country_ai_full_with_reserved']};
  if(method==='get_country_ai_state')return current();
  if(p.action==='prepare'){generation++;phase='prepared';policy={...p.owner_policy};protection={...p.protected_targets};}
  if(p.action==='enable'){enabled=true;phase='ready_paused';}
  if(p.action==='run'){paused=false;phase='running';}
  if(p.action==='update_owner_policy'){policy={...p.owner_policy};updates++;}
  return snapshot();
 }});
 const wanted=nativeOwnerPolicy(state());
 await ai.delegate({ownerPolicy:wanted,protectedTargets:{fleets:[0,0x1000001]}});
 assert.deepEqual(ai.view().ownerPolicy,wanted);assert.equal(ai.view().owner,'native');
 await ai.setOwnerPolicy({});assert.equal(updates,1);assert.equal(ai.view().owner,'native');assert.equal(paused,false);
 assert.deepEqual(normalizeCountryAIProtection({fleets:[0x1000001,0,0]}).fleets,[0,0x1000001]);
});
