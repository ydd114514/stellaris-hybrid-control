import test from 'node:test';
import assert from 'node:assert/strict';
import {delegationResourceRisks} from '../src/delegation-budget.mjs';
const healthy=()=>({resources:Object.fromEntries(['energy','alloys','food','trade','unity'].map(k=>[k,{stockpile:1000,net:10}]))});
test('healthy reserves admit zero-spend survey while keeping existing commitments',()=>{
 assert.deepEqual(delegationResourceRisks(healthy(),{commitments:{alloys:500},floors:{alloys:200}}),[]);
});
test('commitments plus maintenance and floor must all fit actual inventory',()=>{
 const state=healthy();state.resources.alloys.net=-50;
 assert.equal(delegationResourceRisks(state,{commitments:{alloys:800},floors:{alloys:100},maintenanceMonths:3})[0].required,1050);
});
test('depleted deficit and unknown resource data require attention',()=>{
 const state=healthy();state.resources.energy={stockpile:0,net:-1};delete state.resources.food;
 const r=delegationResourceRisks(state);assert.ok(r.some(x=>x.resource==='energy'&&x.kind==='resource_reserve_shortfall'));
 assert.ok(r.some(x=>x.resource==='food'&&x.kind==='resource_status_unknown'));
});
test('invalid policy cannot manufacture spending headroom',()=>{
 assert.ok(delegationResourceRisks(healthy(),{commitments:{alloys:-10}}).length);
 assert.ok(delegationResourceRisks(healthy(),{floors:{trade:NaN}}).length);
});
test('explicit failed native reads cannot become healthy zeroes or plausible finite balances',()=>{
 for(const [flag,value] of [['stockpile_known',false],['net_known',false]])for(const stockpile of [0,1000]){
  const state=healthy();state.resources.energy={stockpile,net:0,[flag]:value};
  assert.ok(delegationResourceRisks(state).some(r=>r.kind==='resource_status_unknown'&&r.resource==='energy'));
 }
});
