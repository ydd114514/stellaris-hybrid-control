import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {NativePipe, isNativeRejection} from '../src/native-pipe.mjs';

test('expired candidates are harmless rejections; task timeouts and execution faults remain unknown', () => {
  assert.equal(isNativeRejection('hire_leader', -32072, 'Candidate leader ID 50331817 not found'), true);
  assert.equal(isNativeRejection('resolve_event', -32006, 'Event window_id not found among active events'), true);
  assert.equal(isNativeRejection('resolve_event', -32008, 'Exception occurred executing CEventWindow::SelectOption'), false);
  assert.equal(isNativeRejection('build_outpost', -32000, 'Main thread task timed out'), false);
});

function connection(respond) {
  const writes = [];
  const connect = () => {
    const socket = new EventEmitter(); socket.destroyed = false;
    socket.destroy = () => {if (!socket.destroyed) {socket.destroyed = true; queueMicrotask(() => socket.emit('close'));}};
    socket.write = (line, done) => {const request = JSON.parse(line); writes.push(request); done?.(); queueMicrotask(() => respond?.(socket, request));};
    queueMicrotask(() => socket.emit('connect'));
    return socket;
  };
  return {connect, writes};
}

test('UTF-8 game strings survive a pipe chunk boundary', async t => {
  const fake = connection((socket, request) => {
    const data = Buffer.from(JSON.stringify({id: request.id, result: {name: '南门二'}}) + '\n');
    const boundary = data.indexOf(Buffer.from('南')) + 1;
    socket.emit('data', data.subarray(0, boundary)); socket.emit('data', data.subarray(boundary));
  });
  const pipe = new NativePipe(fake); t.after(() => pipe.close());
  assert.deepEqual(await pipe.request('get_status'), {name: '南门二'});
});

test('a native timeout never resends the command', async t => {
  const fake = connection(); const pipe = new NativePipe({...fake, timeoutMs: 20}); t.after(() => pipe.close());
  await assert.rejects(pipe.request('build_outpost', {fleet_id: 0, system_id: 0}), /超时/);
  assert.equal(fake.writes.length, 1);
});

test('two simultaneous requests cannot create competing pipe writes', async t => {
  const fake = connection((socket, request) => socket.emit('data', Buffer.from(JSON.stringify({id: request.id, result: {ok: true}}) + '\n')));
  const pipe = new NativePipe(fake); t.after(() => pipe.close());
  const first = pipe.request('get_status');
  await assert.rejects(pipe.request('get_status'), /顺序执行/);
  await first; assert.equal(fake.writes.length, 1);
});
test('a stop during connection setup suppresses the actual write and still permits later readback',async t=>{
 let stopped=false,socket;const writes=[];
 const pipe=new NativePipe({beforeWrite:method=>{if(stopped&&method!=='get_status')throw Error('停止');},connect:()=>{
  socket=new EventEmitter();socket.destroyed=false;socket.destroy=()=>{socket.destroyed=true;};
  socket.write=line=>{const r=JSON.parse(line);writes.push(r);queueMicrotask(()=>socket.emit('data',Buffer.from(JSON.stringify({id:r.id,result:{is_paused:true}})+'\n')));};
  return socket;
 }});t.after(()=>pipe.close());
 const pending=pipe.request('move_fleet',{fleet_id:0,system_id:1});
 stopped=true;socket.emit('connect');await assert.rejects(pending,/停止/);
 assert.equal(writes.length,0);assert.equal((await pipe.request('get_status')).is_paused,true);
});
test('the per-request cleanup context reaches the final synchronous write guard',async t=>{
 const context={cleanupSessionId:'s'},fake=connection((socket,request)=>socket.emit('data',Buffer.from(JSON.stringify({id:request.id,result:{success:true}})+'\n')));let observed;
 const pipe=new NativePipe({...fake,beforeWrite:(_m,_p,c)=>observed=c});t.after(()=>pipe.close());
 await pipe.request('set_paused',{paused:true},context);assert.equal(observed,context);assert.equal(fake.writes.length,1);
});
test('a reconnect changes generation and cannot reuse a previous connection write context',async t=>{
 const fake=connection((socket,request)=>socket.emit('data',Buffer.from(JSON.stringify({id:request.id,result:{success:true}})+'\n')));
 const pipe=new NativePipe({...fake,beforeWrite:(_m,_p,c)=>{if(c&&c.connectionEpoch!==pipe.connectionEpoch)throw Error('stale connection');}});t.after(()=>pipe.close());
 await pipe.request('get_status');const previous=pipe.connectionEpoch;pipe.close();
 await assert.rejects(pipe.request('move_fleet',{fleet_id:0,system_id:1},{connectionEpoch:previous}),error=>error.nativeWriteAttempted===false&&/stale connection/.test(error.message));
 assert.ok(pipe.connectionEpoch>previous);assert.equal(fake.writes.filter(r=>r.method==='move_fleet').length,0);
});
