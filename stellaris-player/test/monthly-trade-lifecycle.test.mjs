// Implementation-only stage: prepared for the next unified acceptance, not run.
import test from 'node:test';import assert from 'node:assert/strict';
import {validateMonthlyLifecyclePolicy,monthlyLifecycleDecision,monthlyLifecycleActions,assertMonthlyLifecycleAdmission} from '../src/monthly-trade-lifecycle.mjs';
const change={operation:'set',resource:'food',action:'buy',amount:10,priceLimit:2};
const status=(stockpile=90,date='2202.07.01')=>({date:{formatted:date},resources:{food:{stockpile,stockpile_known:true}}});
const record=(policy,extra={})=>({sessionId:'s',requestId:'one',status:'order_registered',ownedOrder:{order_id:0},change,policy,before:{scope:{gameDate:'2202.07.01'}},...extra});
test('buy upper bound uses current inventory and nominal amount, not future income or double-counted net',()=>{
 const r=record({maxStockpile:100});assert.equal(monthlyLifecycleDecision(status(90),r).kind,'continue');
 assert.equal(monthlyLifecycleDecision(status(91),r).reason,'buy_inventory_boundary');assert.equal(monthlyLifecycleDecision(status(100),r).kind,'complete');
 const s=status(90);s.resources.food.net=10000;assert.equal(monthlyLifecycleDecision(s,r).kind,'continue');
});
test('sale lower bound stops before another nominal batch would cross the declared floor',()=>{
 const r=record({minStockpile:100},{change:{...change,action:'sell'}});
 assert.equal(monthlyLifecycleDecision(status(110),r).kind,'continue');assert.equal(monthlyLifecycleDecision(status(109),r).kind,'complete');assert.equal(monthlyLifecycleDecision(status(100),r).reason,'sell_inventory_boundary');
});
test('expiry uses valid forward game dates; unknown stocks and rollbacks remain unknown',()=>{
 const r=record({expiresOn:'2202.08.01'});assert.equal(monthlyLifecycleDecision(status(),r).kind,'continue');assert.equal(monthlyLifecycleDecision(status(90,'2202.08.01'),r).reason,'expired');
 assert.equal(monthlyLifecycleDecision(status(90,'2202.06.01'),r).kind,'unknown');
 assert.equal(monthlyLifecycleDecision({date:{formatted:'2202.07.01'},resources:{}},record({maxStockpile:100})).reason,'unknown_target_inventory');
});
test('lifecycle action selection never adopts manual, foreign-session or unresolved order identities',()=>{
 const a=monthlyLifecycleActions(status(100),[record({maxStockpile:100}),record({maxStockpile:100},{sessionId:'other'}),record({maxStockpile:100},{released:true}),record({maxStockpile:100},{requestId:'unknown',ownedOrder:undefined,status:'unknown'})],{sessionId:'s'});
 assert.deepEqual(a.completed.map(r=>r.orderId),[0]);assert.equal(a.unknown.length,1);assert.equal(a.unknown[0].requestId,'unknown');
});
test('expired or already crossed conditions refuse registration before any native write',()=>{
 assert.throws(()=>assertMonthlyLifecycleAdmission({status:status(100),scope:{gameDate:'2202.07.01'}},change,{maxStockpile:100}),/不允许新增/);
 for(const p of [{},{maxStockpile:-1},{minStockpile:10},{expiresOn:'2202.13.01'},{expiresOn:'2202.01.31'},{allOrders:true}])assert.throws(()=>validateMonthlyLifecyclePolicy(p,change));
 assert.throws(()=>validateMonthlyLifecyclePolicy({expiresOn:'2202.08.01'},{operation:'cancel',orderId:0}),/撤销/);
});
