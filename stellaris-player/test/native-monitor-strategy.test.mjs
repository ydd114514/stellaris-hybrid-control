import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeGame} from '../src/native-game.mjs';
import {NativeColonyAudit} from '../src/native-colony-audit.mjs';
import {NativeStrategyReview} from '../src/native-strategy-review.mjs';
import {createGrowthTracker} from '../src/strategic-review.mjs';
import {resolveStrategyDirection} from '../src/strategy-direction.mjs';

test('native watch monitoring refreshes economy, colony ages and strategy before applying the next direction without refreshing the full snapshot',async()=>{
 let now=100000,planetReads=0,published=0,records=0,syncs=0;
 const resources=net=>Object.fromEntries(['energy','minerals','food','alloys','unity','physics_research','society_research','engineering_research'].map(key=>[key,{stockpile:1000,net:key==='unity'?net:10,income:key==='unity'?24.44:10,expense:key==='unity'?5.4:0,net_known:true}]));
 const old={snapshotId:'original-full-snapshot',date:'2200.01.01',economyObservedAt:50000,player:{country_id:0,capital_system_id:1,owned_systems:1},resources:resources(20.5),
  colonies:[{colonies_summary:[{planet_id:3,is_colonizing:false}]}],capacities:{colonies:1,empire_size:60},wars:[]};
 const audit=new NativeColonyAudit();
 old.colonyAudit=await audit.review(old,{rpc:async()=>{planetReads++;return {planet_id:3,name:'首都',kpi:{pop_groups:10,housing:100,amenities:-2,unemployed:0}};}});
 const tracker=createGrowthTracker(),record=tracker.record.bind(tracker);tracker.record=s=>{records++;record(s);};tracker.record(old);
 let status={date:{formatted:'2200.02.03'},resources:resources(19.04),stats:{colonies:2,empire_size:65},
  outliner:{sectors_summary:{sectors:[{colonies_summary:[{planet_id:3,is_colonizing:false},{planet_id:4,is_colonizing:true}]}]}},
  society:{unlocked_traditions_count:0,next_tradition_cost:300,next_tradition_cost_known:true}};
 const control={owner:'native',paused:false,generation:1};
 const game=Object.assign(Object.create(NativeGame.prototype),{now:()=>now,ends:Infinity,directory:'.',nativeCountryAIEnabled:true,
  lastState:old,snapshotAt:50000,nativeColonyAudit:audit,growthTracker:tracker,colonyReviews:new Map(),government:{authority:'auth_hive_mind'},
  countryAI:{active:true,heartbeat:async()=>control,view:()=>control,takeover:async()=>assert.fail('monitoring must retain native ownership')},
  guard:async()=>status,strategyReview:new NativeStrategyReview(),
  modelStrategyContract:{economyFocus:'research',expansionStance:'aggressive',militaryStance:'peaceful',oneOffActions:[],reason:'原模型方向'},
  strategyContract:{economyFocus:'balanced',expansionStance:'aggressive',militaryStance:'peaceful',steeringConfirmed:true},
  operationalContext:{record:()=>{},view:()=>[]},
  refreshOperatorStanding:async s=>{s.operatorStanding={economyFocus:'unity_traditions'};},
  syncStrategyDirection:async s=>{
   syncs++;assert.equal(s.strategy.unityProgress.net,19);assert.equal(s.strategy.unityProgress.focused,true);
   assert.equal(s.strategy.expansionHealth.date,s.date);assert.equal(s.colonyAudit.colonies[0].ageDays,32);
   game.strategyContract={...resolveStrategyDirection({state:s,contract:game.modelStrategyContract}).contract,steeringConfirmed:true};
   s.strategyContract=game.strategyContract;
  },
  rpc:async method=>{
   if(method==='get_wars')return {wars:[],warGoalsWindow:false};
   if(method==='get_active_events')return [];
   if(method==='get_pending_diplomacy')return {pending:[]};
   if(method==='get_traditions')return {ascension_perks:{adopted:[]}};
   assert.fail('unexpected native call: '+method);
  },publishRuntimeHeartbeat:async()=>{published++;}});
 await game.monitorDecision();
 assert.equal(game.lastState.economyObservedAt,100000);assert.equal(game.lastState.resources.unity.net,19.04);
 assert.equal(game.lastState.capacities.colonies,2);assert.equal(game.lastState.colonies[0].colonies_summary.length,2);
 assert.equal(game.lastState.traditions.next_tradition_cost_known,true);assert.equal(game.lastState.traditions.edict_fund,null);
 assert.equal(game.lastState.strategy.currentContract.economyFocus,'unity_traditions');assert.equal(game.lastState.strategy.currentContract.expansionStance,'consolidate');
 assert.equal(game.lastState.strategy.ordinaryExpansionAllowed,false);assert.equal(game.lastState.warGoalsWindow,false);
 assert.equal(planetReads,1);assert.equal(records,2);assert.equal(syncs,1);assert.equal(published,1);
 assert.equal(game.snapshotAt,50000);assert.equal(game.lastState.snapshotId,'original-full-snapshot');
 now=101000;status={...status,resources:undefined};await game.monitorDecision();
 assert.equal(game.lastState.economyObservedAt,100000);assert.equal(records,2);assert.equal(planetReads,1);
});
