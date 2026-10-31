import test from 'node:test';
import assert from 'node:assert/strict';
import {surveySummary} from '../src/survey-summary.mjs';
test('stopped or stale native assignments are uncertain, never live work',()=>{
 const checkpoint={sessionId:'s',stopped:false,state:{paused:false,surveyControl:{records:{0:{sessionId:'s',owner:'native',observedAt:100,observation:{orders:[{automation:true},{automation:false}]}}}}}};
 assert.deepEqual(surveySummary(checkpoint,100),{assigned:1,working:1,uncertain:0});
 assert.deepEqual(surveySummary(checkpoint,15101),{assigned:0,working:0,uncertain:1});
 assert.deepEqual(surveySummary(checkpoint,99),{assigned:0,working:0,uncertain:1});
 checkpoint.stopped=true;
 assert.deepEqual(surveySummary(checkpoint,100),{assigned:0,working:0,uncertain:1});
 checkpoint.stopped=false;checkpoint.state.paused=true;
 assert.deepEqual(surveySummary(checkpoint,100),{assigned:1,working:0,uncertain:0});
});
test('malformed checkpoint records cannot crash status rendering or invent work',()=>{
 assert.deepEqual(surveySummary({state:{surveyControl:{records:{0:null,1:'bad'}}}},100),{assigned:0,working:0,uncertain:2});
 assert.deepEqual(surveySummary({state:{surveyControl:{records:[]}}},100),{assigned:0,working:0,uncertain:0});
});
