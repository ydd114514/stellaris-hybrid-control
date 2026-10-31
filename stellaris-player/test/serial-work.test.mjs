import test from 'node:test';
import assert from 'node:assert/strict';
import {SerialWork} from '../src/serial-work.mjs';

test('idle polls do not overlap tools or accumulate during a long watch',async()=>{
  const queue=new SerialWork(),events=[];let finish;
  const tool=queue.run(async()=>{events.push('tool');await new Promise(done=>finish=done);events.push('done');});
  await Promise.resolve();for(let i=0;i<20;i++)assert.equal(await queue.idle(()=>events.push('poll')),false);
  const next=queue.run(()=>events.push('next'));finish();await tool;await next;assert.deepEqual(events,['tool','done','next']);
  assert.equal(await queue.idle(()=>events.push('poll')),true);await queue.drain();assert.equal(queue.pending,0);
});
test('a failed monitor does not block subsequent tool work',async()=>{
  const queue=new SerialWork();await assert.rejects(queue.idle(()=>{throw new Error('read failed')}),/read failed/);
  assert.equal(await queue.run(()=>42),42);await queue.drain();assert.equal(queue.pending,0);
});
