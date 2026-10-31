import test from 'node:test';
import assert from 'node:assert/strict';
import {orderKey,stationSignature,stationTarget,queuedNavalBudget,mergeProblem} from '../src/operation-guards.mjs';

test('property order does not change intent identity; target refusal ignores constructor and queue',()=>{
  assert.equal(orderKey({command:'build_district',arguments:{planet_id:1,district_key:'city'}}),orderKey({arguments:{district_key:'city',planet_id:1},command:'build_district'}));
  assert.equal(stationTarget({fleet_id:1,system_id:9,station_type:'mining'}),stationTarget({fleet_id:2,system_id:9,station_type:'mining',queue:true}));
  const world={owner_id:0,planets:[{id:1,surveyed:true,deposits:[{key:'d_minerals_2'}]}]};
  assert.notEqual(stationSignature(world),stationSignature({...world,planets:[{id:1,surveyed:true,deposits:[{key:'d_minerals_3'}]}]}));
  assert.notEqual(stationSignature(world),stationSignature({...world,owner_id:1}));
  assert.equal(stationSignature({planets:[{id:2,deposits:[{key:'b'},{key:'a'}]},{id:1}]}),stationSignature({planets:[{id:1},{id:2,deposits:[{key:'a'},{key:'b'}]}]}));
});
test('queued naval points use native decimal design keys, never queue item IDs or guessed hull weights',()=>{
  const fleets={fleets:[{designs:[{design_id:9,naval_size:20}]}]};
  assert.deepEqual(queuedNavalBudget({queue:[{type:'ship',key:'9',item_id:999},{type:'colony_ship',key:'77'}]},fleets),{known:true,points:20});
  assert.equal(queuedNavalBudget({queue:[{type:'ship',key:'88'}]},fleets).known,false);
  assert.equal(queuedNavalBudget({},fleets).known,false);
  assert.equal(queuedNavalBudget({queue:[],buildable:[]},fleets).known,true);
});
test('merge budgets use actual fleet points and destination command limit',()=>{
  const tactics={fleets:[{fleet_id:3,actual_naval_size:290,command_limit:370},{fleet_id:7,actual_naval_size:215,command_limit:370}]};
  assert.match(mergeProblem([3,7],tactics),/505.*370/);
  tactics.fleets[1].actual_naval_size=70;
  assert.equal(mergeProblem([3,7],tactics),null);
  assert.match(mergeProblem([3,88],tactics),/当前己方/);
});
test('new hulls in a shipyard queue use authoritative design costs without an existing fleet template',()=>{
  const queue=[{type:'ship',key:'0',item_id:700},{type:'ship',key:'22',item_id:701},{type:'ship',key:'99',item_id:702}];
  const yard={queue,buildable:[{design_id:0,ship_size:'cruiser',naval_size:20},{design_id:99,ship_size:'science',naval_size:0}],refused:[{design_id:22,ship_size:'battleship',naval_size:40}]};
  assert.deepEqual(queuedNavalBudget(yard,{fleets:[]}),{known:true,points:60});
  yard.buildable[0].naval_size=null;
  assert.equal(queuedNavalBudget(yard,{fleets:[]}).known,false);
});
test('current yard design costs override stale fleet costs, while missing yard values retain a known fleet fallback',()=>{
  const fleets={fleets:[{designs:[{design_id:9,naval_size:20},{design_id:8,naval_size:10}]}]};
  const yard={queue:[{type:'ship',key:'9'},{type:'ship',design_id:8}],refused_designs:[{design_id:9,naval_size:25}],buildable:[{design_id:8,naval_size:null}]};
  assert.deepEqual(queuedNavalBudget(yard,fleets),{known:true,points:35});
  assert.equal(queuedNavalBudget({queue:[{type:'ship',key:'11'}],buildable:[{design_id:11,naval_size:NaN}]},fleets).known,false);
});
