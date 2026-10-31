import test from 'node:test';import assert from 'node:assert/strict';
import {checkQuotedTrade,tradeBudgetPreview} from '../src/trade-spending-policy.mjs';
function fixture(action='sell'){
 const params={resource:'food',action,units:100};
 return {params,market:{settlement_currency:'trade',resources:[{key:'food',batch_size:100}]},quote:{success:true,resource:'food',action,units:100,settlement_currency:'trade',total:70,price_basis:'engine_transaction_total',includes_fee:true},status:{resources:{food:{stockpile:3062,max:15000,net:95,expense:52.78,stockpile_known:true,net_known:true},trade:{stockpile:1971.51,max:50000,net:59.67,expense:119.34,stockpile_known:true,net_known:true}}}};
}
test('surplus sales retain actual expense cushion rather than a percentage of storage',()=>{
 const f=fixture();const result=checkQuotedTrade(f);assert.equal(result.upkeep.reserved,52.78);assert.equal(result.rows[0].available,3062-52.78);
 f.status.resources.food.max=1500000;assert.equal(checkQuotedTrade(f).rows[0].available,result.rows[0].available);
});
test('market budget hints expose protected amounts without inventing quote or task authority',()=>{
 const row=fixture().status.resources.food;
 const p=tradeBudgetPreview(row,{commitments:500,floor:100});assert.equal(p.advisoryOnly,true);assert.equal(p.requiresWholeQuote,true);assert.equal(p.protectedStock,652.78);assert.equal(p.availableAfterAllCommitments,3062-652.78);
 const unknown=tradeBudgetPreview({...row,expense:undefined});assert.equal(unknown.known,false);assert.equal(unknown.availableAfterAllCommitments,undefined);
});
test('planned buys may leave less than500 currency when actual upkeep and commitments remain covered',()=>{
 const f=fixture('buy');f.status.resources.trade={stockpile:600,max:50000,net:50,expense:100};f.quote.total=300;
 assert.equal(checkQuotedTrade(f).rows[0].available,500);
 f.quote.total=501;assert.throws(()=>checkQuotedTrade(f),/维护底线/);
});
test('one expense cycle and three-month negative net are not added twice',()=>{
 const f=fixture();f.status.resources.food.net=-20;f.status.resources.food.expense=100;
 assert.equal(checkQuotedTrade(f).upkeep.reserved,100);
 assert.equal(checkQuotedTrade(f).rows[0].available,3062-100);
 f.status.resources.food.net=-80;assert.equal(checkQuotedTrade(f).upkeep.reserved,240);assert.equal(checkQuotedTrade(f).rows[0].available,3062-240);
});
test('other promises and strategic floor remain protected while own task allocation is excluded once',()=>{
 const f=fixture();f.status.resources.food.stockpile=400;
 f.commitments={food:200};f.floors={food:100};f.task={status:'ready',budget:{food:100}};
 const result=checkQuotedTrade(f);assert.equal(result.rows[0].otherReserved,100);assert.equal(result.rows[0].available,400-100-100-52.78);
 f.task.budget.food=0;assert.throws(()=>checkQuotedTrade(f),/空预算/);
 f.task.budget.food=100;f.status.resources.food.stockpile=300;assert.throws(()=>checkQuotedTrade(f),/其他任务/);
});
test('only actual receiving capacity prevents overflow, with no95or98percent pseudo-cap',()=>{
 const buy=fixture('buy');buy.status.resources.food.stockpile=14900;assert.doesNotThrow(()=>checkQuotedTrade(buy));
 buy.status.resources.food.stockpile=14901;assert.throws(()=>checkQuotedTrade(buy),/仓储上限/);
 const sell=fixture();sell.status.resources.trade.stockpile=49930;assert.doesNotThrow(()=>checkQuotedTrade(sell));
 sell.status.resources.trade.stockpile=49931;assert.throws(()=>checkQuotedTrade(sell),/仓储上限/);
});
test('unknown costs, real upkeep, stock, cap, batch or quote identity cannot authorize a trade',()=>{
 for(const change of [f=>f.quote.includes_fee=false,f=>f.quote.total=NaN,f=>f.quote.units=200,f=>f.status.resources.food.expense=undefined,f=>f.status.resources.food.expense=-1,f=>f.status.resources.food.net_known=false,f=>f.status.resources.trade.max=undefined,f=>f.status.resources.trade.stockpile_known=false,f=>f.params.units=101]){
  const f=fixture();change(f);assert.throws(()=>checkQuotedTrade(f));
 }
});
