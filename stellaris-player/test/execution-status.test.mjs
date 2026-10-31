import test from 'node:test';import assert from 'node:assert/strict';
import {executionStatus} from '../src/execution-status.mjs';import {surveySummary} from '../src/survey-summary.mjs';import {audienceState} from '../src/commentary.mjs';import {controlStatusText} from '../public/control-status.mjs';
const checkpoint=()=>({sessionId:'s',stopped:false,runtimeStatus:{sessionId:'s',observedAt:100,date:'2200.02.01',paused:false},state:{date:'2200.01.01',paused:true,surveyControl:{records:{1:{sessionId:'s',owner:'native',observedAt:100,observation:{orders:[{automation:true},{automation:false}]}}}}}});
test('fresh live execution overrides a frozen decision snapshot without changing that snapshot',()=>{
 const cp=checkpoint(),view=audienceState(cp,100);
 assert.equal(view.date,'2200.02.01');assert.equal(view.paused,false);assert.equal(view.surveyDelegation.working,1);assert.equal(controlStatusText(view),'肥鱼指挥 · 自动调查');assert.equal(cp.state.date,'2200.01.01');assert.equal(cp.state.paused,true);
 cp.runtimeStatus.paused=true;cp.state.paused=false;assert.equal(surveySummary(cp,100).working,0);assert.equal(audienceState(cp,100).paused,true);
});
test('stale, future, malformed or foreign-session runtime cannot advertise live work',()=>{
 for(const mutate of [c=>c.runtimeStatus.observedAt=-10000,c=>c.runtimeStatus.observedAt=101,c=>c.runtimeStatus.sessionId='other',c=>c.runtimeStatus.paused=null]){
  const cp=checkpoint();mutate(cp);const view=audienceState(cp,100);assert.equal(view.executionKnown,false);assert.equal(surveySummary(cp,100).working,0);assert.equal(controlStatusText(view),'局势待核对');
 }
});
test('verified stop cleanup takes precedence over the last long-watch observation',()=>{
 const cp=checkpoint();cp.stopped=true;cp.cleanup={paused:true,date:'2200.03.01'};
 assert.deepEqual(executionStatus(cp,100),{known:true,paused:true,date:'2200.03.01',source:'cleanup'});assert.equal(audienceState(cp,100).date,'2200.03.01');assert.equal(surveySummary(cp,100).working,0);
});
