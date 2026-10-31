import test from 'node:test';import assert from 'node:assert/strict';import {benchmarkStartFingerprint,compareSurveyBranches} from '../src/survey-benchmark.mjs';
const state=()=>({date:'2202.07.01',paused:true,speed:2,player:{country_id:0},resources:{energy:{stockpile:1000}},research:{},civilian:{},capacities:{},council:{},traditions:{},wars:[],pendingEvents:[]});
function branch(mode,requests){return {spec:{mode,initialSaveSha256:'a'.repeat(64),initialDate:'2202.07.01',minutes:10,maxRequests:80,speed:2,model:'deepseek-flash',scope:'single_science_ship'},readyState:state(),preflightPassed:true,fullTimedBranch:true,stopConfirmed:true,run:{actualMode:mode,modelRequests:requests,requestedModels:['deepseek-flash'],serverModels:['deepseek-flash'],controlEvidence:{writeBoundaryComplete:true,forbiddenWritesAfterStop:0,bridgeVersion:'test-reviewed-bridge'}},trackedSystems:[{id:58,before:{id:58,surveyed:false},after:{id:58,surveyed:true}}]};}
test('a matched observed start and identical completed targets support only a bounded request comparison',()=>{
 const r=compareSurveyBranches(branch('baseline',40),branch('hybrid',20));assert.equal(r.matchedObservedStart,true);assert.equal(r.requestReductionPercent,50);assert.equal(r.costReductionPercent,null);assert.equal(r.worldLineageVerified,false);
});
test('different saves, settings, observed resources, modes or incomplete cleanup never produce a saving percentage',()=>{
 for(const mutate of [b=>b.spec.initialSaveSha256='b'.repeat(64),b=>b.spec.speed=4,b=>b.readyState.resources.energy.stockpile=999,b=>b.fullTimedBranch=false,b=>b.stopConfirmed=false,b=>b.run.actualMode='baseline',b=>delete b.run.modelRequests,b=>b.run.serverModels=['different-model'],b=>delete b.run.requestedModels,b=>delete b.run.controlEvidence.bridgeVersion,b=>delete b.trackedSystems[0].after]){
  const b=branch('hybrid',20);mutate(b);const r=compareSurveyBranches(branch('baseline',40),b);assert.equal(r.matchedObservedStart,false);assert.equal(r.requestReductionPercent,null);
 }
});
test('different completed workloads and missing start evidence do not become zero-cost or efficiency claims',()=>{
 const b=branch('hybrid',20);b.trackedSystems[0].after.surveyed=false;const r=compareSurveyBranches(branch('baseline',40),b);assert.equal(r.matchedObservedStart,true);assert.equal(r.requestReductionPercent,null);assert.equal(r.hybrid.usage,null);
 assert.throws(()=>benchmarkStartFingerprint({}),/缺少/);assert.equal(compareSurveyBranches({},{}).requestReductionPercent,null);
});

test('a final paused read alone cannot validate work completed after an incomplete or violated stop boundary',()=>{
 for(const mutate of [b=>b.run.controlEvidence.writeBoundaryComplete=false,b=>delete b.run.controlEvidence.writeBoundaryComplete,b=>b.run.controlEvidence.forbiddenWritesAfterStop=null,b=>b.run.controlEvidence.forbiddenWritesAfterStop=1]){
  const b=branch('hybrid',20);mutate(b);const r=compareSurveyBranches(branch('baseline',40),b);
  assert.equal(r.matchedObservedStart,false);assert.equal(r.requestReductionPercent,null);assert.ok(r.failures.some(x=>x.includes('停止写入边界')));
 }
});

test('different coverage protocols cannot retrofit a broader cohort onto old evidence',()=>{
 const b=branch('hybrid',20);b.spec.coverage='fixed_capital_radius_v2';b.spec.cohortJumps=3;
 const r=compareSurveyBranches(branch('baseline',40),b);assert.equal(r.matchedObservedStart,false);assert.equal(r.requestReductionPercent,null);
});

test('declared experimental wait settings require the actual native metadata and matching adapter sources',()=>{
 const a=branch('baseline',40),b=branch('hybrid',20);a.spec.adapterRevision=b.spec.adapterRevision='same';a.spec.hybridWatchSeconds=b.spec.hybridWatchSeconds=90;
 a.spec.nativeWatchSeconds=20;b.spec.nativeWatchSeconds=90;a.run.controlEvidence.watchMaximumSeconds=20;b.run.controlEvidence.watchMaximumSeconds=90;
 assert.equal(compareSurveyBranches(a,b).matchedObservedStart,true);
 b.run.controlEvidence.watchMaximumSeconds=60;assert.equal(compareSurveyBranches(a,b).requestReductionPercent,null);
 b.run.controlEvidence.watchMaximumSeconds=90;b.spec.adapterRevision='changed';assert.equal(compareSurveyBranches(a,b).matchedObservedStart,false);
});
