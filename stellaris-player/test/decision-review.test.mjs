import test from 'node:test';import assert from 'node:assert/strict';
import {decisionReview} from '../src/decision-review.mjs';
import {ModelView,restoreModelView} from '../src/model-view.mjs';
const state=()=>({snapshotId:'s:1',pendingEvents:[],surveyControl:{records:{0:{fleetId:0,sessionId:'s',owner:'native',desired:true,pending:false,observedAt:100,observation:{known:true,order_chain_complete:true,automation_enabled:true,orders:[{automation:true},{automation:false}]}}}},wakeReasons:['scheduled_review']});
const options={sessionId:'s',observedAt:100,now:100};
test('fresh native work and event facts are explicit after a routine watch, including fleet zero',()=>{
 const r=decisionReview(state(),options);assert.equal(r.routineWaitSuggested,true);assert.deepEqual(r.nativeWorkingFleetIds,[0]);assert.equal(r.eventCount,0);
});
test('stale, foreign, idle, unknown and attention states never suggest routine waiting',()=>{
 for(const mutate of [s=>s.surveyControl.records[0].sessionId='old',s=>s.surveyControl.records[0].observation.known=false,s=>s.surveyControl.records[0].observation.orders=[{automation:true}],s=>s.surveyControl.records[0].observedAt=-10000,s=>s.surveyControl.records[0].pending=true,s=>s.pendingEvents=[{}],s=>delete s.pendingEvents,s=>s.wakeReasons=['new_alert'],s=>s.warGoalsWindow={},s=>s.decisionAttention={reasons:['resource_risk']},s=>s.uncertain=true,s=>s.surveyControl.records[0].desired=false,s=>s.surveyControl.records[0].fleetId=0xffffffff]){
  const s=state();mutate(s);assert.equal(decisionReview(s,options).routineWaitSuggested,false);
 }
 assert.equal(decisionReview(state(),{...options,now:10101}).routineWaitSuggested,false);
 assert.equal(decisionReview(state(),{...options,now:99}).routineWaitSuggested,false);
});
test('each delta explicitly carries the review even when its facts are unchanged; replay stays lossless',()=>{
 const v=new ModelView(),s={...state(),decisionReview:decisionReview(state(),options)};
 v.project(s);const delta=v.project(s);assert.deepEqual(delta.decisionReview,s.decisionReview);assert.deepEqual(restoreModelView(s,delta),s);
});

test('an idle research slot prevents a routine wait hint even while native survey work is active',()=>{
 const s=state();s.research={physics:{current:null,candidates:[{key:'tech_current'}]}};
 const r=decisionReview(s,options);assert.deepEqual(r.nativeWorkingFleetIds,[0]);assert.equal(r.routineWaitSuggested,false);assert.deepEqual(r.researchChoices[0].candidates[0].arguments,{slot:'physics',tech_key:'tech_current'});
});

// Implementation-only batch: prepared for unified validation, not executed.
test('only fresh matching local queue evidence permits a local-work wait suggestion',()=>{
 const local=()=>{const s=state();delete s.surveyControl;s.date='2200.01.01';s.colonyControl={records:[{sessionId:'s',planetId:0,status:'waiting',actions:[{status:'queued',queueItemId:0}]}]};s.localWorkWait={enabled:true,trusted:true,sessionId:'s',planetId:0,queueItemId:0,gameDate:s.date,observedAt:100};return s;};
 const r=decisionReview(local(),options);assert.equal(r.localWorkObserved,true);assert.equal(r.routineWaitSuggested,true);
 for(const mutate of [s=>s.localWorkWait.sessionId='old',s=>s.localWorkWait.observedAt=-6000,s=>s.localWorkWait.gameDate='2199.12.30',s=>s.localWorkWait.queueItemId=1,s=>s.colonyControl.records[0].reviewRequired=true,s=>s.colonyControl.records[0].status='paused',s=>s.localWorkWait.enabled=false]){
  const s=local();mutate(s);assert.equal(decisionReview(s,options).localWorkObserved,false);assert.equal(decisionReview(s,options).routineWaitSuggested,false);
 }
});
test('unconfirmed orders, old recovery, blocked colonies and manual attention override an otherwise valid native wait hint',()=>{
 for(const mutate of [
  s=>s.monthlyControl={sessionId:'s',counts:{uncertain:1},records:[{sessionId:'s',requestId:'pending',status:'unknown'}]},
  s=>s.monthlyControl={sessionId:'s',counts:{uncertain:0},records:[{sessionId:'s',requestId:'pending',status:'cancellation_unconfirmed'}]},
  s=>s.monthlyControl={recovery:{count:1}},
  s=>s.colonyControl={records:[{sessionId:'s',planetId:0,status:'blocked'}]},
  s=>s.paused=true,s=>s.needsAttention='人工接管',s=>s.stopped=true,s=>s.runtimeComplete=true
 ]){const s=state();mutate(s);assert.equal(decisionReview(s,options).routineWaitSuggested,false);}
 const s=state();s.monthlyControl={records:[{sessionId:'s',requestId:'original',status:'unknown',orderId:0}]};const r=decisionReview(s,options);assert.equal(r.delegationReview.monthlyUncertain,1);assert.equal(r.delegationReview.unresolvedMonthlyRequests[0].requestId,'original');assert.equal(r.delegationReview.observedOnly,true);
});
test('a registered monthly order alone is not proof of active local work or permission to extend waiting',()=>{
 const s=state();delete s.surveyControl;s.monthlyControl={sessionId:'s',counts:{registered:1,uncertain:0},records:[{sessionId:'s',requestId:'registered',status:'order_registered'}]};
 const r=decisionReview(s,options);assert.equal(r.localWorkObserved,false);assert.equal(r.routineWaitSuggested,false);
});
test('a cancellation proven not submitted still requires attention while the recurring order remains live',()=>{
 const s=state();s.monthlyControl={sessionId:'s',records:[{sessionId:'s',requestId:'owned',status:'cancellation_not_submitted'}]};const r=decisionReview(s,options);assert.equal(r.routineWaitSuggested,false);assert.equal(r.delegationReview.monthlyUncertain,1);
});
