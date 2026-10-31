// Implementation-only stage: these cases are written, not executed.
import test from 'node:test';import assert from 'node:assert/strict';
import {recoverMonthlyRecord,cleanupRecoveredMonthlyRecords,monthlyRecoveryCandidates,recoveryOwnsOrder} from '../src/monthly-trade-recovery.mjs';
function fixture(){
 const records=[{sessionId:'old',requestId:'owned',status:'order_registered',ownedOrder:{order_id:0,resource:'food',action:'buy',amount:1,price_limit:2},reservation:{trade:2},before:{countryId:0,scope:{sessionId:'old',pid:42,creationTime:'fixed',gameDate:'2202.07.01'}}}],orders=[{order_id:0,resource:'food',action:'buy',amount:1,max_unit_price:2},{order_id:9,resource:'food',action:'sell',amount:1,max_unit_price:0}],writes=[];
 const snapshot=async()=>({countryId:0,status:{is_paused:true,date:{formatted:'2202.07.02'}},scope:{sessionId:'current',pid:42,creationTime:'fixed',gameDate:'2202.07.02'},market:{monthly_trades:structuredClone(orders),monthly_trade_country_id:0,monthly_trades_complete:true,active_monthly_trades_count:orders.length}});
 const save=async()=>{};
 const rpc=async(m,p)=>{assert.equal(m,'set_monthly_trade');assert.equal(p.cancel,true);assert.equal(records[0].recoveryOwnerSessionId,'current');assert.equal(records[0].cleanupIntent.status,'issued');writes.push(p);orders.splice(orders.findIndex(o=>o.order_id===p.order_id),1);return {success:true};};
 return {records,orders,writes,snapshot,save,rpc,sessionId:'current',previousSessionId:'old',requestId:'owned'};
}
test('explicit old-session recovery cancels only the selected tuple and releases its stale budget',async()=>{
 const f=fixture();assert.equal(monthlyRecoveryCandidates(f.records,'current').count,1);
 const r=await recoverMonthlyRecord(f);assert.equal(r.confirmed,true);assert.equal(r.automaticResume,false);assert.deepEqual(f.orders.map(o=>o.order_id),[9]);assert.equal(f.records[0].released,true);assert.deepEqual(f.records[0].reservation,{});assert.equal(f.writes.length,1);
 assert.equal(monthlyRecoveryCandidates(f.records,'current').count,0);await recoverMonthlyRecord(f);assert.equal(f.writes.length,1);
});
test('old records are not taken over implicitly; stopping cleans only explicitly selected recovery work',async()=>{
 const f=fixture();assert.equal(recoveryOwnsOrder(f.records,'current',0),false);
 assert.equal((await cleanupRecoveredMonthlyRecords(f)).confirmed,true);assert.equal(f.writes.length,0);assert.equal(f.orders.length,2);
 f.records[0].recoveryOwnerSessionId='current';assert.equal(recoveryOwnsOrder(f.records,'current',0),true);
 await cleanupRecoveredMonthlyRecords(f);assert.equal(f.writes.length,1);assert.equal(recoveryOwnsOrder(f.records,'current',0),false);
});
test('recovery refuses process generations, player changes, rollback and ambiguous request IDs before any send',async()=>{
 for(const mutate of [f=>f.records[0].before.scope.pid=99,f=>f.records[0].before.scope.creationTime='other',f=>f.records[0].before.countryId=1,f=>f.records[0].before.scope.gameDate='2203.01.01',f=>f.records.push(structuredClone(f.records[0]))]){
  const f=fixture();mutate(f);await assert.rejects(recoverMonthlyRecord(f));assert.equal(f.writes.length,0);
 }
 const f=fixture();await assert.rejects(recoverMonthlyRecord({...f,previousSessionId:'current'}),/当前会话/);assert.equal(f.writes.length,0);
});
test('manual content changes and unknown cancellation receipts remain unresolved without another cancellation',async()=>{
 const changed=fixture();changed.orders[0].amount=10;assert.equal((await recoverMonthlyRecord(changed)).confirmed,true);assert.equal(changed.writes.length,0);assert.equal(changed.records[0].released,true);assert.equal(changed.orders[0].amount,10);assert.equal(changed.records[0].termination.reason,'external_order_changed');
 const f=fixture();let writes=0;f.rpc=async()=>{writes++;throw Error('lost receipt');};
 assert.equal((await recoverMonthlyRecord(f)).confirmed,false);assert.equal(writes,1);
 assert.equal((await recoverMonthlyRecord(f)).confirmed,false);assert.equal(writes,1);
 assert.equal((await cleanupRecoveredMonthlyRecords(f)).confirmed,false);assert.equal(writes,1);
 f.orders.shift();assert.equal((await cleanupRecoveredMonthlyRecords(f)).confirmed,true);assert.equal(writes,1);
});
test('stop cannot expand the old-session recovery scope after sealing',async()=>{
 const f=fixture();await assert.rejects(recoverMonthlyRecord({...f,assertActive:()=>{throw Error('stopped');}}),/stopped/);assert.equal(f.records[0].recoveryOwnerSessionId,undefined);assert.equal(f.writes.length,0);
});
test('old unresolved recovery IDs are not hidden behind more than sixteen newer owned records',()=>{
 const f=fixture();f.records[0].status='unknown';
 for(let i=0;i<20;i++)f.records.push({...structuredClone(f.records[0]),requestId:'known-'+i,status:'order_registered',ownedOrder:{...f.records[0].ownedOrder,order_id:i+1}});
 const v=monthlyRecoveryCandidates(f.records,'current');assert.equal(v.count,21);assert.equal(v.records.length,16);assert.equal(v.records[0].requestId,'owned');assert.equal(v.detailsTruncated,true);
});
