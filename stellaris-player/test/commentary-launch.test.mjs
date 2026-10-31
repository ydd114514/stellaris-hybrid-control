import test from 'node:test';
import assert from 'node:assert/strict';
import {ensureCommentary,COMMENTARY_CAPTION_PROTOCOL} from '../src/commentary-launch.mjs';
const url='http://127.0.0.1:17655',legacy={application:'cyberfish-commentary',pid:2001},modern={...legacy,captionProtocol:COMMENTARY_CAPTION_PROTOCOL};
function dependencies(reads,metadata={pid:2001,url}){
  const calls={stop:[],start:0,metadata:0};let index=0;
  return {calls,options:{currentPid:999,getHealth:async()=>reads[Math.min(index++,reads.length-1)],readMetadata:async()=>{calls.metadata++;return metadata;},stopProcess:async pid=>calls.stop.push(pid),startServer:async()=>{calls.start++;},wait:async()=>{}}};
}
test('modern caption-capable service is reused without reading metadata or stopping',async()=>{
  const {calls,options}=dependencies([modern]);assert.deepEqual(await ensureCommentary(options),{url,existing:true});assert.deepEqual(calls,{stop:[],start:0,metadata:0});
});
test('absent service starts once and must advertise the caption protocol',async()=>{
  const {calls,options}=dependencies([undefined,undefined,modern]);assert.deepEqual(await ensureCommentary(options),{url,existing:false});assert.equal(calls.start,1);assert.deepEqual(calls.stop,[]);
});
test('only matching project metadata allows stopping the exact legacy process once',async()=>{
  const {calls,options}=dependencies([legacy,legacy,undefined,modern]);assert.deepEqual(await ensureCommentary(options),{url,existing:false,upgraded:true});assert.deepEqual(calls.stop,[2001]);assert.equal(calls.start,1);
});
test('legacy pid/address mismatch or missing ownership never stops or starts a process',async()=>{
  for(const metadata of [{pid:2002,url},{pid:2001,url:url+'/'},{pid:2001,url:'http://127.0.0.1:9999'},undefined]){
    const {calls,options}=dependencies([legacy],metadata);if(metadata===undefined)options.readMetadata=async()=>{throw Error('missing');};
    await assert.rejects(ensureCommentary(options),/不会停止|无法核对/);assert.deepEqual(calls.stop,[]);assert.equal(calls.start,0);
  }
  for(const pid of [0,-1,1.2,2147483648,999]){
    const {calls,options}=dependencies([{...legacy,pid}],{pid,url});await assert.rejects(ensureCommentary(options),/不会停止/);assert.deepEqual(calls.stop,[]);
  }
});
test('foreign or changed port owner is never terminated',async()=>{
  const foreign=dependencies([{application:'another-app',pid:2001}]);await assert.rejects(ensureCommentary(foreign.options),/其他程序/);assert.deepEqual(foreign.calls.stop,[]);
  const changed=dependencies([legacy,{...legacy,pid:2002}]);await assert.rejects(ensureCommentary(changed.options),/进程已变化/);assert.deepEqual(changed.calls.stop,[]);assert.equal(changed.calls.start,0);
});
test('legacy shutdown timeout and failed termination never launch a duplicate server',async()=>{
  const stuck=dependencies([legacy]);await assert.rejects(ensureCommentary(stuck.options),/尚未退出/);assert.deepEqual(stuck.calls.stop,[2001]);assert.equal(stuck.calls.start,0);
  const failed=dependencies([legacy]);failed.options.stopProcess=async pid=>{failed.calls.stop.push(pid);throw Object.assign(Error('not authorized'),{code:'EPERM'});};await assert.rejects(ensureCommentary(failed.options),/无法停止/);assert.deepEqual(failed.calls.stop,[2001]);assert.equal(failed.calls.start,0);
});
test('port ownership changing while stopping is not chased with another termination',async()=>{
  const {calls,options}=dependencies([legacy,legacy,{...legacy,pid:3000}]);await assert.rejects(ensureCommentary(options),/另一进程接管/);assert.deepEqual(calls.stop,[2001]);assert.equal(calls.start,0);
});
