import test from 'node:test';import assert from 'node:assert/strict';
import {monthlyTradeAccounting} from '../src/monthly-trade-accounting.mjs';
const row=(stockpile,net)=>({stockpile,net,stockpile_known:true,net_known:true,net_basis:'engine_total_including_monthly_trade'});
const world=()=>({resources:{trade:row(1000,50),food:row(200,-10)}});
const market=(orders=[])=>({monthly_trade_country_id:0,monthly_trades_complete:true,active_monthly_trades_count:orders.length,monthly_trades:orders,settlement_currency:'trade'});
const order=(order_id=0,action='buy')=>({order_id,resource:'food',action,amount:100,max_unit_price:0});
test('confirmed empty orders differ from an unread or legacy empty list, and country zero is valid',()=>{
 assert.equal(monthlyTradeAccounting(world(),market(),{countryId:0}).ordersKnown,true);
 for(const m of [{monthly_trades:[]}, {...market(),monthly_trades_complete:false},{...market(),monthly_trade_country_id:1},{...market(),active_monthly_trades_count:1}]){
  const a=monthlyTradeAccounting(world(),m,{countryId:0});assert.equal(a.ordersKnown,false);assert.equal(a.budgetKnown,false);
 }
});
test('existing monthly quantities never get added twice to engine net or spendable cash',()=>{
 const r=monthlyTradeAccounting(world(),market([order()]),{countryId:0,commitments:{trade:100},floors:{trade:200},months:3});
 assert.equal(r.budgetKnown,true);const food=r.projections.find(x=>x.resource==='food'),cash=r.projections.find(x=>x.resource==='trade');
 assert.equal(food.projectedStockpile,170);assert.equal(cash.projectedStockpile,1150);assert.equal(cash.spendableNow,700);assert.equal(cash.reserveStressBalance,700);assert.equal(r.recurringWritesEnabled,false);
});
test('parallel orders keep separate identities; duplicate identities and malformed fields are unknown',()=>{
 assert.equal(monthlyTradeAccounting(world(),market([order(0),order(1,'sell')]),{countryId:0}).observedOrders.length,2);
 for(const orders of [[order(),order()],[{...order(),amount:0}],[{...order(),action:'maybe'}],[{...order(),max_unit_price:-1}],[{...order(),order_id:-1}]])assert.equal(monthlyTradeAccounting(world(),market(orders),{countryId:0}).ordersKnown,false);
});
test('unknown native reads, absent settlement and invalid reserves never become zero obligations',()=>{
 for(const patch of [{net_known:false},{stockpile_known:false},{net_basis:undefined},{net:NaN}]){
  const s=world();Object.assign(s.resources.trade,patch);assert.equal(monthlyTradeAccounting(s,market(),{countryId:0}).budgetKnown,false);
 }
 const s=world();delete s.resources.trade;assert.equal(monthlyTradeAccounting(s,market([order()]),{countryId:0}).budgetKnown,false);
 assert.equal(monthlyTradeAccounting(world(),{...market(),settlement_currency:undefined},{countryId:0}).budgetKnown,false);
 assert.equal(monthlyTradeAccounting(world(),market(),{countryId:0,commitments:{food:-1}}).budgetKnown,false);
});
test('future positive proceeds are only a trend, while reserves and negative carry trigger risk',()=>{
 const s=world();s.resources.trade=row(10,1000);
 const r=monthlyTradeAccounting(s,market(),{countryId:0,floors:{trade:20,food:190},months:3});
 const cash=r.projections.find(x=>x.resource==='trade'),food=r.projections.find(x=>x.resource==='food');
 assert.equal(cash.spendableNow,0);assert.equal(cash.projectedStockpile,3010);assert.equal(cash.reserveAtRisk,true);assert.equal(food.reserveAtRisk,true);
 assert.throws(()=>monthlyTradeAccounting(s,market(),{months:0}),/1..24/);
});
