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
