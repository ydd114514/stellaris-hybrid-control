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
 const fleetPolicy=compileNativeIntent(s,{...contract,nativePolicy:{peaceful_exploration:true,use_existing_science:true}},undefined,{requireGoals:false});
 assert.equal(a.key,fleetPolicy.key);assert.notDeepEqual(a.ownerPolicy,fleetPolicy.ownerPolicy);
 const review=new NativeStrategyReview();s.nativeIntent={status:'stalled',targetResource:'unity',requestedFocus:'unity_traditions'};
 review.acknowledge(s);assert.deepEqual(review.due(s),[]);
});
test('owner timestamps, standing rebinds and task replans preserve the resource baseline while a changed goal resets it',()=>{
 const tracker=new NativeIntentExecution(),s=state(),i=compileNativeIntent(s,{...contract,taskIds:['old-task']});
 tracker.observe(i,s,context);
 const next=state('2200.07.01');next.userEconomicPolicy={...owner,updatedAt:999,note:'把凝聚力继续提上去，换种说法'};
 const reworded=compileNativeIntent(next,{...contract,taskIds:['new-task']});
 assert.equal(i.key,reworded.key);
 const flat=tracker.observe(reworded,next,context);assert.equal(flat.status,'stalled');assert.equal(flat.baseline.date,'2200.01.01');
 const a=state();delete a.userEconomicPolicy;a.operatorStanding={id:'session-a',text:'持续凝聚力',economyFocus:'unity_traditions'};
 const b={...a,operatorStanding:{...a.operatorStanding,id:'session-b',text:'继续优先凝聚力'}};
 assert.equal(compileNativeIntent(a,contract).key,compileNativeIntent(b,contract).key);
 const changed=state('2201.01.01');changed.userEconomicPolicy={...owner,priority:'research_first',economyFocus:'research'};
 const newIntent=compileNativeIntent(changed,contract);assert.notEqual(newIntent.key,i.key);
});
test('construction and staffing get bounded observation periods without claiming an economic result',()=>{
 const tracker=new NativeIntentExecution();
 const constructing=date=>({...state(date),colonyAudit:{known:true,date,colonies:[{planetId:0,ageDays:0,constructionCount:1,housing:2,amenities:2,unemployed:0}]}});
 let s=constructing('2200.01.01'),i=compileNativeIntent(s,contract);tracker.observe(i,s,context);
 const waiting=tracker.observe(i,constructing('2200.07.01'),context);
 assert.equal(waiting.status,'applied');assert.equal(waiting.feedback.phase,'building');assert.equal(waiting.progress.netDelta,0);
 const restored=new NativeIntentExecution();assert.equal(restored.restore(tracker.serialize(),context.binding),true);
 const missing=state('2200.10.01');restored.observe(i,missing,context);
 s=constructing('2201.01.01');s.colonyAudit.colonies[0].constructionCount=2;
 const overdue=restored.observe(i,s,context);assert.equal(overdue.status,'stalled');assert.equal(overdue.feedback.wait,null);
 assert.ok(overdue.feedback.recommendations.some(x=>x.action==='verify_target_construction'));
 const staff=new NativeIntentExecution(),staffing=date=>({...state(date),colonyAudit:{known:true,date,colonies:[{planetId:0,ageDays:0,constructionCount:0,housing:2,amenities:2,unemployed:0}]},
  operationalFacts:[{topic:'jobs',entityId:0,gameDate:date,observedAt:1000,economy:{workforceKnown:true,employedWorkforce:5,capacityWorkforce:10}}]});
 s=state();staff.observe(i,s,context);staff.observe(i,staffing('2200.04.01'),context);
 const filling=staff.observe(i,staffing('2200.07.01'),context);assert.equal(filling.status,'applied');assert.equal(filling.feedback.phase,'staffing');
 assert.equal(staff.observe(i,staffing('2200.10.01'),context).status,'stalled');
 const afterBuild=new NativeIntentExecution();afterBuild.observe(i,constructing('2200.01.01'),context);
 afterBuild.observe(i,constructing('2200.07.01'),context);
 assert.equal(afterBuild.observe(i,staffing('2201.01.01'),context).feedback.phase,'staffing');
 assert.equal(afterBuild.observe(i,staffing('2201.07.01'),context).status,'stalled');
});
test('stale readings expose no stale net or tradition delta and a crisis does not consume the normal review interval',()=>{
 const tracker=new NativeIntentExecution(),s=state(),i=compileNativeIntent(s,contract);tracker.observe(i,s,context);
 const stale=state('2200.07.01',40);stale.traditions.unlocked_traditions_count=1;
 const unknown=tracker.observe(i,stale,{...context,now:40000});
 assert.equal(unknown.status,'blocked');assert.equal(unknown.current.net,null);assert.equal(unknown.progress.netDelta,null);assert.equal(unknown.progress.traditionsGained,null);
 const war=state('2200.08.01',5);war.wars=[{player_side:'defender'}];
 assert.equal(tracker.observe(compileNativeIntent(war,contract),war,context).status,'suspended');
 const recovered=tracker.observe(i,state('2202.01.01',5),context);
 assert.equal(recovered.status,'applied');assert.equal(recovered.baseline.net,20);assert.equal(recovered.progress.netDelta,-15);
 assert.equal(tracker.observe(i,state('2202.07.01',5),context).status,'stalled');
});
test('a model can translate accepted advice to native constraints but cannot weaken explicit owner constraints',()=>{
 const model=validateStrategyContract({...contract,nativePolicy:{peaceful_exploration:true,use_existing_science:true}},undefined,{requireGoals:false});
 const s=state();delete s.userEconomicPolicy;
 assert.deepEqual(compileNativeIntent(s,model).ownerPolicy,{peaceful_exploration:true,use_existing_science:true});
 assert.deepEqual(compileNativeIntent(state(),{...model,nativePolicy:{peaceful_exploration:false,use_existing_science:false}}).ownerPolicy,{peaceful_exploration:true,use_existing_science:true});
 assert.throws(()=>validateStrategyContract({...contract,nativePolicy:{arbitrary_command:true}},undefined,{requireGoals:false}));
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
