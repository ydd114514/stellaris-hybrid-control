import test from 'node:test';import assert from 'node:assert/strict';
import {analyzeControlEvidence,rpcEvidenceCategory} from '../src/control-evidence.mjs';
const at=ms=>new Date(ms).toISOString();
const fixture=()=>[
 {at:at(0),type:'session_meta',evidenceVersion:1,sessionId:'s',mode:'hybrid',writeBoundaryObserved:true},
 {at:at(1),type:'rpc_write',sequence:1,category:'work',method:'set_survey_automation',afterStop:false},
 ...[[0,false],[1000,false],[2000,true],[3000,true],[10000,true]].map(([ms,paused])=>({at:at(ms),type:'runtime_sample',paused,afterStop:false})),
 {at:at(1500),type:'decision_guard_pause',reasons:['model_response_slow']},
 {at:at(11000),type:'stop_requested',lastWriteSequence:1},
 {at:at(11000),type:'runtime_sample',paused:true,afterStop:true},
 {at:at(11001),type:'rpc_write',sequence:2,category:'cleanup',afterStop:true},
 {at:at(11002),type:'stop',controlEvidence:{incomplete:false,lastWriteSequence:2}},
];
test('evidence separates native attempts, sampled downtime and missing model/work measurements',()=>{
 const result=analyzeControlEvidence(fixture());
 assert.equal(result.writeBoundaryComplete,true);assert.equal(result.forbiddenWritesAfterStop,0);
 assert.deepEqual(result.writeAttempts,{work:1,cleanup:1});
 assert.deepEqual(result.sampledIntervals,{runningMs:1000,pausedMs:1000,uncertainMs:1000,unobservedGapMs:7000,slowResponsePausedMs:1000,spanMs:10000,samples:5});
 for(const key of ['modelRequests','tokens','cost','completedWork'])assert.equal(result[key],null);
});
test('lost sequences, a missing stop boundary or logging failures never prove zero post-stop commands',()=>{
 for(const rows of [[],fixture().filter(r=>r.sequence!==1),fixture().filter(r=>r.type!=='stop_requested'),fixture().map(r=>r.type==='stop'?{...r,controlEvidence:{...r.controlEvidence,incomplete:true}}:r)]){
  const result=analyzeControlEvidence(rows);assert.equal(result.writeBoundaryComplete,false);assert.equal(result.forbiddenWritesAfterStop,null);
 }
 const rows=fixture();rows.find(r=>r.sequence===2).category='work';
 assert.equal(analyzeControlEvidence(rows).forbiddenWritesAfterStop,1);
});
test('dry-run validation and protective cleanup are not new productive work',()=>{
 assert.equal(rpcEvidenceCategory('set_survey_automation',{enabled:true,execute:false}),'validation');
 assert.equal(rpcEvidenceCategory('set_survey_automation',{enabled:false,execute:true}),'cleanup');
 assert.equal(rpcEvidenceCategory('set_survey_automation',{enabled:true,execute:true}),'work');
 assert.equal(rpcEvidenceCategory('get_status'),'read');
});
test('feature flags come from the actual controller metadata, missing or partial scope stays unknown',()=>{
 const rows=fixture();assert.equal(analyzeControlEvidence(rows).featureFlags,null);
 rows[0].featureFlags={colonyUpgrade:true,monthlyLifecycle:false,localWait:true};
 assert.deepEqual(analyzeControlEvidence(rows).featureFlags,{colonyUpgrade:true,monthlyLifecycle:false,localWait:true});
 delete rows[0].featureFlags.localWait;assert.equal(analyzeControlEvidence(rows).featureFlags,null);
});
