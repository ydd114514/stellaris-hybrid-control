import test from 'node:test';import assert from 'node:assert/strict';
import {confirmedHostStop,hostStopExitCode} from '../src/dsh-host-stop.mjs';
const fixture=()=>({runId:'r',checkpoint:{controllerRunId:'r',sessionId:'s',stopped:true,started:100},completion:{version:1,runId:'r',sessionId:'s',completedAt:300,pauseConfirmed:true,surveyConfirmed:true},request:{version:1,runId:'r',requestedAt:200}});
test('host shutdown requires this run, session and completed cleanup after the stop request',()=>{
 const m={type:'cyberfish-host-stop',runId:'r',sessionId:'s'};assert.equal(confirmedHostStop(m,fixture()),true);
 for(const mutate of [o=>o.checkpoint.stopped=false,o=>o.completion.sessionId='foreign',o=>o.request.runId='old',o=>o.completion.completedAt=150,o=>o.request.requestedAt=50]){const o=fixture();mutate(o);assert.equal(confirmedHostStop(m,o),false);}
 assert.equal(confirmedHostStop({...m,runId:'old'},fixture()),false);
});
test('cleanup failures and prior agent errors cannot be reported as a clean administrative exit',()=>{
 const o=fixture();assert.equal(hostStopExitCode(o.completion,false),0);assert.equal(hostStopExitCode(o.completion,true),1);
 assert.equal(hostStopExitCode({...o.completion,pauseConfirmed:false},false),1);assert.equal(hostStopExitCode({...o.completion,surveyConfirmed:false},false),1);
 assert.equal(hostStopExitCode({...o.completion,monthlyTradeConfirmed:false},false),1);
});
