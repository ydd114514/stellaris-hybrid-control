import test from 'node:test';import assert from 'node:assert/strict';
import {hybridWorkSummary,campaignWorkSummary} from '../src/hybrid-work-summary.mjs';
const fixture=()=>({sessionId:'s',stopped:false,state:{monthlyControl:{records:[{sessionId:'s',status:'order_registered'},{sessionId:'s',status:'unknown'},{sessionId:'other',status:'order_registered'}]},colonyControl:{records:[{sessionId:'s',status:'waiting',actions:[{status:'queued'}]}]}}});
test('summary separates registered monthly orders, unresolved control and local queued work',()=>{
 const s=hybridWorkSummary(fixture(),{actorActive:true});assert.equal(s.monthlyRegistered,1);assert.equal(s.monthlyUncertain,1);assert.equal(s.localColonies,1);assert.equal(s.colonyQueued,1);
});
test('dead or stopped actors never look like active local delegation and unreturned trades stay uncertain',()=>{
 for(const stopped of [false,true]){const c=fixture();c.stopped=stopped;const s=hybridWorkSummary(c);assert.equal(s.monthlyRegistered,0);assert.equal(s.monthlyUncertain,2);assert.equal(s.localColonies,0);}
});
test('bounded detail lists do not truncate total counts and malformed lists cannot crash status',()=>{
 const c=fixture();c.state.monthlyControl={sessionId:'s',counts:{registered:20,uncertain:2},records:[]};const s=hybridWorkSummary(c,{actorActive:true});assert.equal(s.monthlyRegistered,20);assert.equal(s.monthlyUncertain,2);
 assert.equal(hybridWorkSummary({state:{monthlyControl:{records:{bad:true}}}}).monthlyRegistered,0);
});
test('conditional order counts require current-session aggregates and completion does not imply settlement',()=>{
 const c=fixture();c.state.monthlyControl={sessionId:'s',lifecyclePilotEnabled:true,counts:{registered:2,uncertain:0,conditional:1,policyCompleted:3},records:[]};
 const s=hybridWorkSummary(c,{actorActive:true});assert.equal(s.monthlyConditional,1);assert.equal(s.monthlyPolicyCompleted,3);assert.equal(s.monthlyLifecyclePilotEnabled,true);
 c.state.monthlyControl.sessionId='old';assert.equal(hybridWorkSummary(c,{actorActive:true}).monthlyPolicyCompleted,0);
});
test('stale session recovery remains visible separately from current monthly registration',()=>{
 const c=fixture();c.state.monthlyControl.recovery={count:2};const s=hybridWorkSummary(c,{actorActive:true});assert.equal(s.monthlyRecoveryRequired,2);assert.equal(s.monthlyRegistered,1);
});

test('stopped and explicitly reclaimed queues stay visible as last-observed retained work, never active delegation',()=>{
 const c=fixture();c.state.colonyControl.records[0].planetId=0;c.state.colonyControl.records[0].status='stopped';
 c.state.colonyUpgradeControl={enabled:true,records:[{sessionId:'s',planetId:3,status:'reclaimed',actions:[{status:'queued'}]},{sessionId:'s',planetId:3,status:'stopped',actions:[{status:'queued'}]},{sessionId:'other',planetId:4,status:'stopped',actions:[{status:'queued'}]}]};
 const s=hybridWorkSummary(c,{actorActive:true});assert.equal(s.localColonies,0);assert.equal(s.upgradeColonies,0);assert.equal(s.colonyQueued,0);assert.equal(s.upgradeQueued,0);assert.equal(s.colonyRetainedQueues,1);assert.equal(s.upgradeRetainedQueues,1);
 c.state.colonyControl.records[0].actions[0].status='completed';assert.equal(hybridWorkSummary(c).colonyRetainedQueues,0);
});
test('dead actors retain only known queued construction; unknown submissions are never described as queued',()=>{
 const c=fixture();c.state.colonyControl.records[0].planetId=0;assert.equal(hybridWorkSummary(c).colonyRetainedQueues,1);
 assert.equal(hybridWorkSummary(c,{actorActive:true}).colonyRetainedQueues,0);
 c.state.colonyControl.records[0].actions[0].status='unknown';assert.equal(hybridWorkSummary(c).colonyRetainedQueues,0);
});

test('campaign display separates inactive records, observed fighting and actual gains without exposing orders',async()=>{
 const {campaignWorkSummary}=await import('../src/hybrid-work-summary.mjs');const cp={stopped:false,state:{gestalt:{campaign:{enabled:true,phase:'combat',reason:'取得边境殖民地',secret:'private',execution:{secret:'private'},observedEvidence:{fight:{kind:'ground_combat'}},result:{success:true,warEnded:true,gainedPlanets:[0]}}}}};
 const r=campaignWorkSummary(cp,{actorActive:true});assert.equal(r.active,true);assert.equal(r.battleObserved,true);assert.equal(r.gainedPlanets,1);assert.equal(JSON.stringify(r).includes('private'),false);assert.equal(campaignWorkSummary(cp).active,false);
 delete cp.state.gestalt.campaign.result.gainedPlanets;assert.equal(campaignWorkSummary(cp).gainKnown,false);assert.equal(campaignWorkSummary(cp).gainedPlanets,null);
});

test('system-only verified gains remain visible separately from colonies',()=>{
 const checkpoint={stopped:true,state:{gestalt:{campaign:{phase:'completed',result:{warEnded:true,success:true,gainedPlanets:[],gainedSystems:[9]},observedEvidence:{s:{kind:'system_occupation'}}}}}};
 const r=campaignWorkSummary(checkpoint);assert.equal(r.gainKnown,true);assert.equal(r.gainedSystems,1);assert.equal(r.gainedPlanets,0);assert.equal(r.occupationObserved,true);
});
