import test from 'node:test';
import assert from 'node:assert/strict';
import {militaryExpansionProblem} from '../src/military-budget.mjs';
const status=(used,capacity,net=50,stockpile=5000)=>({stats:{naval_capacity:{used,capacity}},resources:{alloys:{net,stockpile,expense:20}}});
test('soft capacity needs projected maintenance evidence rather than positive alloy income alone',()=>{
  assert.match(militaryExpansionProblem(status(638,506)),/638\/506/);
  assert.match(militaryExpansionProblem(status(638,506)),/软限制.*维护报价/);
  assert.equal(militaryExpansionProblem(status(638,506),{inWar:true}),null);
  assert.equal(militaryExpansionProblem(status(400,506),{navalIncrease:20,alloySpend:500}),null);
});
test('a batch and reinforcement both respect real projected naval points',()=>{
  assert.match(militaryExpansionProblem(status(490,506),{navalIncrease:40}),/新增40/);
  assert.equal(militaryExpansionProblem(status(486,506),{navalIncrease:20}),null);
});
test('deficit reserve rule remains separate from naval capacity, including unknown reinforcement cost',()=>{
  assert.match(militaryExpansionProblem(status(100,506,-20,350),{alloySpend:300}),/合金正在亏损/);
  assert.match(militaryExpansionProblem(status(100,506,-20,5000),{alloySpend:null}),/亏损/);
  assert.equal(militaryExpansionProblem(status(100,506,-20,5000),{alloySpend:100}),null);
  assert.equal(militaryExpansionProblem(status(490,506,-10,100),{alloySpend:40,navalIncrease:1}),null,'95percent capacity and fixed200 do not override a funded legal batch');
  const missing=status(100,506,-20,5000);missing.resources.alloys.expense_known=false;
  assert.match(militaryExpansionProblem(missing,{alloySpend:100}),/维护未知/);
});
