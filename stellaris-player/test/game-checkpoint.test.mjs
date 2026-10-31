import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGameCheckpoint,makeCompactGameCheckpoint} from '../src/game-checkpoint.mjs';
test('native control memory retains the fence and strategic override without world addresses',()=>{
 const text=makeCompactGameCheckpoint({sessionId:'s',countryAIControl:{enabled:true,owner:'native',nativePhase:'running',generation:0,
  ordinaryOrdersBlocked:true,paused:false,domains:['research','planet_construction'],worldScope:{country_address:999,idler_address:888}},state:{snapshotId:'s:1'}},
  [{type:'intent',requestId:'key',strategicResearchOverride:true,explanation:'战略科研',orders:[{command:'select_research',arguments:{slot:'physics',tech_key:'tech_key'}}]}]);
 const record=JSON.parse(text.slice(text.indexOf('{')));
 assert.equal(record.countryAIControl.generation,0);assert.equal(record.countryAIControl.ordinaryOrdersBlocked,true);
 assert.equal(record.countryAIControl.automaticResume,false);assert.equal(record.recentIntent[0].strategicResearchOverride,true);
 assert.equal(text.includes('country_address'),false);assert.equal(text.includes('idler_address'),false);assert.match(text,/v1.4/);
});
test('local memory retains authoritative state, failed commands and pending intent without a model call',()=>{
  const state={snapshotId:'session:6',player:{country_id:0},pendingEvents:[{window_id:0}],wars:[{war_id:16777219}]};
  const text=makeGameCheckpoint({sessionId:'session',uncertain:true,state},[
    {type:'intent',requestId:'r1',explanation:'我先保护船坞。',orders:[{command:'reinforce_fleet',arguments:{fleet_id:0}}]},
    {type:'rejected',requestId:'r1',command:'reinforce_fleet',error:'船坞被占领'},
  ]);
  const record=JSON.parse(text.slice(text.indexOf('{')));assert.deepEqual(record.state,state);assert.equal(record.uncertain,true);assert.match(record.recentFailures[0].error,/占领/);assert.equal(record.recentIntent[0].orders[0].arguments.fleet_id,0);
  assert.throws(()=>makeGameCheckpoint({}),/Missing/);
});
test('compact memory stays bounded as empire grows, retains uncertainty and mistakes, requires a fresh observe',()=>{
 const state={snapshotId:'live:999',date:'2287.08.25',player:{name:'测试帝国'},capacities:{colonies:200},colonies:Array.from({length:200},(_,i)=>({planet_id:i,text:'建设详情'.repeat(100)}))};
 const rows=[{type:'intent',requestId:'r0',explanation:'保护船坞',orders:[{command:'reinforce_fleet',arguments:{fleet_id:0}}]},{type:'unknown',requestId:'r0',command:'reinforce_fleet',error:'结果未知，先核对'}];
 const text=makeCompactGameCheckpoint({sessionId:'same-game',uncertain:true,state},rows);const record=JSON.parse(text.slice(text.indexOf('{')));
 assert.ok(text.length<=6000);assert.equal(record.refreshRequired,true);assert.equal(record.uncertain,true);assert.equal(record.lastObserved.colonies,200);assert.equal(record.recentIntent[0].orders[0].arguments.fleet_id,0);assert.equal(record.recentFailures[0].status,'unknown');assert.ok(!text.includes('建设详情'));assert.ok(!JSON.stringify(record).includes('snapshotId'));assert.match(text,/先 observe/);
});

test('compact memory retains bounded delegation request indexes and original allowances without granting write permission',()=>{
 const cp={sessionId:'s',stopped:false,state:{snapshotId:'s:100',date:'2202.07.01',
  monthlyControl:{records:[{sessionId:'s',requestId:'monthly-unknown',status:'unknown',orderId:0,reservation:{trade:2}},{sessionId:'other',requestId:'foreign',status:'unknown'}],recovery:{records:[{sessionId:'old',requestId:'stale',status:'unknown'}]}},
  colonyControl:{records:[{sessionId:'s',planetId:0,status:'paused',goal:'保持原预算和已排施工',remainingBudget:{minerals:400},actions:[{requestId:'construction',status:'queued',queueItemId:0}]}]}}};
 const text=makeCompactGameCheckpoint(cp),r=JSON.parse(text.slice(text.indexOf('{')));
 assert.equal(r.delegationMemory.observedOnly,true);assert.equal(r.delegationMemory.automaticResume,false);assert.equal(r.delegationMemory.monthly.length,1);assert.equal(r.delegationMemory.monthly[0].requestId,'monthly-unknown');assert.equal(r.delegationMemory.monthly[0].orderId,0);
 assert.equal(r.delegationMemory.oldMonthly[0].previousSessionId,'old');assert.equal(r.delegationMemory.colonies[0].remainingBudget.minerals,400);assert.equal(r.delegationMemory.colonies[0].pending[0].queueItemId,0);assert.equal(r.refreshRequired,true);assert.ok(text.length<=6000);
});
test('large delegation memory cannot turn compaction into another unbounded copy of the empire',()=>{
 const monthly=Array.from({length:256},(_,i)=>({sessionId:'s',requestId:('r'+i).padEnd(100,'x'),status:'unknown',reservation:Object.fromEntries(Array.from({length:200},(_,j)=>['resource_'+j,100]))}));
 const colonies=Array.from({length:128},(_,i)=>({sessionId:'s',planetId:i,status:'paused',goal:'批准建设'.repeat(1000),remainingBudget:{minerals:1000},actions:Array.from({length:128},(_,j)=>({requestId:'a'+j,status:'queued',queueItemId:j}))}));
 const text=makeCompactGameCheckpoint({sessionId:'s',state:{snapshotId:'s:1',monthlyControl:{records:monthly},colonyControl:{records:colonies}}});assert.ok(text.length<=6000);const r=JSON.parse(text.slice(text.indexOf('{')));assert.ok(r.delegationMemory.monthly.length<=4);assert.ok(r.delegationMemory.colonies.length<=2);assert.equal(r.delegationMemory.automaticResume,false);
});
