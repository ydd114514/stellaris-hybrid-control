import test from 'node:test';import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {NativeGame} from '../src/native-game.mjs';
import {NativePipe} from '../src/native-pipe.mjs';import {EventEmitter} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
const isolatedStop=()=>join(tmpdir(),'fish-stop-'+randomUUID()+'.absent');
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};};
test('stop requested during a held watch prevents its later unpause at the RPC boundary',async()=>{
 const calls=[],picture=deferred(),entered=deferred();
 const game=new NativeGame({stopFile:isolatedStop(),now:()=>Date.now()+1000,pipe:{request:async(m,p)=>{calls.push({m,p});return {success:true,in_game:true,is_paused:false,date:{formatted:'2437.01.01'}};},close(){}}});
 game.ensurePicture=async()=>{entered.resolve();await picture.promise;};game.finishPresentation=async()=>{};
 const waiting=game.watch(20);await entered.promise;
 await game.requestStop('用户停止');picture.resolve();
 await assert.rejects(waiting,/正在停止|用户停止/);
 assert.equal(calls.some(c=>c.m==='set_paused'&&c.p.paused===false),false);
});
test('an already-sent write is accounted separately while the next write is refused and cleanup remains possible',async t=>{
 const calls=[],inFlight=deferred(),entered=deferred();
 const directory=await mkdtemp(join(tmpdir(),'fish-stop-boundary-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const binding={pid:42,creationTime:'fixed'};
 const game=new NativeGame({stopFile:isolatedStop(),directory,processReader:async()=>binding,pipe:{request:async(m,p)=>{calls.push({m,p});if(m==='get_status')return {in_game:true,is_paused:true,date:{formatted:'2200.01.01'}};if(m==='get_galaxy_overview')return {player:{country_id:0,capital_system_id:0}};if(m==='move_fleet'){entered.resolve();return inFlight.promise;}return {success:true};},close(){}}});
 game.binding=binding;game.lastState={date:'2200.01.01',player:{country_id:0,capital_system_id:0}};
 const issued=game.rpc('move_fleet',{fleet_id:0,system_id:1});
 await entered.promise;
 await game.requestStop('用户停止');
 await assert.rejects(game.rpc('move_fleet',{fleet_id:0,system_id:2}),/只允许/);
 await assert.rejects(game.rpc('set_paused',{paused:false}),/只允许/);
 await assert.rejects(game.rpc('set_survey_automation',{fleet_id:0,enabled:true,execute:true}),/只允许/);
 inFlight.resolve({success:true});assert.equal((await issued).success,true);
 await game.rpc('set_survey_automation',{fleet_id:0,enabled:false,execute:true});
 await game.stop();
 assert.equal(calls.filter(c=>c.m==='move_fleet').length,1);
 assert.ok(calls.some(c=>c.m==='set_paused'&&c.p.paused===true));
 await assert.rejects(game.rpc('build_ship',{}),/只允许/);
});

test('a deadline reached during prerequisite reads does not permit a later unpause',async()=>{
 let clock=0;const calls=[];const game=new NativeGame({stopFile:isolatedStop(),now:()=>clock,pipe:{request:async(m,p)=>{calls.push({m,p});return m==='get_active_events'?[]:m==='get_wars'?{wars:[],warGoalsWindow:false}:{success:true};},close(){}}});
 game.guard=async()=>({in_game:true,is_paused:true,date:{formatted:'2200.01.01'}});game.lastState={snapshotId:'x'};game.ensurePicture=async()=>{clock=600001;};game.finishPresentation=async()=>{};game.stop=async()=>{game.stopped=true;};
 const r=await game.watch(20);assert.equal(r.runtimeComplete,true);assert.equal(calls.some(c=>c.m==='set_paused'&&c.p.paused===false),false);
});
test('a cleanup-style write that began before stop cannot bypass fresh scope validation after a held connect',async t=>{
 let socket,entered;const connected=new Promise(done=>entered=done),writes=[];
 const pipe=new NativePipe({connect:()=>{entered();socket=new EventEmitter();socket.destroyed=false;socket.destroy=()=>{socket.destroyed=true;};socket.write=line=>writes.push(JSON.parse(line));return socket;}});t.after(()=>pipe.close());
 const game=new NativeGame({stopFile:isolatedStop(),pipe});game.commandScope=async()=>({});const pending=game.rpc('set_paused',{paused:true});
 await connected;await game.requestStop('停止封口');socket.emit('connect');await assert.rejects(pending,/重新核对原会话/);assert.equal(writes.length,0);
});
test('freshly validated post-stop pause carries the per-request cleanup scope through the native boundary',async t=>{
 const writes=[],binding={pid:42,creationTime:'fixed'};
 const pipe=new NativePipe({connect:()=>{const socket=new EventEmitter();socket.destroyed=false;socket.destroy=()=>{socket.destroyed=true;};socket.write=line=>{const r=JSON.parse(line);writes.push(r);const result=r.method==='get_status'?{in_game:true,is_paused:true,date:{formatted:'2200.01.01'}}:r.method==='get_galaxy_overview'?{player:{country_id:0,capital_system_id:0}}:{success:true};queueMicrotask(()=>socket.emit('data',Buffer.from(JSON.stringify({id:r.id,result})+'\n')));};queueMicrotask(()=>socket.emit('connect'));return socket;}});t.after(()=>pipe.close());
 const game=new NativeGame({stopFile:isolatedStop(),pipe,processReader:async()=>binding});game.binding=binding;game.lastState={date:'2200.01.01',player:{country_id:0,capital_system_id:0}};
 await game.requestStop('停止');assert.equal((await game.rpc('set_paused',{paused:true})).success,true);assert.equal(writes.filter(r=>r.method==='set_paused').length,1);
});
test('ordinary writes without an established session cannot reach the pipe',async()=>{
 const calls=[],game=new NativeGame({stopFile:isolatedStop(),pipe:{request:async(m,p)=>{calls.push({m,p});return {success:true};},close(){}}});
 await assert.rejects(game.rpc('move_fleet',{fleet_id:0,system_id:1}),e=>e.nativeWriteAttempted===false&&/已绑定/.test(e.message));assert.equal(calls.length,0);
});
test('a connection change during world validation invalidates an ordinary write even when IDs still match',async t=>{
 const writes=[],binding={pid:42,creationTime:'fixed'};
 const pipe=new NativePipe({connect:()=>{const socket=new EventEmitter();socket.destroyed=false;socket.destroy=()=>{socket.destroyed=true;};socket.write=line=>{const r=JSON.parse(line);writes.push(r);const result=r.method==='get_status'?{in_game:true,is_paused:true,date:{formatted:'2200.01.01'}}:r.method==='get_galaxy_overview'?{player:{country_id:0,capital_system_id:0}}:{success:true};queueMicrotask(()=>socket.emit('data',Buffer.from(JSON.stringify({id:r.id,result})+'\n')));};queueMicrotask(()=>socket.emit('connect'));return socket;}});t.after(()=>pipe.close());
 const game=new NativeGame({stopFile:isolatedStop(),pipe,processReader:async()=>{pipe.close();return binding;}});game.binding=binding;game.lastState={date:'2200.01.01',player:{country_id:0,capital_system_id:0}};
 await assert.rejects(game.rpc('set_speed',{speed:4}),e=>e.nativeWriteAttempted===false&&/桥连接更换/.test(e.message));assert.equal(writes.some(r=>r.method==='set_speed'),false);
});
test('guard verifies a read connection once per generation and rejects a replaced process after reconnect',async t=>{
 const binding={pid:42,creationTime:'fixed'};let inspections=0,replaced=false;
 const pipe=new NativePipe({connect:()=>{const socket=new EventEmitter();socket.destroyed=false;socket.destroy=()=>{socket.destroyed=true;};socket.write=line=>{const r=JSON.parse(line);queueMicrotask(()=>socket.emit('data',Buffer.from(JSON.stringify({id:r.id,result:{in_game:true,is_paused:true,date:{formatted:'2200.01.01'}}})+'\n')));};queueMicrotask(()=>socket.emit('connect'));return socket;}});t.after(()=>pipe.close());
 const game=new NativeGame({stopFile:isolatedStop(),pipe,processReader:async()=>{inspections++;return replaced?{pid:99,creationTime:'other'}:binding;}});game.binding=binding;
 await game.guard();await game.guard();assert.equal(inspections,1);pipe.close();replaced=true;
 await assert.rejects(game.guard(),/进程身份不匹配/);assert.equal(inspections,2);assert.equal(game.runtimeStatus.paused,null);
});
