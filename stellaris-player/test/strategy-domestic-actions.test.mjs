import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {validateStrategyContract,applyDomesticEdict,strategyContractSchema} from '../src/strategy-contract.mjs';
import {NativeGame,validateOrder} from '../src/native-game.mjs';

const action=(key='nutritional_plenitude',enabled=false)=>({type:'toggle_edict',arguments:{edict_key:key,enabled}});
const currentDate='2250.01.01';
const contract=domesticActions=>({goals:[{metric:'alloys_monthly',target:20,byDate:'2251.01.01'}],economyFocus:'unity_traditions',expansionStance:'consolidate',militaryStance:'peaceful',oneOffActions:[],reason:'按当前岗位和资源结算撤销收益不足的法令',domesticActions});
const edicts=(keys,extra={})=>({summary:{active_edicts_count:keys.length},active_edicts:keys.map(key=>({key})),...extra});

test('domestic settings are optional, bounded and cannot alter steering or system role edicts',()=>{
 assert.deepEqual(validateStrategyContract(contract([action()]),validateOrder,{currentDate}).domesticActions,[action()]);
 assert.equal(strategyContractSchema.properties.domesticActions.maxItems,4);
 for(const actions of [[action('cfsteer_economy_unity_traditions')],[action('relay_network_dummy')],[action('system_role_maintenance')],
  [action(),action()],[action(),action('capacity_subsidies'),action('mining_subsidies'),action('farming_subsidies'),action('forge_subsidies')],
  [{type:'set_policy',arguments:{}}],[{...action(),extra:true}],[{type:'toggle_edict',arguments:{edict_key:'nutritional_plenitude',enabled:false,country_id:1}}]]){
  assert.throws(()=>validateStrategyContract(contract(actions),validateOrder,{currentDate}));
 }
});

test('ordinary cancellation uses a fresh complete active list and confirms actual removal',async()=>{
 const keys=new Set(['nutritional_plenitude','cfsteer_economy_unity_traditions','relay_network_dummy']);
 let reads=0,scopes=0,heartbeats=0;const writes=[];
 const result=await applyDomesticEdict({action:action(),checkScope:async()=>{scopes++;},heartbeat:async()=>{heartbeats++;},
  rpc:async method=>{assert.equal(method,'get_edicts');reads++;return edicts([...keys]);},
  write:async(method,params)=>{writes.push({method,params});keys.delete(params.edict_key);return {success:true};}});
 assert.equal(result.status,'confirmed');assert.equal(result.changed,true);assert.equal(reads,2);assert.equal(writes.length,1);
 assert.ok(scopes>=3&&heartbeats>=3);assert.deepEqual([...keys],['cfsteer_economy_unity_traditions','relay_network_dummy']);
});

test('a task cannot be ended or marked blocked while issuing an action for that same task',()=>{
 for(const status of ['blocked','superseded']){
  assert.throws(()=>validateStrategyContract({...contract([{...action(),taskId:'task-1'}]),taskUpdates:[{taskId:'task-1',status,reason:'该目标不再执行'}]},validateOrder,{currentDate}),/不能.*继续下达/);
 }
});

test('partial state, explicit removal refusal and unverified activation never dispatch',async()=>{
 for(const [requested,raw,message] of [
  [action(),{summary:{active_edicts_count:2},active_edicts:[{key:'nutritional_plenitude'}]},/不完整/],
  [action(),edicts(['nutritional_plenitude'],{available_edicts:[{key:'nutritional_plenitude',can_deactivate:false}]}),/不可停用/],
  [action('capacity_subsidies',true),edicts([],{available_edicts:[{key:'capacity_subsidies',is_active:false}]}),/未确认/]
 ]){
  let writes=0;const receipt={};
  await assert.rejects(applyDomesticEdict({action:requested,receipt,rpc:async()=>raw,write:async()=>{writes++;return {success:true};}}),message);
  assert.equal(writes,0);assert.equal(receipt.status,'rejected');assert.equal(receipt.confirmed,false);
 }
});

test('an explicitly legal activation is read back; a posted unconfirmed removal is never replayed',async()=>{
 const keys=new Set();let writes=0;
 const result=await applyDomesticEdict({action:action('capacity_subsidies',true),
  rpc:async()=>edicts([...keys],{available_edicts:[{key:'capacity_subsidies',can_activate:true}]}),
  write:async(_method,params)=>{writes++;keys.add(params.edict_key);return {success:true};}});
 assert.equal(result.confirmed,true);assert.equal(writes,1);
 const receipt={};writes=0;
 await assert.rejects(applyDomesticEdict({action:action(),receipt,attempts:2,wait:async()=>{},
  rpc:async()=>edicts(['nutritional_plenitude']),write:async()=>{writes++;return {success:true};}}),/尚未确认/);
 assert.equal(writes,1);assert.equal(receipt.status,'unknown');assert.equal(receipt.confirmed,false);
});

function fixture({writeError,scopeError}={}){
 const keys=new Set(['nutritional_plenitude','cfsteer_economy_unity_traditions','relay_network_dummy']),calls=[];
 let scopes=0;const game=Object.create(NativeGame.prototype);
 Object.assign(game,{nativeCountryAIEnabled:true,nativeCountryAIFence:true,now:()=>1,lastState:{date:'2250.01.01'},
  countryAI:{view:()=>({owner:'native'}),heartbeat:async()=>{},acknowledgeReview:async()=>{}},
  commandScope:async()=>{scopes++;if(scopeError&&scopes>1)throw Error('发送前玩家或首都身份改变');},
  refreshOperatorStanding:async()=>{},syncStrategyDirection:async()=>({confirmed:true}),checkpoint:async()=>{},strategyReview:{acknowledge(){}},
  rpc:async(method,params={})=>{
   NativeGame.prototype.assertRpcAllowed.call(game,method,params);calls.push({method,params});
   if(method==='get_country_ai_state')return {success:true,precondition:game.readWorld??game.boundNativeWorld};
   if(method==='get_edicts')return edicts([...keys]);
   assert.equal(method,'toggle_edict');assert.throws(()=>game.assertRpcAllowed('build_ship',{}),/封口/);
   if(writeError)throw Error(typeof writeError==='string'?writeError:'pipe timeout');keys.delete(params.edict_key);return {success:true};
  }});
 return {game,keys,calls};
}

test('StrategyContract alone authorizes the exact edict write while native AI and routine fences stay on',async()=>{
 const {game,keys,calls}=fixture(),input={requestId:'ordinary-1',contract:contract([action()])};
 assert.throws(()=>game.assertRpcAllowed('toggle_edict',action().arguments),/封口/);
 const result=await game.strategyControl(input);
 assert.equal(result.status,'applied');assert.equal(result.domesticActions[0].confirmed,true);assert.equal(game.countryAI.view().owner,'native');
 assert.equal(keys.has('nutritional_plenitude'),false);assert.equal(keys.has('relay_network_dummy'),true);
 assert.throws(()=>game.assertRpcAllowed('toggle_edict',action().arguments),/封口/);
 await game.strategyControl(input);assert.equal(calls.filter(c=>c.method==='toggle_edict').length,1);
});

test('world changes block domestic writes and a timeout receipt cannot replay the same request',async()=>{
 const changed=fixture({scopeError:true});
 const blocked=await changed.game.strategyControl({requestId:'changed',contract:contract([action()])});
 assert.equal(blocked.status,'attention');assert.equal(blocked.domesticActions[0].status,'rejected');
 assert.equal(changed.calls.some(c=>c.method==='toggle_edict'),false);
 const {game,calls}=fixture({writeError:true}),input={requestId:'unknown',contract:contract([action(),action('capacity_subsidies')])};
 const result=await game.strategyControl(input);assert.equal(result.status,'attention');assert.equal(result.domesticActions[0].status,'unknown');
 await game.strategyControl(input);assert.equal(calls.filter(c=>c.method==='toggle_edict').length,1);
 await game.strategyControl({...input,requestId:'unknown-new-id'});assert.equal(calls.filter(c=>c.method==='toggle_edict').length,1);
 assert.throws(()=>game.assertRpcAllowed('toggle_edict',action().arguments),/封口/);
});

test('public strategy execution is persisted with a fixed execution date and cleared on a different world',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'strategy-execution-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const {game}=fixture();Object.assign(game,{directory,binding:{pid:17,creationTime:'process-17'},boundNativeWorld:{country_id:7,world_generation:1},
  gestalt:{file:'tasks.json'},continuity:{save:async()=>{}},growthTracker:{serialize:()=>({})},stationFailures:new Map()});
 await game.strategyControl({requestId:'receipt-1',contract:contract([action()])});
 const receipt=game.strategyExecutionView();assert.equal(receipt.requestId,'receipt-1');assert.equal(receipt.status,'applied');assert.equal(receipt.steeringConfirmed,true);
 assert.deepEqual(receipt.domesticActions,[{type:'toggle_edict',edictKey:'nutritional_plenitude',enabled:false,status:'confirmed',confirmed:true,changed:true,error:null}]);
 game.lastGameDate='2251.01.01';assert.equal(game.strategyExecutionView().date,'2250.01.01');
 await NativeGame.prototype.checkpoint.call(game);
 let persisted=JSON.parse(await readFile(join(directory,'latest-session.json'),'utf8'));
 assert.deepEqual(persisted.strategyExecution,receipt);assert.deepEqual(persisted.state.strategyExecution,receipt);
 game.readWorld={country_id:7,world_generation:2};await assert.rejects(game.assertNativeWorld(),/世界代次/);
 assert.equal(game.strategyExecutionView(),null);assert.equal(game.lastState.strategyExecution,null);
 await NativeGame.prototype.checkpoint.call(game);persisted=JSON.parse(await readFile(join(directory,'latest-session.json'),'utf8'));
 assert.equal(persisted.strategyExecution,null);assert.equal(persisted.state.strategyExecution,null);
 const failed=fixture({writeError:'pipe timeout token=private-transport-detail'}).game;
 Object.assign(failed,{binding:game.binding,boundNativeWorld:game.boundNativeWorld});
 await failed.strategyControl({requestId:'receipt-error',contract:contract([action()])});
 const safe=failed.strategyExecutionView();assert.equal(safe.status,'attention');assert.equal(safe.domesticActions[0].status,'unknown');
 assert.match(safe.error,/未确认/);assert.doesNotMatch(JSON.stringify(safe),/private-transport-detail|arguments|binding|world_generation/);
 failed.binding={pid:18,creationTime:'process-18'};assert.equal(failed.strategyExecutionView(),null);
});
