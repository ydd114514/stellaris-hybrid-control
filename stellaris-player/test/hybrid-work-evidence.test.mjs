import test from 'node:test';import assert from 'node:assert/strict';import {analyzeHybridWorkEvidence} from '../src/hybrid-work-evidence.mjs';
const event=(type,ms,extra={})=>({type,at:new Date(ms).toISOString(),...extra});
const meta=event('session_meta',0,{sessionId:'s'});
test('posted or queued work and research selection never masquerade as finished construction or technology',()=>{
 const rows=[meta,event('receipt',1,{command:'build_building',response:{success:true}}),event('order_lifecycle',2,{sessionId:'s',trackingId:'q',command:'build_building',status:'queued',proof:{kind:'queue_observed'}}),event('order_lifecycle',3,{sessionId:'s',trackingId:'wrong',command:'build_building',status:'completed',proof:{kind:'queue_observed'}})];
 assert.equal(analyzeHybridWorkEvidence(rows).completed.count,0);
 const done=event('order_lifecycle',4,{sessionId:'s',trackingId:'d',command:'build_building',status:'completed',proof:{kind:'building_count_increased',observedCount:1}});
 rows.push(done,done,event('order_lifecycle',5,{sessionId:'s',trackingId:'r',command:'select_research',status:'completed',proof:{kind:'research_selection'}}));
 const r=analyzeHybridWorkEvidence(rows);assert.equal(r.completed.count,2);assert.equal(r.completed.byCommand.build_building,1);assert.equal(r.completed.byCommand.select_research,1);assert.equal(r.acceptancePassed,false);
});
const native=(when=1000)=>({fleetId:0,sessionId:'s',owner:'native',pending:false,observedAt:when,observation:{known:true,automation_enabled:true,order_chain_complete:true,automation_order_count:1,orders:[{automation:true,settings_bits:2,action_option_count:0},{automation:false}]}});
test('native work alongside construction requires fresh actual subtask and queue evidence in an unpaused sample',()=>{
 const state={paused:false,date:'2200.01.01',surveyControl:{records:{0:native()}},orderTracking:{recent:[{id:'q',command:'build_building',status:'executing',updatedAt:1000,proof:{kind:'queue_observed'}}]}};
 assert.equal(analyzeHybridWorkEvidence([meta,event('state',1000,{state})]).nativeSurveyAlongsideQueue.count,1);
 for(const change of [s=>s.paused=true,s=>s.surveyControl.records[0].observedAt=-3001,s=>s.surveyControl.records[0].sessionId='old',s=>s.surveyControl.records[0].observation.orders.pop(),s=>s.orderTracking.recent[0].proof.kind='submitted',s=>s.orderTracking.recent[0].updatedAt=-5001]){
  const s=structuredClone(state);change(s);assert.equal(analyzeHybridWorkEvidence([meta,event('state',1000,{state:s})]).nativeSurveyAlongsideQueue.count,0);
 }
});
test('reclaim alone is not an intervention cycle and ambiguous manual batches cannot prove the intervening order',()=>{
 const delegate=event('survey_control',1000,{fleetId:0,control:native()});
 const reclaim=event('survey_control',2000,{fleetId:0,control:{sessionId:'s',owner:'manual',pending:false,observation:{known:true,automation_enabled:false,order_chain_complete:true}}});
 const intent=event('intent',3000,{requestId:'move',orders:[{command:'move_fleet',arguments:{fleet_id:0,system_id:1}}]});
 const receipt=event('receipt',4000,{requestId:'move',command:'move_fleet',response:{success:true}});
 const redelegate=event('survey_control',5000,{fleetId:0,control:native(5000)});
 assert.equal(analyzeHybridWorkEvidence([meta,delegate,reclaim,redelegate]).interventionCycles.length,0);
 assert.equal(analyzeHybridWorkEvidence([meta,delegate,reclaim,intent,receipt,redelegate]).interventionCycles.length,1);
 intent.orders.push({command:'move_fleet',arguments:{fleet_id:1,system_id:1}});assert.equal(analyzeHybridWorkEvidence([meta,delegate,reclaim,intent,receipt,redelegate]).interventionCycles.length,0);
});
test('multiple controller sessions cannot be combined into a work proof',()=>{
 const r=analyzeHybridWorkEvidence([meta,event('session_meta',1,{sessionId:'other'})]);assert.equal(r.sessionKnown,false);assert.equal(r.completed,null);
});
