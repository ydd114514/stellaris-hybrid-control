import test from 'node:test';
import assert from 'node:assert/strict';
import {createCampaign,reviewCampaign,STRATEGY_CARDS,conquestReview} from '../src/gestalt-campaign.mjs';
const state={date:'2200.01.01',snapshotId:'s1',player:{country_id:0},wars:[]};
test('target selection requires benefit and bounded preparation; unknown conditions remain explicit',()=>{
 assert.throws(()=>createCampaign({target:0,reason:'test',reviewDate:'2201.01.01'},state));
 assert.throws(()=>createCampaign({target:1,reason:'test',reviewDate:state.date},state));
 const c=createCampaign({target:1,reason:'控制关键通道',reviewDate:'2201.01.01'},state);assert.equal(c.status,'blocked');assert.equal(STRATEGY_CARDS.length,3);
 reviewCampaign(c,{...state,date:'2201.01.01'});assert.equal(c.status,'review_required');assert.ok(c.gaps.some(g=>g.includes('退出')));
});
test('observed war persists through combat; disappearance enters recovery and never fabricates victory',()=>{
 const c=createCampaign({target:1,reason:'通道',reviewDate:'2201.01.01'},state);c.warId=9;
 reviewCampaign(c,{...state,wars:[{war_id:9}]});assert.equal(c.phase,'combat');
 reviewCampaign(c,{...state,wars:null});assert.equal(c.phase,'combat');
 reviewCampaign(c,state);assert.equal(c.phase,'recover');assert.equal(c.status,'blocked');assert.match(c.nextCheck,/战果|收益/);
});

test('conquest review exposes actionable campaign gaps and never treats unknown wars or cash as readiness',()=>{
 const c={phase:'prepare',target:2,gaps:['运输军未登舰'],nextCheck:'补运输军'};const r=conquestReview({...state,resources:{energy:{stockpile:1000,net:10},alloys:{stockpile:1000,net:10}},gestalt:{campaign:c}});assert.equal(r.stage,'prepare_campaign');assert.deepEqual(r.campaignGaps,['运输军未登舰']);assert.equal(r.target,2);assert.equal(r.automaticDeclaration,false);
 assert.equal(conquestReview({}).warStateKnown,false);assert.match(conquestReview({}).next,/真实战争/);assert.ok(conquestReview(state).economicGaps.length);
});

test('observing an existing configured war preserves peace instead of resetting every step to combat',()=>{
 const c={phase:'peace',execution:{fleetId:0,planets:[]},warId:0,history:[]};
 reviewCampaign(c,{...state,wars:[{war_id:0}]});assert.equal(c.phase,'peace');assert.equal(c.status,'active');assert.equal(c.history.length,0);
 reviewCampaign(c,{...state,wars:[]});assert.equal(c.phase,'recover');
});
