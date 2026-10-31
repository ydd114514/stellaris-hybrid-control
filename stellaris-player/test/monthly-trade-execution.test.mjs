import test from 'node:test';
import assert from 'node:assert/strict';
import {MonthlyTradeExecution,MONTHLY_EXECUTION_BRIDGE,MONTHLY_QUOTE_BRIDGE,monthlyReservationRisks,monthlyQuoteCondition} from '../src/monthly-trade-execution.mjs';
import {UPGRADE_PATH_BRIDGE_VERSION,CLAIM_BUDGET_BRIDGE_VERSION} from '../src/bridge-capabilities.mjs';
const change={operation:'set',resource:'food',action:'buy',amount:10,priceLimit:2};
function fixture({orders=[],write,bridge=MONTHLY_EXECUTION_BRIDGE,stock=10000,quote,lifecycle=false}={}){
 let next=10,stopped=false;const records=[],writes=[];let saves=0;
 const row={stockpile:stock,net:-1,stockpile_known:true,net_known:true,net_basis:'engine_total_including_monthly_trade'};
 const snapshot=async()=>({status:{resources:{food:row,trade:row},date:{formatted:'2202.07.01'},is_paused:true},market:{settlement_currency:'trade',market_fee_percent:30,resources:[{key:'food'}],monthly_trade_country_id:0,monthly_trades_complete:true,active_monthly_trades_count:orders.length,monthly_trades:structuredClone(orders)},countryId:0,scope:{sessionId:'s',pid:42,creationTime:'fixed',gameDate:'2202.07.01'}});
 const actor=new MonthlyTradeExecution({store:()=>records,save:async()=>{saves++;},snapshot,sessionId:'s',allowLifecyclePolicies:lifecycle,assertActive:()=>{if(stopped)throw Error('stopped');},rpc:async(m,p)=>{
  if(m==='ping')return {bridge_version:bridge,features:['monthly_trade_read_coverage_candidate',...(quote?['engine_monthly_trade_quotes']:[]),...(bridge===UPGRADE_PATH_BRIDGE_VERSION?['building_upgrade_string_paths']:[]),...(bridge===CLAIM_BUDGET_BRIDGE_VERSION?['building_upgrade_string_paths','actual_market_upkeep_budget','engine_claim_cost_quotes','capped_claim_spending','building_upgrade_candidates','building_upgrade_queue_identity','ship_design_naval_size','zone_building_membership','owned_shipyard_queues','engine_market_transaction_quotes','normal_war_actions','native_survey_automation_candidate']:[])]};
  if(m==='get_monthly_trade_quote')return quote(p);
  assert.ok(records.some(r=>r.status==='issued'&&JSON.stringify(r.steps?.at(-1)?.params)===JSON.stringify(p)||r.cleanupIntent?.status==='issued'&&r.cleanupIntent.orderId===p.order_id));assert.ok(saves>0);writes.push(p);
  if(write)return write(p,{orders,stop:()=>stopped=true});
  if(p.cancel)orders.splice(orders.findIndex(o=>o.order_id===p.order_id),1);
  else orders.push({order_id:next++,resource:p.resource,action:p.action,amount:p.amount,max_unit_price:p.price_limit});
  return {success:true};
 }});
 return {actor,records,writes,orders,stop:()=>stopped=true};
}
test('real set posts once and confirms engine-assigned ID; request repeat does not replay',async()=>{
 const f=fixture();const r=await f.actor.execute({requestId:'a',change});assert.equal(r.status,'order_registered');assert.equal(r.orderId,10);assert.equal(r.settlementConfirmed,false);assert.equal(f.writes.length,1);
 assert.deepEqual(await f.actor.execute({requestId:'a',change}),r);assert.equal(f.writes.length,1);
 await assert.rejects(f.actor.execute({requestId:'a',change:{...change,amount:20}}),/内容不能改变/);
 const d=await f.actor.execute({requestId:'same',change});assert.equal(d.status,'already_present');assert.deepEqual(f.records.at(-1).reservation,{});assert.equal(f.writes.length,1);
});

test('corrected upgrade bridge preserves monthly quoted execution and rejects missing quote capability',async()=>{
 const f=fixture({bridge:UPGRADE_PATH_BRIDGE_VERSION,quote:p=>({success:true,resource:p.resource,action:p.action,units:p.units,total:10,includes_fee:true,settlement_rounding:'ceil_to_whole_currency',price_basis:'engine_monthly_transaction_total'})});
 assert.equal((await f.actor.execute({requestId:'new-bridge',change})).status,'order_registered');assert.equal(f.writes.length,1);
 const bad=fixture({bridge:UPGRADE_PATH_BRIDGE_VERSION});await assert.rejects(bad.actor.execute({requestId:'missing-quote',change}),/功能标记/);assert.equal(bad.writes.length,0);
});
test('replace confirms removal then registers replacement; cancel reads back absence including ID zero',async()=>{
 const f=fixture({orders:[{order_id:0,resource:'food',action:'buy',amount:5,max_unit_price:2}]});
 const r=await f.actor.execute({requestId:'replace',change:{...change,operation:'replace',orderId:0}});assert.equal(r.status,'order_replaced');assert.equal(f.writes.length,2);assert.equal(f.writes[0].order_id,0);
 const c=await f.actor.execute({requestId:'cancel',change:{operation:'cancel',orderId:r.orderId}});assert.equal(c.status,'order_removed');assert.equal(f.orders.length,0);assert.equal(f.records[0].released,true);
});
test('ambiguous transport never retries; reconcile identifies applied order without new write',async()=>{
 const f=fixture({write:async(p,{orders})=>{orders.push({order_id:7,resource:p.resource,action:p.action,amount:p.amount,max_unit_price:p.price_limit});throw Error('lost receipt');}});
 const r=await f.actor.execute({requestId:'lost',change});assert.equal(r.status,'order_registered');assert.equal(r.orderId,7);assert.equal(f.writes.length,1);
 await f.actor.reconcile('lost');assert.equal(f.writes.length,1);
});
test('unknown creation blocks further additions and repeated request does not replay',async()=>{
 const f=fixture({write:async()=>({success:true})});assert.equal((await f.actor.execute({requestId:'a',change})).status,'unknown');
 await f.actor.execute({requestId:'a',change});assert.equal(f.writes.length,1);
 await assert.rejects(f.actor.execute({requestId:'b',change}),/未确认/);
});
test('stop between replacement phases prevents creation and reports partial result',async()=>{
 const f=fixture({orders:[{order_id:0,resource:'food',action:'buy',amount:5,max_unit_price:2}],write:async(p,{orders,stop})=>{assert.equal(p.cancel,true);orders.length=0;stop();return {success:true};}});
 const r=await f.actor.execute({requestId:'a',change:{...change,operation:'replace',orderId:0}});assert.equal(r.status,'old_order_removed_new_not_submitted');assert.equal(r.released,true);assert.equal(f.writes.length,1);
});
test('unknown coverage, old bridge, missing funds and unlimited buys fail before writes',async()=>{
 for(const options of [{bridge:'old'},{stock:1}]){const f=fixture(options);await assert.rejects(f.actor.execute({requestId:'a',change}));assert.equal(f.writes.length,0);}
 const f=fixture();await assert.rejects(f.actor.execute({requestId:'a',change:{...change,priceLimit:0}}),/限价/);assert.equal(f.writes.length,0);
});
test('stop removes session-owned orders only and confirms actual absence',async()=>{
 const f=fixture({orders:[{order_id:0,resource:'food',action:'sell',amount:2,max_unit_price:0}]});await f.actor.execute({requestId:'a',change});
 const owned=f.records[0].ownedOrder;assert.equal(f.actor.owns(owned.order_id),true);
 // Cleanup has its own durable cancellation intent, separate from new creation.
 const result=await f.actor.cleanup();assert.equal(result.confirmed,true);assert.equal(f.orders.length,1);assert.equal(f.orders[0].order_id,0);
});

test('stop refuses to cancel an order whose fields changed after registration',async()=>{
 const f=fixture();await f.actor.execute({requestId:'a',change});f.orders[0].amount=99;
 const r=await f.actor.cleanup();assert.equal(r.confirmed,false);assert.equal(f.writes.length,1);assert.equal(f.records[0].released,undefined);
});
test('failed partial replacement with no attempted create can be safely released on stop',async()=>{
 const f=fixture({orders:[{order_id:0,resource:'food',action:'buy',amount:5,max_unit_price:2}],write:async(p,{orders,stop})=>{orders.length=0;stop();return {success:true};}});
 await f.actor.execute({requestId:'a',change:{...change,operation:'replace',orderId:0}});
 const result=await f.actor.cleanup();assert.equal(result.confirmed,true);assert.equal(f.records[0].released,true);assert.equal(f.writes.length,1);
});
test('recurring reserve monitoring includes existing net once, floors and commitments, and ignores released/foreign orders',()=>{
 const row={stockpile:100,net:-10,stockpile_known:true,net_known:true,net_basis:'engine_total_including_monthly_trade'};
 const records=[{sessionId:'s',ownedOrder:{order_id:0},reservation:{trade:20}}];
 const options={sessionId:'s',commitments:{trade:20},floors:{trade:40}};
 assert.deepEqual(monthlyReservationRisks({resources:{trade:row}},records,options),[]);
 assert.equal(monthlyReservationRisks({resources:{trade:{...row,stockpile:80}}},records,options)[0].reason,'reserve_shortfall');
 assert.equal(monthlyReservationRisks({resources:{trade:{...row,net_known:false}}},records,options)[0].reason,'unknown_budget');
 assert.deepEqual(monthlyReservationRisks({resources:{}},[{...records[0],released:true}],options),[]);
 assert.deepEqual(monthlyReservationRisks({resources:{}},records,{sessionId:'other'}),[]);
});
test('monthly price conditions compare fee-inclusive rounded whole totals and allow inactive conditional orders',async()=>{
 const quote=p=>({success:true,price_basis:'engine_monthly_transaction_total',resource:p.resource,action:p.action,units:p.units,total:2,includes_fee:true,settlement_rounding:'ceil_to_whole_currency'});
 const buy={...change,amount:1,priceLimit:1};assert.equal(monthlyQuoteCondition(quote({resource:'food',action:'buy',units:1}),buy).priceConditionMet,false);
 assert.equal(monthlyQuoteCondition(quote({resource:'food',action:'sell',units:1}),{...buy,action:'sell',priceLimit:3}).priceConditionMet,false);
 assert.equal(monthlyQuoteCondition(quote({resource:'food',action:'sell',units:1}),{...buy,action:'sell',priceLimit:0}).priceConditionMet,true);
 const f=fixture({bridge:MONTHLY_QUOTE_BRIDGE,quote});const r=await f.actor.execute({requestId:'conditional',change:buy});assert.equal(r.status,'order_registered');assert.equal(r.quote.priceConditionMet,false);assert.equal(r.quote.futurePriceGuaranteed,false);assert.equal(f.writes.length,1);
 assert.equal(f.records[0].reservation.trade,1);
});
test('invalid monthly quote provenance or rounding prevents new submission',async()=>{
 const f=fixture({bridge:MONTHLY_QUOTE_BRIDGE,quote:()=>({success:true,price_basis:'engine_transaction_total',total:1})});
 await assert.rejects(f.actor.execute({requestId:'bad-quote',change}),/报价来源/);assert.equal(f.writes.length,0);
});
test('already fee-inclusive limit reservations never charge another fee',async()=>{
 const f=fixture();await f.actor.execute({requestId:'cap',change});assert.equal(f.records[0].reservation.trade,20);
});

// Prepared during the implementation-only stage; not executed yet.
test('request equality is structural; changing a lifecycle policy cannot reuse the same request ID',async()=>{
 const f=fixture({lifecycle:true});await f.actor.execute({requestId:'policy',change,policy:{maxStockpile:20000,expiresOn:'2203.01.01'}});
 await f.actor.execute({requestId:'policy',change:{priceLimit:2,amount:10,resource:'food',operation:'set',action:'buy'},policy:{expiresOn:'2203.01.01',maxStockpile:20000}});assert.equal(f.writes.length,1);
 await assert.rejects(f.actor.execute({requestId:'policy',change,policy:{maxStockpile:15000,expiresOn:'2203.01.01'}}),/内容不能改变/);
});
test('lifecycle cleanup scopes removal to selected owned request IDs and preserves other orders',async()=>{
 const f=fixture({orders:[{order_id:0,resource:'food',action:'sell',amount:1,max_unit_price:0}],lifecycle:true});await f.actor.execute({requestId:'owned',change,policy:{maxStockpile:20000}});
 f.records.push({requestId:'other',sessionId:'s',status:'order_registered',ownedOrder:{order_id:20,resource:'food',action:'buy',amount:2,price_limit:3},reservation:{trade:6}});f.orders.push({order_id:20,resource:'food',action:'buy',amount:2,max_unit_price:3});
 const r=await f.actor.cleanup({requestIds:['owned'],allowRunning:true,reason:'policy_complete'});assert.equal(r.confirmed,true);assert.deepEqual(f.orders.map(o=>o.order_id),[0,20]);assert.equal(f.records[0].termination.reason,'policy_complete');assert.equal(f.records[1].released,undefined);
});
test('a pending explicit cancellation is not re-posted by global cleanup or another request ID',async()=>{
 const f=fixture({write:async(p,{orders})=>{if(!p.cancel)orders.push({order_id:7,resource:p.resource,action:p.action,amount:p.amount,max_unit_price:p.price_limit});return {success:true};}});
 await f.actor.execute({requestId:'create',change});await f.actor.execute({requestId:'cancel',change:{operation:'cancel',orderId:7}});assert.equal(f.writes.length,2);
 assert.equal((await f.actor.cleanup()).confirmed,false);assert.equal(f.writes.length,2);
 await assert.rejects(f.actor.execute({requestId:'cancel-again',change:{operation:'cancel',orderId:7}}),/在途/);assert.equal(f.writes.length,2);
 f.orders.length=0;await f.actor.reconcile('cancel');assert.equal(f.records[0].released,true);
});
test('prepared intents with no recorded send step are released without touching native orders',async()=>{
 const f=fixture();f.records.push({sessionId:'s',requestId:'prepared',status:'prepared',change,steps:[],reservation:{trade:20}});
 const r=await f.actor.cleanup();assert.equal(r.confirmed,true);assert.equal(f.records[0].released,true);assert.equal(f.writes.length,0);
});
test('lifecycle conditions are opt-in and cannot silently attach ownership to an existing order',async()=>{
 const f=fixture();await assert.rejects(f.actor.execute({requestId:'disabled',change,policy:{maxStockpile:20000}}),/默认关闭/);assert.equal(f.writes.length,0);
 const p=fixture({lifecycle:true});await p.actor.execute({requestId:'old',change});await assert.rejects(p.actor.execute({requestId:'attach',change,policy:{maxStockpile:20000}}),/不接管手工旧单/);assert.equal(p.writes.length,1);
});
test('reconcile releases vanished or manually edited owned orders without touching their replacement',async()=>{
 for(const mode of ['absent','changed']){
  const f=fixture();await f.actor.execute({requestId:'owned',change});
  if(mode==='absent')f.orders.length=0;else f.orders[0].amount=99;
  const r=await f.actor.reconcile('owned');assert.equal(r.released,true);assert.deepEqual(f.records[0].reservation,{});assert.equal(f.writes.length,1);
  assert.equal(r.termination.reason,mode==='absent'?'external_order_absent':'external_order_changed');
  await f.actor.cleanup();assert.equal(f.writes.length,1);assert.equal(f.orders.length,mode==='absent'?0:1);
 }
});
test('an explicit already-absent cancellation releases old owned reservation without another native send',async()=>{
 const f=fixture();await f.actor.execute({requestId:'owned',change});f.orders.length=0;
 const r=await f.actor.execute({requestId:'cancel-absent',change:{operation:'cancel',orderId:10}});
 assert.equal(r.status,'already_absent');assert.equal(f.records[0].released,true);assert.deepEqual(f.records[0].reservation,{});assert.equal(f.writes.length,1);
});

test('stop confirms a late creation across its own witnessed removal and cancels it without re-posting creation',async()=>{
 let pending;const f=fixture({write:async(p,{orders})=>{
  if(!p.cancel&&p.action==='sell')orders.push({order_id:31,resource:p.resource,action:p.action,amount:p.amount,max_unit_price:p.price_limit});
  else if(!p.cancel)pending={order_id:32,resource:p.resource,action:p.action,amount:p.amount,max_unit_price:p.price_limit};
  else {orders.splice(orders.findIndex(o=>o.order_id===p.order_id),1);if(p.order_id===31)orders.push(pending);}
  return {success:true};
 }});
 await f.actor.execute({requestId:'known',change:{...change,action:'sell',amount:1,priceLimit:0}});
 assert.equal((await f.actor.execute({requestId:'late',change})).status,'unknown');
 const r=await f.actor.cleanup();assert.equal(r.confirmed,true);assert.equal(f.orders.length,0);assert.deepEqual(f.records[1].acknowledgedCleanupIds,[31]);assert.equal(f.records[1].released,true);
 assert.equal(f.writes.filter(p=>p.cancel===false).length,2);assert.deepEqual(f.writes.filter(p=>p.cancel).map(p=>p.order_id),[31,32]);
});
test('late readback still refuses extra manual additions rather than treating them as another owned creation',async()=>{
 let pending;const f=fixture({write:async(p,{orders})=>{
  if(!p.cancel&&p.action==='sell')orders.push({order_id:31,resource:p.resource,action:p.action,amount:p.amount,max_unit_price:p.price_limit});
  else if(!p.cancel)pending={order_id:32,resource:p.resource,action:p.action,amount:p.amount,max_unit_price:p.price_limit};
  else {orders.splice(orders.findIndex(o=>o.order_id===p.order_id),1);if(p.order_id===31)orders.push(pending,{...pending,order_id:99});}
  return {success:true};
 }});
 await f.actor.execute({requestId:'known',change:{...change,action:'sell',amount:1,priceLimit:0}});await f.actor.execute({requestId:'late',change});
 const r=await f.actor.cleanup();assert.equal(r.confirmed,false);assert.equal(f.records[1].ownedOrder,undefined);assert.deepEqual(f.orders.map(o=>o.order_id),[32,99]);assert.deepEqual(f.writes.filter(p=>p.cancel).map(p=>p.order_id),[31]);
});

test('bounded monthly details keep an old unresolved request visible after many newer terminal records',()=>{
 const f=fixture();f.records.push({sessionId:'s',requestId:'old-unknown',status:'unknown',steps:[],reservation:{}});
 for(let i=0;i<20;i++)f.records.push({sessionId:'s',requestId:'done-'+i,status:'already_absent',released:true});
 const v=f.actor.view();assert.equal(v.records.length,8);assert.equal(v.records[0].requestId,'old-unknown');assert.equal(v.counts.uncertain,1);assert.equal(v.detailsTruncated,true);assert.equal(v.recordCount,21);
});

test('known unsent creation releases its allowance and never adopts a concurrent matching manual order',async()=>{
 const f=fixture({write:async(p,{orders})=>{orders.push({order_id:77,resource:p.resource,action:p.action,amount:p.amount,max_unit_price:p.price_limit});const e=Error('scope changed before wire');e.nativeWriteAttempted=false;throw e;}});
 const r=await f.actor.execute({requestId:'unsent',change});assert.equal(r.status,'rejected');assert.equal(r.released,true);assert.equal(r.ownedOrder,undefined);assert.equal(r.paused,null);assert.deepEqual(f.records[0].reservation,{});
 await f.actor.reconcile('unsent');await f.actor.cleanup();assert.deepEqual(f.orders.map(o=>o.order_id),[77]);assert.equal(f.writes.length,1);await f.actor.execute({requestId:'unsent',change});assert.equal(f.writes.length,1);
});
test('known native rejection does not adopt another matching order either',async()=>{
 const f=fixture({write:async(p,{orders})=>{orders.push({order_id:77,resource:p.resource,action:p.action,amount:p.amount,max_unit_price:p.price_limit});const e=Error('rejected by the engine');e.rejected=true;e.nativeWriteAttempted=true;throw e;}});
 const r=await f.actor.execute({requestId:'refused',change});assert.equal(r.status,'rejected');assert.equal(r.ownedOrder,undefined);assert.equal(f.records[0].steps[0].status,'rejected_native');await f.actor.cleanup();assert.equal(f.orders.length,1);
});
test('replacement old removal plus definitely unsent creation reports partial effect without adopting a concurrent order',async()=>{
 const f=fixture({orders:[{order_id:0,resource:'food',action:'buy',amount:1,max_unit_price:2}],write:async(p,{orders})=>{if(p.cancel){orders.length=0;return {success:true};}orders.push({order_id:77,resource:p.resource,action:p.action,amount:p.amount,max_unit_price:p.price_limit});const e=Error('not sent');e.nativeWriteAttempted=false;throw e;}});
 const r=await f.actor.execute({requestId:'replace-unsent',change:{...change,operation:'replace',orderId:0}});assert.equal(r.status,'old_order_removed_new_not_submitted');assert.equal(r.termination.oldOrderRemoved,true);assert.equal(r.termination.newOrderRegistered,false);assert.equal(r.ownedOrder,undefined);assert.equal(r.released,true);assert.deepEqual(f.records[0].reservation,{});
 await f.actor.cleanup();assert.deepEqual(f.orders.map(o=>o.order_id),[77]);assert.equal(f.writes.length,2);
});
test('explicit cancel known not sent does not prevent a later explicit cancellation request with fresh reads',async()=>{
 let reject=true;const f=fixture({orders:[{order_id:0,resource:'food',action:'buy',amount:1,max_unit_price:2}],write:async(_p,{orders})=>{if(reject){const e=Error('not sent');e.nativeWriteAttempted=false;throw e;}orders.length=0;return {success:true};}});
 assert.equal((await f.actor.execute({requestId:'cancel-unsent',change:{operation:'cancel',orderId:0}})).status,'rejected');reject=false;
 assert.equal((await f.actor.execute({requestId:'cancel-explicit-next',change:{operation:'cancel',orderId:0}})).status,'order_removed');assert.equal(f.writes.length,2);
});
test('cleanup knows cancellation was not submitted, holds the live order reserve and permits a later explicit cleanup without replaying an unknown wire write',async()=>{
 let reject=true;const f=fixture({write:async(p,{orders})=>{if(!p.cancel){orders.push({order_id:7,resource:p.resource,action:p.action,amount:p.amount,max_unit_price:p.price_limit});return {success:true};}if(reject){const e=Error('connection changed before wire');e.nativeWriteAttempted=false;throw e;}orders.length=0;return {success:true};}});
 await f.actor.execute({requestId:'owned',change});const first=await f.actor.cleanup();assert.equal(first.confirmed,false);assert.equal(f.records[0].cleanupIntent.status,'not_sent');assert.equal(f.actor.view().records[0].status,'cancellation_not_submitted');assert.equal(f.actor.view().counts.uncertain,1);assert.equal(f.records[0].reservation.trade,20);
 reject=false;const second=await f.actor.cleanup();assert.equal(second.confirmed,true);assert.equal(f.records[0].released,true);assert.equal(f.orders.length,0);assert.equal(f.writes.filter(p=>p.cancel).length,2);
});
test('replacement phase two excludes only its own existing monthly reservation, not a second copy of that allowance',async()=>{
 const f=fixture({stock:70,orders:[{order_id:0,resource:'food',action:'buy',amount:1,max_unit_price:2}]}),exclusions=[];
 f.actor.budgetOptions=({excludeMonthlyRecord}={})=>{exclusions.push(excludeMonthlyRecord);const commitments={};for(const r of f.records)if(!r.released&&r!==excludeMonthlyRecord)for(const [key,n]of Object.entries(r.reservation||{}))commitments[key]=(commitments[key]??0)+n;return {commitments};};
 const r=await f.actor.execute({requestId:'replace-with-own-reserve',change:{...change,operation:'replace',orderId:0}});assert.equal(r.status,'order_replaced');assert.equal(f.writes.length,2);assert.equal(exclusions.at(-1),f.records[0]);assert.equal(f.records[0].reservation.trade,20);
});

test('new claim-cost bridge retains monthly set, adjustment and cancellation with the full quote gates',async()=>{
 const quote=p=>({success:true,resource:p.resource,action:p.action,units:p.units,total:10,includes_fee:true,settlement_rounding:'ceil_to_whole_currency',price_basis:'engine_monthly_transaction_total'});
 const f=fixture({bridge:CLAIM_BUDGET_BRIDGE_VERSION,quote});const a=await f.actor.execute({requestId:'claim-bridge-monthly',change});assert.equal(a.status,'order_registered');
 const b=await f.actor.execute({requestId:'claim-bridge-replace',change:{...change,operation:'replace',orderId:a.orderId,amount:20}});assert.equal(b.status,'order_replaced');
 const c=await f.actor.execute({requestId:'claim-bridge-remove',change:{operation:'cancel',orderId:b.orderId}});assert.equal(c.status,'order_removed');assert.equal(f.orders.length,0);
});
