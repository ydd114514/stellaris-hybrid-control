import test from 'node:test';
import assert from 'node:assert/strict';
import {waitForGamePicture} from '../src/runtime-preflight.mjs';
test('hidden startup waits locally through probe errors and only returns a real visible picture',async()=>{
  let calls=0;const waiting=[],sleeps=[];
  const result=await waitForGamePicture({probe:async()=>{calls++;if(calls===1)throw new Error('bridge reconnect');return {rendering:true,visible:calls>=3,minimized:calls<3};},onWaiting:x=>waiting.push(x),sleep:ms=>sleeps.push(ms)});
  assert.equal(calls,3);assert.equal(result.visible,true);assert.equal(waiting.length,2);assert.equal(waiting[0].error,'bridge reconnect');assert.deepEqual(sleeps,[2000,2000]);
});
test('new STOP during visibility wait cancels without another probe',async()=>{
  let stopped=false,calls=0;
  const result=await waitForGamePicture({probe:async()=>{calls++;return {visible:false};},isStopped:()=>stopped,sleep:()=>{stopped=true;}});
  assert.equal(result,null);assert.equal(calls,1);
});
