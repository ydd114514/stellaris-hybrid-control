import test from 'node:test';import assert from 'node:assert/strict';
import {nativeCountryAISummary} from '../src/native-country-ai-summary.mjs';
const native=()=>({enabled:true,owner:'native',nativePhase:'running',ordinaryOrdersBlocked:true,paused:false,
 actualFlags:{human_ai:true,force_human_ai:true},domains:['research','planet_construction','unverified'],reviewDue:true});
test('native UI ownership needs actual running flags and an active actor',()=>{
 const cp={stopped:false,countryAIControl:native()};
 const current=nativeCountryAISummary(cp,{actorActive:true});assert.equal(current.owner,'native');assert.equal(current.reviewDue,true);
 assert.deepEqual(current.domains,['research','planet_construction']);
 assert.equal(nativeCountryAISummary(cp,{actorActive:false}).owner,'unconfirmed');
 cp.countryAIControl.actualFlags.human_ai=false;assert.equal(nativeCountryAISummary(cp,{actorActive:true}).owner,'unconfirmed');
});
test('stopped reports stay historical and need full handoff evidence',()=>{
 const cp={stopped:true,countryAIControl:native(),cleanup:{countryAI:{confirmed:true,owner:'human',nativePhase:'stopped',
  ordinaryOrdersBlocked:false,paused:true,actualFlags:{human_ai:false,force_human_ai:false}}}};
 const summary=nativeCountryAISummary(cp);assert.equal(summary.historical,true);assert.equal(summary.owner,'human');assert.match(summary.message,/上轮/);
 cp.cleanup.countryAI.confirmed=false;assert.equal(nativeCountryAISummary(cp).owner,'unconfirmed');
 assert.equal(nativeCountryAISummary({state:{}}),undefined);
});

test('a deferred review is visible only while the native AI still holds control',()=>{
 const checkpoint={state:{strategyReviewNoDecision:{reviewId:'review-1'},strategyWakeReasons:[]},countryAIControl:native()};
 const current=nativeCountryAISummary(checkpoint,{actorActive:true});
 assert.equal(current.reviewNoDecision,true);
 assert.equal(current.reviewDue,false);
 assert.equal(nativeCountryAISummary(checkpoint,{actorActive:false}).reviewNoDecision,false);
 checkpoint.countryAIControl.actualFlags.human_ai=false;
 assert.equal(nativeCountryAISummary(checkpoint,{actorActive:true}).reviewNoDecision,false);
});
