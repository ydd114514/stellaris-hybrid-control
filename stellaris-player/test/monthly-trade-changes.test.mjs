import test from 'node:test';import assert from 'node:assert/strict';
import {previewMonthlyChange,reconcileMonthlyChange,validateMonthlyChange} from '../src/monthly-trade-changes.mjs';
const scope={sessionId:'session',pid:42,creationTime:'fixed',gameDate:'2200.01.01'};
const options={countryId:0,scope};
const row=(order_id,amount=100)=>({order_id,resource:'food',action:'buy',amount,max_unit_price:2});
const market=(orders=[])=>({monthly_trades:orders,monthly_trades_complete:true,active_monthly_trades_count:orders.length,monthly_trade_country_id:0,settlement_currency:'trade'});
const change={operation:'set',resource:'food',action:'buy',amount:100,priceLimit:2};
function reconcile(before,after,c,extra={}){
 const p=previewMonthlyChange(before,c,options);
 return reconcileMonthlyChange(before,after,c,{countryId:0,sourceFingerprint:p.sourceFingerprint,beforeScope:scope,afterScope:{...scope,gameDate:'2200.02.01'},...extra});
}
test('preview rejects lossy native integer arguments, extra fields and invalid IDs but accepts zero',()=>{
 assert.equal(validateMonthlyChange({operation:'cancel',orderId:0}).orderId,0);
 for(const c of [{...change,amount:1.5},{...change,priceLimit:-1},{...change,amount:0},{...change,resource:'bad key'},{...change,extra:1},{operation:'cancel',orderId:-1}])assert.throws(()=>validateMonthlyChange(c));
});
test('quantity times limit must fit the signed engine comparison instead of wrapping',()=>{
 assert.throws(()=>validateMonthlyChange({...change,amount:50000,priceLimit:50000}),/int32比较/);
 assert.equal(validateMonthlyChange({...change,amount:2147483647,priceLimit:1}).amount,2147483647);
 assert.equal(validateMonthlyChange({...change,amount:2147483647,priceLimit:0}).priceLimit,0);
});
test('known empty lists may preview creation; legacy or foreign lists remain blocked',()=>{
 const r=previewMonthlyChange(market(),change,options);assert.equal(r.status,'creation_preview');assert.equal(r.executable,false);assert.equal(r.steps[0].params.cancel,false);
 assert.equal(previewMonthlyChange({...market(),monthly_trades_complete:false},change,options).status,'blocked_unknown_orders');
 assert.equal(previewMonthlyChange(market(),change,{countryId:0}).status,'blocked_unknown_session');
});
test('repeated settings never silently stack or overwrite existing orders',()=>{
 assert.equal(previewMonthlyChange(market([row(0)]),change,options).status,'already_present');
 assert.equal(previewMonthlyChange(market([row(0,200)]),change,options).status,'existing_orders_require_review');
 assert.equal(previewMonthlyChange(market([row(0),row(1)]),change,options).status,'existing_orders_require_review');
 assert.equal(previewMonthlyChange(market(),{...change,operation:'replace',orderId:0},options).status,'blocked_missing_order');
});
test('cancellation and replacement use the actual order ID, with explicit non-atomic steps',()=>{
 const cancel=previewMonthlyChange(market([row(0)]),{operation:'cancel',orderId:0},options);assert.deepEqual(cancel.steps[0].params,{cancel:true,order_id:0});
 const replace=previewMonthlyChange(market([row(0)]),{...change,operation:'replace',orderId:0,amount:200},options);assert.equal(replace.status,'two_phase_replace_preview');assert.equal(replace.steps.length,2);assert.equal(replace.executable,false);
});
test('readback proves registration or removal only, never settlement or permission to retry',()=>{
 const r=reconcile(market(),market([row(7)]),change);assert.equal(r.status,'order_registered');assert.equal(r.orderId,7);assert.equal(r.settlementConfirmed,false);assert.equal(r.worldLineageVerified,false);assert.equal(r.automaticRetryAllowed,false);
 assert.equal(reconcile(market([row(0)]),market(),{operation:'cancel',orderId:0}).status,'order_removed');
 const c={...change,operation:'replace',orderId:0,amount:200};assert.equal(reconcile(market([row(0)]),market(),c).status,'old_order_removed_new_unconfirmed');
 assert.equal(reconcile(market([row(0)]),market([row(2,200)]),c).status,'order_replaced');
});
test('unexpected parallel changes, missing binding and time rollback remain unknown',()=>{
 for(const after of [market([row(7),row(8)]),market([row(7,200)]),{...market([row(7)]),monthly_trades_complete:false}])assert.equal(reconcile(market(),after,change).status,'unknown');
 for(const afterScope of [{...scope,sessionId:'other'},{...scope,pid:43},{...scope,creationTime:'new'},{...scope,gameDate:'2199.12.30'}])assert.equal(reconcile(market(),market([row(7)]),change,{afterScope}).status,'unknown');
 assert.equal(reconcile(market(),market([row(7)]),change,{sourceFingerprint:null}).status,'unknown');
});

// Written during the implementation-only stage; not executed yet.
test('late registration may acknowledge only an exact independently cleaned tuple witnessed while this request was pending',()=>{
 const old={order_id:0,resource:'food',action:'sell',amount:1,max_unit_price:0},before=market([old]),after=market([row(7)]),p=previewMonthlyChange(before,change,options);
 const proof={kind:'owned_cleanup_readback',countryId:0,scope:{...scope,gameDate:'2200.01.15'},order:{order_id:0,resource:'food',action:'sell',amount:1,price_limit:0},pendingRequests:[{sessionId:'session',requestId:'late',sourceFingerprint:p.sourceFingerprint}]};
 const args={requestId:'late',confirmedRemovals:[proof]};assert.equal(reconcile(before,after,change).status,'unknown');
 const r=reconcile(before,after,change,args);assert.equal(r.status,'order_registered');assert.deepEqual(r.acknowledgedCleanupIds,[0]);assert.equal(r.automaticRetryAllowed,false);
 for(const mutate of [x=>x.kind='assumed',x=>x.countryId=1,x=>x.scope.sessionId='other',x=>x.scope.pid=43,x=>x.scope.creationTime='other',x=>x.scope.gameDate='2199.12.30',x=>x.scope.gameDate='2200.03.01',x=>x.order.amount=2,x=>x.pendingRequests=[],x=>x.pendingRequests[0].sourceFingerprint='other',x=>x.pendingRequests[0].requestId='other']){
  const bad=structuredClone(proof);mutate(bad);assert.equal(reconcile(before,after,change,{requestId:'late',confirmedRemovals:[bad]}).status,'unknown');
 }
 assert.equal(reconcile(before,after,change,{...args,sourceFingerprint:'changed'}).status,'unknown');
 assert.equal(reconcile(before,market([row(7),row(8)]),change,args).status,'unknown');
});
test('cleanup evidence cannot explain changed survivors, unexpected removals or skip replacement target removal',()=>{
 const old={order_id:0,resource:'minerals',action:'sell',amount:1,max_unit_price:0},survivor={order_id:1,resource:'alloys',action:'sell',amount:1,max_unit_price:0},before=market([old,survivor]);
 const p=previewMonthlyChange(before,change,options),proof={kind:'owned_cleanup_readback',countryId:0,scope:{...scope,gameDate:'2200.01.15'},order:{order_id:0,resource:'minerals',action:'sell',amount:1,price_limit:0},pendingRequests:[{sessionId:'session',requestId:'late',sourceFingerprint:p.sourceFingerprint}]};
 assert.equal(reconcile(before,market([row(7)]),change,{requestId:'late',confirmedRemovals:[proof]}).status,'unknown');
 assert.equal(reconcile(before,market([{...survivor,amount:2},row(7)]),change,{requestId:'late',confirmedRemovals:[proof]}).status,'unknown');
});
