import test from 'node:test';
import assert from 'node:assert/strict';
import {assertProtectedShipyardRefs} from '../src/native-country-ai-economic-policy.mjs';
import {NativeGame} from '../src/native-game.mjs';

const yard={starbase_id:0,system_id:23,queue_id:3,owner_id:0,has_shipyard:true,queue_complete:true};
const list=(rows=[yard])=>({success:true,coverage_complete:true,coverage_scope:'owned_system_starbase_shipyards',shipyards:rows});

test('shipyard protection uses full CStarbase refs, accepts zero and diagnoses other ID namespaces without remapping',()=>{
 assert.doesNotThrow(()=>assertProtectedShipyardRefs({shipyards:[0]},list(),0));
 assert.throws(()=>assertProtectedShipyardRefs({shipyards:[23]},list(),0),/system_id=23对应starbase_id=0/);
 assert.throws(()=>assertProtectedShipyardRefs({shipyards:[3]},list(),0),/queue_id=3对应starbase_id=0/);
 assert.throws(()=>assertProtectedShipyardRefs({shipyards:[0x1000000]},list(),0),/未匹配/);
 assert.doesNotThrow(()=>assertProtectedShipyardRefs({},null,undefined));
});

test('unknown ownership, missing or duplicate full refs and incomplete coverage never admit protected shipyards',()=>{
 for(const response of [list([{...yard,owner_id:1}]),list([{...yard,starbase_id:undefined}]),list([{...yard,queue_id:undefined}]),
  list([{...yard,has_shipyard:false}]),list([{...yard,queue_complete:false}]),list([yard,{...yard}]),
  {...list(),coverage_complete:false},{...list(),coverage_scope:'partial'},list([])]){
  assert.throws(()=>assertProtectedShipyardRefs({shipyards:[0]},response,0));
 }
});

test('NativeGame rejects mistaken shipyard IDs before prepare, pause or protection ledger mutation on delegate, resume and protect',async()=>{
 for(const operation of ['delegate','resume','protect']){
  const calls=[];
  const game=Object.assign(Object.create(NativeGame.prototype),{nativeCountryAIEnabled:true,lastState:{player:{country_id:0}},now:()=>1000,ends:100000,
   countryAI:{active:false,phase:'human',takeoverGeneration:1,saved:{protectedTargets:{shipyards:[23]}},
    delegate:async()=>assert.fail('must reject before prepare'),resume:async()=>assert.fail('must reject before resume'),protect:async()=>assert.fail('must reject before storing protection')},
   rpc:async method=>{calls.push(method);assert.equal(method,'get_shipyards');return list();}});
  await assert.rejects(game.countryAIControl({operation,...operation==='resume'?{}:{protectedTargets:{shipyards:[23]}},reason:'保留特定船坞'}),/system_id=23对应starbase_id=0/);
  assert.deepEqual(calls,['get_shipyards']);assert.deepEqual(game.countryAI.saved.protectedTargets,{shipyards:[23]});
 }
});

test('a fresh owned starbase reference passes unchanged while the native arm retains its final ownership validation',async()=>{
 let delegated;const calls=[];
 const game=Object.assign(Object.create(NativeGame.prototype),{nativeCountryAIEnabled:true,lastState:{player:{country_id:0}},now:()=>1000,ends:100000,
  countryAI:{active:false,delegate:async value=>{delegated=value;},view:()=>({owner:'native'})},observe:async()=>({}),
  rpc:async(method)=>{calls.push(method);if(method==='get_shipyards')return list();if(method==='set_paused')return {success:true};
   if(method==='get_active_events')return [];if(method==='get_wars')return {wars:[],warGoalsWindow:false};assert.fail(method);}});
 await game.countryAIControl({operation:'delegate',protectedTargets:{shipyards:[0]}});
 assert.deepEqual(delegated.protectedTargets,{shipyards:[0]});assert.equal(calls[0],'get_shipyards');
});
