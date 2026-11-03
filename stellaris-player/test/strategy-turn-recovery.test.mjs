import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,appendFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {NativeStrategyReview} from '../src/native-strategy-review.mjs';
import {runtimeContinuation} from '../src/runtime-continuation.mjs';
import {createStrategyTurnRecovery,latestStrategyModelRequest,readStrategyReviewDeferral,
 requestStrategyReviewDeferral,waitForDifferentStrategyReview} from '../src/strategy-turn-recovery.mjs';

const checkpoint={controllerRunId:'run-1',sessionId:'session-1',started:1000,ends:200000,
 countryAIControl:{enabled:true,owner:'native'},
 state:{snapshotId:'session-1:1',date:'2200.01.01',strategyWakeReasons:['initial_strategy']},
 strategyReview:{id:'review-1',startedAt:2000,inspectedTopics:['edicts']}};
const review={id:'review-1',startedAt:2000,brief:{},wakeReasons:['stagnation'],inspectedTopics:['edicts']};
const capped={at:3000,status:200,stopReason:'max_tokens',outputTokens:32768,toolUse:false,textChars:0,thinkingOnly:true};

test('one decision-only retry per review, then defer once with no acknowledgement or same-review injection',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'strategy-recovery-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 await mkdir(join(directory,'dsh'));
 const append=row=>appendFile(join(directory,'dsh/model-requests.jsonl'),JSON.stringify(row)+'\n');
 const output=[],waited=[];
 const recover=createStrategyTurnRecovery({
  readRequest:()=>latestStrategyModelRequest(directory),
  defer:request=>requestStrategyReviewDeferral(directory,request),
  waitForNextReview:async id=>{waited.push(id);},now:()=>4000,
 });
 const call={checkpoint,review,inject:text=>output.push(text)};
 await append({...capped,at:1200});
 assert.equal(await recover(call),false);
 await append(capped);
 assert.equal(await recover(call),true);
 assert.match(output[0],/达到输出上限.*strategy_contract/);
 assert.match(output[0],/维持理由/);
 assert.doesNotMatch(output[0],/observe|inspect/);
 assert.equal(await readStrategyReviewDeferral(directory),null);
 assert.equal(await recover(call),false,'old metadata cannot spend a second retry');
 await append({...capped,at:3800,stopReason:'end_turn',outputTokens:0,thinkingOnly:false});
 assert.equal(await recover(call),true);
 assert.equal(output.length,1);
 assert.deepEqual(await readStrategyReviewDeferral(directory),{
  runId:'run-1',sessionId:'session-1',reviewId:'review-1',
 });
 assert.deepEqual(waited,['review-1']);
});

test('tool use and ordinary continuation outside a review keep their existing path',async()=>{
 let reads=0;
 const recover=createStrategyTurnRecovery({readRequest:async()=>{
  reads++;return {cursor:1,row:{...capped,toolUse:true}};
 },defer:()=>assert.fail('must not defer'),waitForNextReview:()=>assert.fail('must not wait'),now:()=>4000});
 assert.equal(await recover({checkpoint}),false);
 assert.equal(await recover({checkpoint,review:{...review,brief:null}}),false);
 assert.equal(reads,0,'an unserved heartbeat review cannot consume a retry');
 assert.equal(await recover({checkpoint,review,inject:()=>assert.fail('must not inject')}),false);
 assert.match(runtimeContinuation({...checkpoint,strategyReview:null,state:{...checkpoint.state,strategyWakeReasons:[]}},{now:4000}).text,
  /先核对 country_ai_control 当前持权/);
});

test('deferred headless actor waits silently until a genuinely different review or stop',async()=>{
 const output=[];
 const states=[
  {checkpoint,continuation:{review}},
  {checkpoint,continuation:{}},
  {checkpoint,continuation:{review:{id:'review-2'}}},
 ];
 await waitForDifferentStrategyReview('review-1',{readRun:async()=>states.shift(),wait:async()=>{},
  inject:text=>output.push(text)});
 assert.equal(output.length,1);
 assert.match(output[0],/新的战略复查/);
 await waitForDifferentStrategyReview('review-2',{readRun:async()=>null,wait:async()=>{},
  inject:()=>assert.fail('must not inject after stop')});
});

test('a failed review defers the same wake without consuming progress or disabling new events',()=>{
 let now=0;
 const scheduler=new NativeStrategyReview({now:()=>now});
 const initial={date:'2200.01.01',population:100,wars:[]};
 scheduler.acknowledge(initial);
 const next={...initial,date:'2200.07.01',population:105};
 now=180000;
 assert.deepEqual(scheduler.due(next),['six_month_review']);
 assert.equal(scheduler.defer(next),true);
 assert.deepEqual(scheduler.due(next),[]);
 assert.deepEqual(scheduler.due({...next,wars:[{war_id:0}]}),['strategic_event']);
 assert.equal(scheduler.lastMetrics.pops,100);
 assert.equal(scheduler.stalledReviews,0);
 now=359999;
 assert.deepEqual(scheduler.due({...next,date:'2201.01.01'}),[]);
 now=360000;
 assert.deepEqual(scheduler.due({...next,date:'2201.01.01'}),['six_month_review']);
 assert.equal(scheduler.lastMetrics.pops,100);
});
