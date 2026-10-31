// Actual-cost admission: isolated fixtures, never game writes.
import test from 'node:test';import assert from 'node:assert/strict';
import {checkActualSpending,readActualSpendingCost,hasSpendingReservations} from '../src/shared-spending-guard.mjs';
const status={resources:{minerals:{stockpile:1000,net:-10,stockpile_known:true,net_known:true}}};
test('actual cost counts other commitments and maintenance while subtracting own allocation exactly once',()=>{
 const r=checkActualSpending({cost:{minerals:500},status,commitments:{minerals:700},floors:{minerals:100},task:{status:'ready',budget:{minerals:500}}});
 assert.equal(r.rows[0].available,670);assert.equal(r.rows[0].otherReserved,200);assert.equal(r.rows[0].maintenance,30);assert.equal(r.hardNativeBudget,false);
 assert.throws(()=>checkActualSpending({cost:{minerals:700},status,commitments:{minerals:900},floors:{minerals:100},task:{status:'ready',budget:{minerals:700}}}),/占用其他/);
});
test('empty declared budgets and unknown or under-covered allocations cannot authorize actual spending',()=>{
 for(const task of [{status:'ready',budget:{}},{status:'ready',budget:{minerals:499}},{status:'cancelled',budget:{minerals:500}}])assert.throws(()=>checkActualSpending({cost:{minerals:500},status,commitments:{minerals:500},task}));
 assert.throws(()=>checkActualSpending({cost:{minerals:500},status,commitments:{minerals:0},task:{status:'ready',budget:{minerals:500}}}),/覆盖未知/);
 assert.throws(()=>checkActualSpending({cost:{minerals:1},status:{resources:{minerals:{stockpile:1000,net:0,stockpile_known:false}}}}),/未知/);
 assert.throws(()=>checkActualSpending({cost:{},status}),/费用未知/);
 assert.equal(hasSpendingReservations({commitments:{minerals:1}}),true);assert.equal(hasSpendingReservations({floors:{minerals:1}}),true);assert.equal(hasSpendingReservations({}),false);
});
test('ship spending protects an actual expense cycle or deficit reserve without adding both twice',()=>{
 const status={resources:{alloys:{stockpile:550,net:-50,expense:100}}};
 const r=checkActualSpending({cost:{alloys:400},status,expenseCycle:true});
 assert.equal(r.rows[0].maintenance,150);assert.equal(r.rows[0].available,400);assert.equal(r.rows[0].upkeepExpenseCycle,100);
 assert.throws(()=>checkActualSpending({cost:{alloys:401},status,expenseCycle:true}),/维护底线/);
 status.resources.alloys.net=10;status.resources.alloys.expense=200;
 assert.throws(()=>checkActualSpending({cost:{alloys:351},status,expenseCycle:true}),/维护底线/);
 for(const change of [{expense:undefined},{expense:-1},{expense_known:false}])assert.throws(()=>checkActualSpending({cost:{alloys:1},status:{resources:{alloys:{...status.resources.alloys,...change}}},expenseCycle:true}),/维护支出周期未知/);
 const mixed={resources:{...status.resources,rare_crystals:{stockpile:11,net:1,expense:2}}};
 assert.throws(()=>checkActualSpending({cost:{alloys:100,rare_crystals:10},status:mixed,expenseCycle:true}),/维护底线：rare_crystals/);
 const own=checkActualSpending({cost:{alloys:100},status,expenseCycle:true,commitments:{alloys:200},floors:{alloys:50},task:{status:'ready',budget:{alloys:100}}});
 assert.equal(own.rows[0].otherReserved,100);assert.equal(own.rows[0].available,200);
});
test('live district and instance-specific building costs use exact candidates, IDs including zero, and full ship quantity',async()=>{
 const cost=await readActualSpendingCost({command:'build_district',arguments:{planet_id:0,district_key:'district_city'}},async()=>({success:true,planet_id:0,buildable:[{key:'district_city',can_build:true,cost:{minerals:500}}]}));assert.deepEqual(cost,{minerals:500});
 const upgrade={command:'upgrade_building',arguments:{planet_id:0,building_id:0,upgrade_key:'building_2'}};
 assert.deepEqual(await readActualSpendingCost(upgrade,async()=>({success:true,planet_id:0,candidates:[{building_id:0,upgrade_key:'building_2',can_upgrade:true,cost:{minerals:300,alloys:50}}]})),{minerals:300,alloys:50});
 await assert.rejects(readActualSpendingCost(upgrade,async()=>({success:true,planet_id:0,candidates:[{building_id:1,upgrade_key:'building_2',can_upgrade:true,cost:{minerals:1}}]})),/唯一合法/);
 assert.deepEqual(await readActualSpendingCost({command:'build_ship',arguments:{system_id:0,design_id:0,count:3}},async()=>({success:true,buildable:[{design_id:0,can_build:true,cost:{alloys:100}}]})),{alloys:300});
});
test('instant trade uses fee-inclusive current quote and sale consumes inventory without banking future proceeds',async()=>{
 const rpc=async m=>m==='get_market'?{settlement_currency:'trade'}:{success:true,price_basis:'engine_transaction_total',resource:'food',action:'buy',units:100,settlement_currency:'trade',includes_fee:true,total:130};
 assert.deepEqual(await readActualSpendingCost({command:'market_trade',arguments:{resource:'food',action:'buy',units:100}},rpc),{trade:130});
 const sale=async m=>m==='get_market'?{settlement_currency:'trade'}:{success:true,price_basis:'engine_transaction_total',resource:'food',action:'sell',units:100,settlement_currency:'trade',includes_fee:true,total:70};
 assert.deepEqual(await readActualSpendingCost({command:'market_trade',arguments:{resource:'food',action:'sell',units:100}},sale),{food:100});
 await assert.rejects(readActualSpendingCost({command:'clear_blocker',arguments:{planet_id:0,blocker_key:'x'}},rpc),/尚无/);
});

test('claim costs require the exact native one-claim quote, including fixed precision and legality',async()=>{
 const order={command:'claim_system',arguments:{system_id:0}},q={success:true,system_id:0,action:'add',count:1,legal:true,cost_basis:'engine_add_system_claim_cost',influence_cost_fixed:5500123,cost:{influence:55.00123}};
 assert.deepEqual(await readActualSpendingCost(order,async(m,p)=>{assert.equal(m,'get_claim_quote');assert.equal(p.system_id,0);return q;}),q.cost);
 for(const patch of [{system_id:1},{count:2},{legal:false},{influence_cost_fixed:-1},{cost_basis:'estimate'},{cost:{influence:55}},{cost:{influence:55.00123,alloys:1}}])await assert.rejects(readActualSpendingCost(order,async()=>({...q,...patch})),/宣称实时费用/);
 assert.deepEqual(await readActualSpendingCost({command:'claim_system',arguments:{system_id:0,remove:true}},async()=>{throw Error('no quote for removal');}),{influence:0});
 assert.throws(()=>checkActualSpending({cost:q.cost,status:{resources:{influence:{stockpile:100,net:1}}},commitments:{influence:50},floors:{influence:0}}),/维护底线/);
});
