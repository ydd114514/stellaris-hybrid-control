import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeGame} from '../src/native-game.mjs';
import {NativeStrategyReview,MIN_PERIODIC_REVIEW_MS} from '../src/native-strategy-review.mjs';
import {AdviceExecution} from '../src/advice-execution.mjs';
import {evaluateStrategyGoals,extractStrategyMetrics} from '../src/strategy-brief.mjs';

const contract={economyFocus:'research',expansionStance:'consolidate',militaryStance:'peaceful',reason:'先发展科研',
 goals:[{metric:'pops',target:120,byDate:'2210.01.01'}],oneOffActions:[]};
const sample=(date='2200.01.01',extra={})=>({date,empireType:'hive',population:60,resources:{
 physics_research:{net:30},society_research:{net:30},engineering_research:{net:30}},
 military:{fleets:[{military_power:100}]},...extra});

function gameFixture(state=sample()){
 let now=0,ackDate;
 const writes=[],rows=[],reserved=[];
 const active=new Set(['cfsteer_economy_research','cfsteer_expansion_consolidate','cfsteer_military_peaceful']);
 const view=()=>({owner:'native',generation:1,ownerPolicy:{}});
 const countryAI={active:true,view,heartbeat:async()=>view(),setOwnerPolicy:async()=>{},
  acknowledgeReview:async()=>{countryAI.last={last_native_state:{precondition:{date:ackDate??game.lastState.date}}};}};
 const review=new NativeStrategyReview({now:()=>now});
 const game=Object.assign(Object.create(NativeGame.prototype),{
  nativeCountryAIEnabled:true,countryAI,now:()=>now,lastState:state,strategyReview:review,
  sessionId:'session',binding:{pid:1,creationTime:'fixture'},boundNativeWorld:{world_generation:1,country_id:1},
  directory:'.',assertNativeWorld:async()=>{},commandScope:async()=>{},refreshOperatorStanding:async()=>{},
  checkpoint:async()=>{},correctNativeIntent:async()=>{},log:async row=>{rows.push(row);},
  monitorDecision:async()=>{game.nativeStrategicReviewDue=review.due(game.lastState,{fresh:false}).length>0;},
  observe:async()=>({...game.lastState,strategyWakeReasons:review.due(game.lastState),snapshotId:'current'}),
  apply:async input=>{reserved.push(input);return {status:'posted'};},
  rpc:async (method,params)=>{
   if(method==='get_edicts')return {active_edicts:[...active].map(key=>({key}))};
   assert.equal(method,'toggle_edict');
   writes.push(params);params.enabled?active.add(params.edict_key):active.delete(params.edict_key);
   return {success:true};
  },
 });
 return {game,review,rows,writes,active,reserved,setNow:value=>{now=value;},setAckDate:value=>{ackDate=value;}};
}

test('slow strategy submission anchors the next watch to the acknowledged date and wall clock',async()=>{
 const {game,review,setNow,setAckDate}=gameFixture();
 game.pendingStrategyReview={...game.lastState,strategyWakeReasons:['initial_strategy']};
 setNow(125000);
 game.lastState=sample('2200.10.29',{population:63});
 setAckDate('2200.11.01'); // 300 days after the brief.
 const result=await game.strategyControl({requestId:'slow',contract});
 assert.equal(result.status,'applied',result.error);
 assert.equal(review.lastMetrics.pops,60);
 assert.deepEqual((await game.watch(0)).strategyWakeReasons,[]);
 game.lastState=sample('2201.05.01',{population:63});
 setNow(125000+MIN_PERIODIC_REVIEW_MS-1);
 assert.deepEqual((await game.watch(0)).strategyWakeReasons,[]);
 setNow(125000+MIN_PERIODIC_REVIEW_MS);
 assert.deepEqual((await game.watch(0)).strategyWakeReasons,['six_month_review']);
});

test('task-linked strategy acknowledges applied state and wakes only on a new adverse condition',async()=>{
 const {game}=gameFixture();
 game.adviceTasks=new AdviceExecution({now:game.now});
 game.adviceTasks.ingest([{id:'task-1',source:'strategist',at:0,text:'提高科研月产'}],game.lastState);
 game.lastState.adviceExecution=game.adviceTasks.view();
 game.pendingStrategyReview={...game.lastState,strategyWakeReasons:['initial_strategy']};
 const result=await game.strategyControl({requestId:'tasks',contract:{...contract,taskIds:['task-1']}});
 assert.equal(result.status,'applied',result.error);
 assert.equal(result.adviceExecution.tasks[0].status,'verifying');
 assert.deepEqual((await game.watch(0)).strategyWakeReasons,[]);
 game.adviceTasks.update([{taskId:'task-1',status:'blocked',reason:'实际产能没有改善'}],game.lastState);
 game.lastState.adviceExecution=game.adviceTasks.view();
 assert.deepEqual((await game.watch(0)).strategyWakeReasons,['strategic_event']);
});

test('maintenance band requires a five-point recovery and task wording never wakes a review',()=>{
 const review=new NativeStrategyReview({now:()=>0});
 const state=(share,status='working',reason='初稿')=>sample(undefined,{strategy:{unityProgress:{focused:true,maintenanceShare:share}},
  adviceExecution:{tasks:[{id:'task-1',status,reason}]}});
 review.acknowledge(state(.29));
 assert.deepEqual(review.due(state(.29,'verifying','理由已更新')),[]);
 assert.deepEqual(review.due(state(.30)),['strategic_event']);
 review.acknowledge({...state(.30),strategyWakeReasons:['strategic_event']});
 assert.deepEqual(review.due(state(.299)),[]);
 assert.deepEqual(review.due(state(.25)),[]);
 assert.deepEqual(review.due(state(.249)),['strategic_event']);
});

test('short strategic events cannot count toward the two periodic stagnation samples',()=>{
 let now=0;
 const review=new NativeStrategyReview({now:()=>now});
 const make=(date,war)=>sample(date,{strategyContract:contract,wars:war?[{war_id:war}]:[]});
 review.acknowledge(make('2200.01.01'));
 for(const [date,war] of [['2200.01.11',1],['2200.01.21',2]]){
  now+=MIN_PERIODIC_REVIEW_MS;
  const state=make(date,war),reasons=review.due(state);
  assert.deepEqual(reasons,['strategic_event']);
  review.acknowledge({...state,strategyWakeReasons:reasons});
  assert.equal(review.stalledReviews,0);
 }
 const first=make('2200.07.01',2);
 assert.deepEqual(review.due(first),['six_month_review']);
 review.acknowledge(first);
 now+=MIN_PERIODIC_REVIEW_MS;
 assert.deepEqual(review.due(make('2201.01.01',2)),['six_month_review','stagnation']);
});

test('continue refuses a contract whose goals were all reached or expired',async()=>{
 const {game}=gameFixture(sample('2200.07.01'));
 game.strategyContract=contract;
 game.strategyGoalProgress=evaluateStrategyGoals(contract.goals,{pops:120},game.lastState.date);
 await assert.rejects(game.countryAIControl({operation:'continue'}),/都已达成或逾期.*设置新目标/);
 game.strategyGoalProgress=[];
 game.lastState.date='2210.01.02';
 await assert.rejects(game.countryAIControl({operation:'continue'}),/都已达成或逾期.*设置新目标/);
});

test('completed goal does not hide stagnation while another active goal has no progress',()=>{
 let now=0;
 const review=new NativeStrategyReview({now:()=>now});
 const goals=[...contract.goals,{metric:'research_monthly',target:180,byDate:'2210.01.01'}];
 const state=sample(undefined,{strategyContract:{...contract,goals}});
 state.strategyGoalProgress=evaluateStrategyGoals(goals,{pops:120,research_monthly:90},state.date);
 review.acknowledge(state);
 now+=MIN_PERIODIC_REVIEW_MS;
 review.acknowledge({...state,date:'2200.07.01'});
 now+=MIN_PERIODIC_REVIEW_MS;
 assert.deepEqual(review.due({...state,date:'2201.01.01'}),['six_month_review','stagnation']);
});

test('only changes to actual steering or goals clear stagnation under an owner lock',async()=>{
 const {game}=gameFixture(sample(undefined,{userEconomicPolicy:{priority:'unity_first'}}));
 game.strategyContract={...contract,economyFocus:'unity_traditions'};
 game.modelStrategyContract=game.strategyContract;
 game.pendingStrategyReview={...game.lastState,strategyWakeReasons:['six_month_review','stagnation']};
 const refused=await game.strategyControl({requestId:'locked',contract});
 assert.equal(refused.status,'attention');
 assert.match(refused.error,/economyFocus已被本人要求锁定/);
 assert.equal(game.strategyContract.economyFocus,'unity_traditions');
 const result=await game.strategyControl({requestId:'goal',contract:{...contract,goals:[{...contract.goals[0],target:140}]}});
 assert.equal(result.status,'applied',result.error);
 assert.equal(result.contract.economyFocus,'unity_traditions');
 assert.equal(result.contract.goals[0].target,140);
});

for(const appliedBeforeTimeout of [true,false]){
 test('same steering recovers after '+(appliedBeforeTimeout?'an applied toggle lost its reply':'an unapplied toggle failed')+' and continues reserved decisions',async()=>{
  const {game,active,writes,reserved,rows}=gameFixture();
  active.delete('cfsteer_economy_research');
  const rpc=game.rpc;
  let fail=true;
  game.rpc=async (method,params)=>{
   if(method==='toggle_edict'&&fail){
    fail=false;
    writes.push(params);
    if(appliedBeforeTimeout)active.add(params.edict_key);
    throw Error('测试模拟回读超时');
   }
   return rpc(method,params);
  };
  const next={...contract,oneOffActions:[{type:'diplo_propose',arguments:{country_id:2,action:'improve_relations'}}]};
  const first=await game.strategyControl({requestId:'attempt-1',contract:next});
  assert.equal(first.status,'attention');
  assert.deepEqual(first.nextCall,{name:'inspect',arguments:{topic:'strategy'}});
  assert.equal(reserved.length,0);
  await game.strategyControl({requestId:'attempt-1',contract:next});
  assert.equal(writes.length,1);
  const second=await game.strategyControl({requestId:'attempt-2',contract:next});
  assert.equal(second.status,'applied',second.error);
  assert.equal(writes.length,appliedBeforeTimeout?1:2);
  assert.equal(reserved.length,1);
  assert.deepEqual(rows.find(row=>row.type==='strategy_steering_retry'),{type:'strategy_steering_retry',attempt:2,requestId:'attempt-2'});
 });
}
