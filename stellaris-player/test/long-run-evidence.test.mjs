import test from 'node:test';import assert from 'node:assert/strict';
import {longRunProfile,assessLongRun,liveRunFeatureEnvironment} from '../src/long-run-evidence.mjs';
import {readFile,stat} from 'node:fs/promises';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {fileURLToPath} from 'node:url';import {join} from 'node:path';
function fixture(){const profile=longRunProfile(),checkpoint={started:100000,ends:1900000,sessionId:'s',stopped:true,cleanup:{paused:true,surveyStatus:'confirmed'}};return {profile,checkpoint,nativeStopRequestedAt:1900000,nativeStoppedAt:1900001,sessionIds:['s'],report:{started:90000,ended:1900001,stopReason:'long_run_deadline',exitCode:1,model:{forwardedRequests:80}},controlEvidence:{sessionId:'s',mode:'hybrid',writeBoundaryComplete:true,forbiddenWritesAfterStop:0,featureFlags:{colonyUpgrade:true,monthlyLifecycle:true,localWait:true}}};}
test('continuous long-run duration is separate from bootstrap, pauses and overall acceptance',()=>{const e=assessLongRun(fixture());assert.equal(e.technicalDurationPassed,true);assert.equal(e.observedDurationMs,1800000);assert.equal(e.outerDurationMs,1810001);assert.equal(e.acceptancePassed,false);assert.equal(e.exitCode,1);});
test('short actual interval, restart, unknown cleanup or invalid stop cannot pass using an older outer timer',()=>{for(const change of [x=>x.report.ended=1899999,x=>x.nativeStopRequestedAt=1899999,x=>delete x.nativeStopRequestedAt,x=>x.nativeStoppedAt=1899999,x=>x.sessionIds=['s','s2'],x=>x.controlEvidence.sessionId='s2',x=>x.checkpoint.cleanup.paused=false,x=>x.controlEvidence.forbiddenWritesAfterStop=1,x=>x.controlEvidence.writeBoundaryComplete=false,x=>x.report.stopReason='model_request_limit',x=>x.report.model.forwardedRequests=201,x=>x.profile.surveyPilot=true,x=>delete x.checkpoint.started]){const x=fixture();change(x);assert.equal(assessLongRun(x).technicalDurationPassed,false);}});
test('only explicit 30/60 minute normal hybrid profiles use the long-run entry',()=>{for(const minutes of [0,10,20,61,NaN])assert.throws(()=>longRunProfile({minutes}));assert.equal(longRunProfile({minutes:60}).surveyPilot,false);assert.throws(()=>longRunProfile({maxRequests:201}));});

test('full duration and an intended profile cannot replace actual delivered-feature evidence',()=>{
 for(const change of [x=>delete x.controlEvidence.featureFlags,x=>x.controlEvidence.featureFlags.localWait=false,x=>x.controlEvidence.featureFlags.monthlyLifecycle='1',x=>delete x.profile.requiredFeatureFlags]){
  const x=fixture();change(x);const r=assessLongRun(x);assert.equal(r.technicalDurationPassed,false);assert.equal(r.featureScopeConfirmed,false);assert.ok(r.failures.some(f=>f.includes('当前交付')));
 }
 for(const value of [false,true])assert.deepEqual(Object.values(liveRunFeatureEnvironment({longRun:value})),Array(3).fill(value?'1':'0'));
 assert.throws(()=>liveRunFeatureEnvironment({longRun:'true'}));
});

test('actual dry-run CLI prepares production feature flags without starting a model or game',async()=>{
 const cwd=fileURLToPath(new URL('../',import.meta.url));
 const {stdout}=await promisify(execFile)(process.execPath,['scripts/run-hybrid-live.mjs','--long-run'],{cwd,windowsHide:true,timeout:5000,env:{...process.env,DEEPSEEK_API_KEY:'',CYBERFISH_PILOT_MODE:'hybrid',CYBERFISH_PILOT_MINUTES:'30',CYBERFISH_PILOT_REQUESTS:'20',CYBERFISH_SURVEY_REUSE_STATE:'0',...liveRunFeatureEnvironment({longRun:false})}});
 const output=JSON.parse(stdout.trim());assert.equal(output.stage,'prepared');assert.equal(output.realModelCalls,0);
 const manifest=JSON.parse(await readFile(join(output.directory,'manifest.json'),'utf8'));
 assert.deepEqual(manifest.featureEnvironment,liveRunFeatureEnvironment({longRun:true}));assert.equal(manifest.execute,false);
 assert.deepEqual(manifest.longProfile.requiredFeatureFlags,{colonyUpgrade:true,monthlyLifecycle:true,localWait:true});
 await assert.rejects(stat(join(output.directory,'report.json')),{code:'ENOENT'});
});

test('bounded normal verification keeps productive tools without claiming a long run or applying survey-only restrictions',async()=>{
 const cwd=fileURLToPath(new URL('../',import.meta.url));
 const {stdout}=await promisify(execFile)(process.execPath,['scripts/run-hybrid-live.mjs','--normal'],{cwd,windowsHide:true,timeout:5000,env:{...process.env,DEEPSEEK_API_KEY:'',CYBERFISH_PILOT_MODE:'hybrid',CYBERFISH_PILOT_MINUTES:'3',CYBERFISH_PILOT_REQUESTS:'80',CYBERFISH_SURVEY_REUSE_STATE:'1'}});
 const output=JSON.parse(stdout.trim()),manifest=JSON.parse(await readFile(join(output.directory,'manifest.json'),'utf8'));
 assert.equal(output.realModelCalls,0);assert.equal(manifest.minutes,3);assert.equal(manifest.longProfile,null);assert.match(manifest.scope,/bounded normal hybrid/);
 assert.deepEqual(manifest.featureEnvironment,liveRunFeatureEnvironment({longRun:true}));
 const patch=await readFile(output.patchFile,'utf8');assert.ok(patch.includes('survey_routing'));assert.equal(patch.includes('本轮运行器只允许科研选择'),false);
});

test('normal manual baseline retains production features and a manual survey brief without enabling the long-run entry',async()=>{
 const cwd=fileURLToPath(new URL('../',import.meta.url)),env={...process.env,DEEPSEEK_API_KEY:'',CYBERFISH_PILOT_MODE:'baseline',CYBERFISH_PILOT_MINUTES:'3',CYBERFISH_PILOT_REQUESTS:'80'};
 const {stdout}=await promisify(execFile)(process.execPath,['scripts/run-hybrid-live.mjs','--normal'],{cwd,windowsHide:true,timeout:5000,env});
 const output=JSON.parse(stdout.trim()),manifest=JSON.parse(await readFile(join(output.directory,'manifest.json'),'utf8'));
 assert.equal(output.realModelCalls,0);assert.equal(manifest.mode,'baseline');assert.deepEqual(manifest.featureEnvironment,liveRunFeatureEnvironment({longRun:true}));
 await assert.rejects(promisify(execFile)(process.execPath,['scripts/run-hybrid-live.mjs','--long-run'],{cwd,windowsHide:true,timeout:5000,env:{...env,CYBERFISH_PILOT_MINUTES:'30'}}),/连续长测仅支持hybrid/);
});

test('conquest preparation uses production hybrid features and a distinct gameplay scope, with zero model calls',async()=>{
 const cwd=fileURLToPath(new URL('../',import.meta.url));const {stdout}=await promisify(execFile)(process.execPath,['scripts/run-hybrid-live.mjs','--conquest'],{cwd,windowsHide:true,timeout:5000,env:{...process.env,DEEPSEEK_API_KEY:'',CYBERFISH_PILOT_MODE:'hybrid',CYBERFISH_PILOT_MINUTES:'20',CYBERFISH_PILOT_REQUESTS:'200'}});const output=JSON.parse(stdout.trim()),manifest=JSON.parse(await readFile(join(output.directory,'manifest.json'),'utf8'));
 assert.equal(output.realModelCalls,0);assert.equal(manifest.conquestRun,true);assert.equal(manifest.longProfile,null);assert.match(manifest.scope,/conquest/);assert.deepEqual(manifest.featureEnvironment,liveRunFeatureEnvironment({longRun:true}));assert.ok(JSON.parse(await readFile(join(output.directory,'source-start.json'),'utf8')).hashes['src/first-war.mjs']);
});
