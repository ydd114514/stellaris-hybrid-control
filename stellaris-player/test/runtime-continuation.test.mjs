import test from 'node:test';
import assert from 'node:assert/strict';
import {runtimeContinuation} from '../src/runtime-continuation.mjs';
test('premature narration may continue inside the original authorized runtime',()=>{
  const checkpoint={started:1000,ends:61000,state:{snapshotId:'same-session:2'}};
  const result=runtimeContinuation(checkpoint,{now:11000});assert.equal(result.remaining,50);assert.match(result.text,/同一游戏和控制器/);
  assert.equal(checkpoint.ends,61000);
});
test('runtime continuation never overrides STOP, terminal state or the original deadline',()=>{
  const cp={started:1000,ends:61000,state:{snapshotId:'x'}};
  assert.equal(runtimeContinuation(cp,{now:61000}),null);
  assert.equal(runtimeContinuation(cp,{now:11000,stopAt:1000}),null);
  assert.equal(runtimeContinuation({...cp,stopped:true},{now:11000}),null);
  assert.equal(runtimeContinuation({...cp,state:{snapshotId:'x',terminal:{kind:'defeat'}}},{now:11000}),null);
  assert.equal(runtimeContinuation({ends:61000},{now:11000}),null);
});
test('continuation uses the advertised watch limit without inventing a larger authorization or a fixed short polling loop',()=>{
 const cp={started:1000,ends:61000,state:{snapshotId:'x'}};
 const r=runtimeContinuation(cp,{now:11000});assert.match(r.text,/watch工具公布的上限/);assert.ok(!r.text.includes('15..20'));assert.equal(cp.ends,61000);
 for(const broken of [{...cp,started:undefined},{...cp,started:70000},{...cp,ends:500}])assert.equal(runtimeContinuation(broken,{now:11000}),null);
});

test('native continuation resumes the pending decision without rechecking ownership or repeating reads',()=>{
  const checkpoint={sessionId:'s',started:1000,ends:61000,countryAIControl:{enabled:true,owner:'native'},
    strategyReview:{id:'s:review:2',startedAt:5000,inspectedTopics:['edicts']},
    strategyContract:{goals:[{metric:'pops',target:100}]},
    state:{snapshotId:'s:2',date:'2200.07.01',strategyWakeReasons:['six_month_review'],strategyBrief:{metrics:{}}}};
  const result=runtimeContinuation(checkpoint,{now:11000});
  assert.equal(result.remaining,50);
  assert.equal(result.review.id,'s:review:2');
  assert.deepEqual(result.review.inspectedTopics,['edicts']);
  assert.doesNotMatch(result.text,/核对.*持权|observe|inspect/u);
  assert.match(result.text,/strategy_contract.*continue.*公开理由/u);

  checkpoint.state.strategyWakeReasons.push('stagnation');
  assert.match(runtimeContinuation(checkpoint,{now:11000}).text,/维持理由/u);
  checkpoint.state.strategyWakeReasons=[];
  const ordinary=runtimeContinuation(checkpoint,{now:11000});
  assert.equal(ordinary.review,undefined);
  assert.match(ordinary.text,/先核对 country_ai_control 当前持权/u);
});

test('legacy pending checkpoints use one stable fallback review key without a fresh snapshot',()=>{
  const checkpoint={sessionId:'old',started:1000,ends:61000,nativeStrategicReviewDue:true,
    countryAIControl:{enabled:true,owner:'native'},state:{snapshotId:'old:1'}};
  const first=runtimeContinuation(checkpoint,{now:11000});
  checkpoint.state.snapshotId='old:2';
  const second=runtimeContinuation(checkpoint,{now:12000});
  assert.equal(first.review.id,second.review.id);
  assert.match(second.text,/watch 读取本次简报/u);
  assert.doesNotMatch(second.text,/核对.*持权|observe|inspect/u);
});
