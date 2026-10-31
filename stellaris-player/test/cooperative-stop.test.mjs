import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,utimes} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {writeStopRequest,readStopRequest,writeStopCompletion,readStopCompletion,stopControlledChild} from '../src/cooperative-stop.mjs';
test('run-specific stop requests and completions reject stale or foreign records',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'fish-cooperative-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const options={directory,runId:'new-run',baseline:100,now:200,stopFile:join(directory,'absent')};
 await writeStopRequest(directory,{runId:'old-run',reason:'stop',now:150});assert.equal(await readStopRequest(options),null);
 await writeStopRequest(directory,{runId:'new-run',reason:'stop',now:90});assert.equal(await readStopRequest(options),null);
 await writeStopRequest(directory,{runId:'new-run',reason:'stop',now:150});assert.match(await readStopRequest(options),/本轮/);
 await writeStopCompletion(directory,{runId:'new-run',sessionId:'s',now:160,cleanup:{pauseConfirmed:true,survey:[{confirmed:true}]}});
 assert.equal(await readStopCompletion(directory,{runId:'other',requestedAt:150}),null);assert.equal(await readStopCompletion(directory,{runId:'new-run',requestedAt:170}),null);
 assert.equal((await readStopCompletion(directory,{runId:'new-run',requestedAt:150})).pauseConfirmed,true);
 const stopFile=join(directory,'STOP');await writeFile(stopFile,'stop');await utimes(stopFile,new Date(1000),new Date(1000));
 assert.match(await readStopRequest({...options,runId:'other',stopFile}),/停止指令/);
});
test('supervisor allows cleanup to complete before terminating a still-live model host',async()=>{
 let clock=0,polls=0,terminated=0,live=true;
 const r=await stopControlledChild({alive:()=>live,request:async()=>({requestedAt:0}),completion:async()=>++polls===3?{sessionId:'s',pauseConfirmed:true}:null,terminate:async()=>{terminated++;live=false;},now:()=>clock,sleep:async ms=>clock+=ms});
 assert.equal(r.method,'cooperative_cleanup_then_exit');assert.equal(terminated,1);assert.equal(clock,500);
});
test('timeout and request-write failure force termination; already-exited children are never killed',async()=>{
 let clock=0,kills=0;
 const common={alive:()=>true,request:async()=>({}),completion:async()=>null,terminate:async()=>{kills++;},now:()=>clock,sleep:async ms=>clock+=ms,timeoutMs:1000};
 assert.equal((await stopControlledChild(common)).method,'forced_timeout');assert.equal(kills,1);
 assert.equal((await stopControlledChild({...common,request:async()=>{throw Error('disk failure');}})).method,'forced_request_failed');assert.equal(kills,2);
 assert.equal((await stopControlledChild({...common,alive:()=>false})).method,'already_exited');assert.equal(kills,2);
});
test('actual child exit while waiting ends the wait without requiring a state file',async()=>{
 let live=true,kills=0;const r=await stopControlledChild({alive:()=>live,request:async()=>({}),completion:async()=>null,terminate:async()=>{kills++;},sleep:async()=>{live=false;}});
 assert.equal(r.method,'exited_during_cleanup');assert.equal(kills,0);
});
test('completed cleanup requests a natural host exit before considering force',async()=>{
 let live=true,clock=0,kills=0,requested=0;
 const r=await stopControlledChild({alive:()=>live,request:async()=>({}),completion:async()=>({sessionId:'s'}),requestExit:async()=>{requested++;},terminate:async()=>{kills++;},now:()=>clock,sleep:async ms=>{clock+=ms;if(clock>=300)live=false;}});
 assert.equal(r.method,'cooperative_cleanup_then_natural_exit');assert.equal(requested,1);assert.equal(kills,0);
});
test('a host ignoring graceful exit is still forcibly stopped within the bound',async()=>{
 let clock=0,kills=0;
 const r=await stopControlledChild({alive:()=>true,request:async()=>({}),completion:async()=>({}),requestExit:async()=>{},terminate:async()=>{kills++;},now:()=>clock,sleep:async ms=>clock+=ms,exitGraceMs:500});
 assert.equal(r.method,'forced_host_exit_timeout');assert.equal(kills,1);assert.equal(clock,500);
});
test('explicitly unknown binding takes precedence over stale positive cleanup booleans in completion',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'fish-cooperative-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const r=await writeStopCompletion(directory,{runId:'r',sessionId:'s',cleanup:{bindingConfirmed:false,paused:true,pauseConfirmed:true,survey:[],monthlyTrade:{confirmed:true}}});
 assert.equal(r.pauseConfirmed,false);assert.equal(r.surveyConfirmed,false);assert.equal(r.monthlyTradeConfirmed,false);
});
