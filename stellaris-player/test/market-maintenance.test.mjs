import test from 'node:test';import assert from 'node:assert/strict';import {routineSalePlan,recoveryPurchasePlan} from '../src/market-maintenance.mjs';
test('full productive energy plans meaningful headroom rather than repeating tiny sales',()=>{
 const p=routineSalePlan({stockpile:35000,max:35000,net:341.58,expense:1000},{batchSize:100});
 assert.equal(p.suggestedTotalUnits,10500);assert.equal(p.firstOrderUnitsUpperBound,5000);assert.equal(p.minimumChunksAtOrderLimit,3);assert.ok(p.monthsToHighWaterAfterPlan>24);assert.equal(p.executable,false);assert.equal(p.requiresFreshWholeQuote,true);
});
test('below high water does not suggest topping up maintenance after a completed sale',()=>{
 assert.equal(routineSalePlan({stockpile:24500,max:35000,net:341.58},{batchSize:100}).action,'hold');
});
test('rapid production retains actual upkeep and commitments even when24months cannot fit',()=>{
 const r={stockpile:1000,max:1000,net:500,expense:100};
 const p=routineSalePlan(r,{batchSize:100});assert.equal(p.suggestedTotalUnits,900);assert.equal(p.reserve,100);assert.ok(p.monthsToHighWaterAfterPlan<24);
 const committed=routineSalePlan(r,{batchSize:100,commitments:500,floor:200});assert.equal(committed.suggestedTotalUnits,200);assert.equal(committed.reserve,800);
});
test('full settlement, deficits and unknown capacity do not create automatic sale permission',()=>{
 const r={stockpile:25000,max:25000,net:200,expense:100};assert.equal(routineSalePlan(r,{batchSize:100,settlement:{stockpile:60000,max:60000}}).action,'hold');assert.equal(routineSalePlan({...r,net:-10},{batchSize:100}).action,'hold');assert.equal(routineSalePlan({...r,max:undefined},{batchSize:100}).action,'hold');assert.equal(routineSalePlan({...r,expense:undefined},{batchSize:100}).action,'hold');
 assert.equal(routineSalePlan(r,{batchSize:100,settlement:{stockpile:59000,max:60000}}).action,'consider_sell');
});

test('postwar purchases target protected stock plus maintenance, in legal bounded batches',()=>{
 const market={settlement_currency:'trade',resources:[{key:'energy',batch_size:100}]},r={energy:{stockpile:4200,net:-100,max:25000}};
 const p=recoveryPurchasePlan(r,{energy:8000},market);assert.deepEqual(p.order.arguments,{resource:'energy',action:'buy',units:4100});assert.equal(p.settlement,'trade');
 assert.equal(recoveryPurchasePlan({energy:{stockpile:8600,net:-100,max:25000}},{energy:8000},market).order,undefined);
 assert.equal(recoveryPurchasePlan({energy:{stockpile:0,net:-100,max:25000}},{energy:8000},market).order.arguments.units,5000);
 assert.ok(recoveryPurchasePlan(r,{energy:8000},{resources:[]}).blocked);
 assert.ok(recoveryPurchasePlan(r,{energy:NaN},market).blocked);
 assert.ok(recoveryPurchasePlan({energy:{stockpile:990,max:1000,net:-1}},{energy:999},market).blocked);
});
