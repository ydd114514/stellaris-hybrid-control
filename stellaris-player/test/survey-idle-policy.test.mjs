import test from 'node:test';import assert from 'node:assert/strict';
import {surveyGameDay,surveyIdleReason} from '../src/survey-idle-policy.mjs';
test('paused wall time and slow simulation never consume the engine search cooldown',()=>{
 const r={};assert.equal(surveyIdleReason(r,{gameDate:'2200.01.01',now:0}),null);
 assert.equal(surveyIdleReason(r,{gameDate:'2200.01.01',now:600000}),null);
 assert.equal(surveyIdleReason(r,{gameDate:'2200.01.30',now:610000}),null);
 assert.equal(surveyIdleReason(r,{gameDate:'2200.02.02',now:611000}),'survey_no_work');
});
test('fast game time alone does not remove the minimum bounded real observation',()=>{
 const r={};surveyIdleReason(r,{gameDate:'2200.01.01',now:100});
 assert.equal(surveyIdleReason(r,{gameDate:'2201.01.01',now:15099}),null);
 assert.equal(surveyIdleReason(r,{gameDate:'2201.01.01',now:15100}),'survey_no_work');
});
test('unknown dates and either clock moving backwards require state reconciliation',()=>{
 for(const gameDate of [undefined,'2200.01.31','2200.13.01','bad'])assert.equal(surveyIdleReason({},{gameDate,now:0}),'survey_state_unknown');
 const r={};surveyIdleReason(r,{gameDate:'2200.01.01',now:100});surveyIdleReason(r,{gameDate:'2200.01.20',now:200});
 assert.equal(surveyIdleReason(r,{gameDate:'2200.01.19',now:300}),'survey_state_unknown');
 assert.equal(surveyIdleReason(r,{gameDate:'2200.01.21',now:99}),'survey_state_unknown');
 for(const damaged of [{idleGameDay:0},{idleLastGameDay:0},{idleGameDay:-1,idleLastGameDay:0,idleSince:0},{idleGameDay:null,idleSince:0}])assert.equal(surveyIdleReason(damaged,{gameDate:'2200.01.01',now:100}),'survey_state_unknown');
 assert.equal(surveyGameDay('2201.01.01')-surveyGameDay('2200.12.30'),1);
});
