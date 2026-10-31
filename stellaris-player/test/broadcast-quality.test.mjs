import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {BroadcastQualityMonitor,readObsQuality} from '../src/broadcast-quality.mjs';
async function folder(t){const d=await mkdtemp(join(tmpdir(),'fish-quality-'));t.after(()=>rm(d,{recursive:true,force:true}));return d;}
test('missing or disabled OBS is unknown, never marked healthy or automatically started',async t=>{const d=await folder(t);const configPath=join(d,'obs.json');assert.equal((await readObsQuality({configPath})).status,'unknown');await writeFile(configPath,JSON.stringify({server_enabled:false,server_password:'SECRET'}));const r=await readObsQuality({configPath,WebSocketImpl:class {constructor(){throw Error('must not connect');}}});assert.equal(r.reason,'not_configured');});
test('sampling is bounded, allowlisted and explicitly does not measure audio isolation or viewer latency',async t=>{const d=await folder(t);let now=0,calls=0;const m=new BroadcastQualityMonitor({directory:d,sessionId:'s',now:()=>now,read:async()=>{calls++;return {status:'observed',stats:{activeFps:60,renderSkippedFrames:2,password:'SECRET'},stream:{active:true,outputReconnecting:true,streamKey:'SECRET'},record:{active:false}};}});await m.tick({date:'2324.01.01',paused:false});await m.tick({});assert.equal(calls,1);const raw=await readFile(join(d,'quality-latest.json'),'utf8');assert.doesNotMatch(raw,/SECRET/);const r=JSON.parse(raw);assert.equal(r.obs.audioIsolation,'not_measured');assert.equal(r.obs.stats.renderSkippedFrames,2);now+=10000;await m.tick({});assert.equal(calls,2);m.stop();now+=10000;await m.tick({});assert.equal(calls,2);});
test('stopping drops late monitoring results without writing into the next session',async t=>{const d=await folder(t);let done;const m=new BroadcastQualityMonitor({directory:d,sessionId:'old',read:()=>new Promise(r=>done=r)});const p=m.tick({});m.stop();done({status:'observed'});await p;assert.deepEqual(await readdir(d),[]);});

function obsSocket({password,salt='test-salt',challenge='test-challenge',failure}={}) {
  const connections=[],frames=[];
  const digest=x=>createHash('sha256').update(x).digest('base64');
  class FakeObsWebSocket {
    constructor(url) {
      this.url=url;this.listeners=new Map();connections.push(this);
      queueMicrotask(()=>this.message({op:0,d:{obsWebSocketVersion:'5.0.0',rpcVersion:1,...(failure==='missing-challenge'?{}:{authentication:{salt,challenge}})}}));
    }
    addEventListener(type,callback) {const list=this.listeners.get(type)||[];list.push(callback);this.listeners.set(type,list);}
    emit(type,event) {for(const callback of this.listeners.get(type)||[])callback(event);}
    message(value) {if(!this.closed)this.emit('message',{data:JSON.stringify(value)});}
    send(raw) {
      const frame=JSON.parse(raw);frames.push(frame);
      if(frame.op===1) {
        assert.equal(frame.d.authentication,digest(digest(password+salt)+challenge));
        queueMicrotask(()=>this.message({op:2,d:{negotiatedRpcVersion:1}}));
      } else if(frame.op===6) {
        const responseData=frame.d.requestType==='GetStats'?{activeFps:60,renderSkippedFrames:2,renderTotalFrames:10000,outputSkippedFrames:0,outputTotalFrames:10000,cpuUsage:13.5,password,streamKey:'FAKE_STREAM_KEY_NEVER_EXPOSE'}:
          frame.d.requestType==='GetStreamStatus'?{outputActive:true,outputReconnecting:true,outputDuration:4000,outputBytes:8192,outputCongestion:0.25,streamKey:'FAKE_STREAM_KEY_NEVER_EXPOSE',password}:
          {outputActive:false,outputDuration:3000,outputBytes:4096,outputPath:'C:/private/DO_NOT_EXPOSE.mp4',password};
        queueMicrotask(()=>this.message({op:7,d:{requestType:frame.d.requestType,requestId:frame.d.requestId,requestStatus:{result:failure!=='request-failed',code:failure==='request-failed'?600:100,comment:password},responseData}}));
      } else throw new Error('Unexpected client opcode '+frame.op);
    }
    close(){this.closed=true;this.emit('close',{});}
  }
  return {WebSocketImpl:FakeObsWebSocket,connections,frames};
}

test('OBS v5 authentication sends hashed credentials and exactly three read-only status requests',async t=>{
  const directory=await folder(t),configPath=join(directory,'obs-test-config.json'),password='OFFLINE_ONLY_PASSWORD_TEST';
  await writeFile(configPath,JSON.stringify({server_enabled:true,auth_required:true,server_port:4455,server_password:password,server_address:'remote.invalid'}),'utf8');
  const socket=obsSocket({password});
  const result=await readObsQuality({configPath,WebSocketImpl:socket.WebSocketImpl,timeoutMs:200});
  assert.equal(result.status,'observed');assert.equal(socket.connections[0].url,'ws://127.0.0.1:4455');assert.equal(socket.connections[0].closed,true);
  assert.deepEqual(socket.frames.map(f=>f.op),[1,6,6,6]);
  assert.equal(socket.frames[0].d.rpcVersion,1);assert.equal(socket.frames[0].d.eventSubscriptions,0);
  assert.deepEqual(socket.frames.slice(1).map(f=>f.d.requestType),['GetStats','GetStreamStatus','GetRecordStatus']);
  assert.ok(socket.frames.slice(1).every(f=>Object.keys(f.d).sort().join(',')==='requestId,requestType'));
  assert.equal(new Set(socket.frames.slice(1).map(f=>f.d.requestId)).size,3);
  assert.doesNotMatch(JSON.stringify(socket.frames),/OFFLINE_ONLY_PASSWORD_TEST|server_password|GetStreamServiceSettings|Set|Start|Stop|Save|FAKE_STREAM_KEY/);
  assert.equal(result.stats.activeFps,60);assert.equal(result.stats.renderSkippedFrames,2);assert.equal(result.stream.reconnecting,true);assert.equal(result.record.active,false);
  assert.equal(result.audioIsolation,'not_measured');assert.equal(result.viewerLatency,'not_measured');
  assert.doesNotMatch(JSON.stringify(result),/OFFLINE_ONLY_PASSWORD_TEST|FAKE_STREAM_KEY|DO_NOT_EXPOSE|outputPath|password/);
  const monitor=new BroadcastQualityMonitor({directory,sessionId:'offline-auth',read:async()=>result});await monitor.tick({date:'2324.01.01'});
  const saved=await readFile(join(directory,'quality-latest.json'),'utf8'),journal=await readFile(join(directory,'quality-offline-auth.jsonl'),'utf8');
  assert.doesNotMatch(saved+journal,/OFFLINE_ONLY_PASSWORD_TEST|FAKE_STREAM_KEY|DO_NOT_EXPOSE|outputPath|password/);
  assert.deepEqual(socket.frames.slice(1).map(f=>f.d.requestType),['GetStats','GetStreamStatus','GetRecordStatus']);
});

test('failed authentication handshake or rejected OBS reads stay unknown without exposing server error details',async t=>{
  const directory=await folder(t),configPath=join(directory,'obs-test-config.json'),password='OFFLINE_AUTH_FAILURE_PASSWORD';
  await writeFile(configPath,JSON.stringify({server_enabled:true,auth_required:true,server_port:4455,server_password:password}),'utf8');
  const missing=obsSocket({password,failure:'missing-challenge'});
  const noAuth=await readObsQuality({configPath,WebSocketImpl:missing.WebSocketImpl,timeoutMs:200});
  assert.deepEqual(noAuth,{status:'unknown',reason:'authentication'});assert.deepEqual(missing.frames,[]);
  const failed=obsSocket({password,failure:'request-failed'});
  const rejection=await readObsQuality({configPath,WebSocketImpl:failed.WebSocketImpl,timeoutMs:200});
  assert.deepEqual(rejection,{status:'unknown',reason:'request_failed'});
  assert.doesNotMatch(JSON.stringify([noAuth,rejection,failed.frames]),/OFFLINE_AUTH_FAILURE_PASSWORD|FAKE_STREAM_KEY|GetStreamServiceSettings|SetStream/);
});
