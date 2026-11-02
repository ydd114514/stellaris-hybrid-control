import test from 'node:test';import assert from 'node:assert/strict';
import {NativeGame} from '../src/native-game.mjs';
import {OrderTracker} from '../src/order-tracker.mjs';

test('human非活动takeover显式暂停且native心跳继续按实际目的地刷新移动账本',async()=>{
 let paused=false,scopeValid=true,owner='human',stateReads=0;const calls=[];
 const game=Object.create(NativeGame.prototype);
 game.nativeCountryAIEnabled=true;game.countryAI={active:false,state:async()=>{stateReads++;},view:()=>({owner,paused,nativePhase:'stopped',ordinaryOrdersBlocked:false,actualFlags:{human_ai:owner!=='human',force_human_ai:false}}),takeover:async()=>{throw Error('不应重放旧AI交接')}};
 game.commandScope=async()=>{if(!scopeValid)throw Error('同scope未确认');};
 game.guard=async()=>({is_paused:paused});game.rpc=async(method,p)=>{calls.push({method,p});assert.equal(method,'set_paused');assert.equal(p.paused,true);paused=true;return{success:true};};
 game.observe=async()=>({paused});
 const result=await game.countryAIControl({operation:'takeover'});
 assert.equal(result.control.owner,'human');assert.equal(result.control.paused,true);assert.equal(result.state.paused,true);assert.equal(stateReads,2);assert.equal(calls.length,1);
 paused=false;scopeValid=false;await assert.rejects(game.countryAIControl({operation:'takeover'}),/scope/);assert.equal(calls.length,1);
 scopeValid=true;owner='unmanaged_native_ai';await assert.rejects(game.countryAIControl({operation:'takeover'}),/未确认/);assert.equal(calls.length,1);

 let now=1000,arrived=false;const tracker=new OrderTracker({sessionId:'same-session',now:()=>now});
 tracker.register({requestId:'move-once',order:{command:'move_fleet',arguments:{fleet_id:3,system_id:290}},response:{success:true},
  verification:{verified:true,phase:'fleet_order'},beforeState:{date:'2209.03.01',player:{country_id:0}}});
 const native=Object.create(NativeGame.prototype);native.now=()=>now;native.ends=1e12;native.nativeCountryAIEnabled=true;native.lastState={date:'2209.03.01',player:{country_id:0}};
 native.guard=async()=>({is_paused:false,date:{formatted:'2209.04.01'},resources:{unity:{net:20}}});
 native.countryAI={active:true,heartbeat:async()=>({owner:'native',paused:false}),view:()=>({owner:'native',paused:false})};
 native.gestalt={reconcileMoves:async()=>{},update:async()=>{},save:async()=>{}};native.orderTracker=tracker;native.trackedIntentKeys=new Map();native.log=async()=>{};
 native.rpc=async(method,p)=>{
  if(method==='get_wars')return {wars:[],warGoalsWindow:false};if(method==='get_active_events')return [];if(method==='get_pending_diplomacy')return {pending:[]};if(method==='get_traditions')return {};
  if(method==='get_system'){assert.equal(p.system_id,290);return{id:290,fleets:arrived?[{id:3,own:true}]:[]};}throw Error('不应调用写接口：'+method);
 };
 native.refreshOperatorStanding=async()=>{};native.growthTracker={record(){}};native.refreshNativeColonyAudit=async()=>{};native.reviewStrategy=()=>({});native.syncStrategyDirection=async()=>{};
 native.adviceTasks={observe(){},view:()=>({tasks:[]})};native.strategyReview={due:()=>[]};native.nativeDirector={tick:async()=>{},view:()=>({})};native.publishRuntimeHeartbeat=async()=>{};
 now=12000;await native.monitorDecision();assert.equal(tracker.view()[0].status,'executing');
 arrived=true;now=24000;await native.monitorDecision();
 assert.equal(tracker.view()[0].status,'completed');assert.equal(native.lastState.orderTracking.recent[0].proof.kind,'fleet_at_destination');
 assert.equal(tracker.view()[0].proof.systemId,290);
});
