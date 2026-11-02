import test from 'node:test';
import assert from 'node:assert/strict';
import {assessAiModCompatibility,assertAiModCompatibility,AI_MOD_IDS,STEERING_CUSTOM_ZONES} from '../src/ai-mod-conflicts.mjs';
const source=(workshopId,supported='4.5.*',files={})=>({workshopId,descriptorText:`name="fixture"\nsupported_version="${supported}"\n`,files:{'common/economic_plans/fixture.txt':'fixture_plan = { }',...files}});

test('BCA 4.4 cannot be passed off as a 4.5 port and its eight missing zones are actionable blockers',()=>{
 const result=assessAiModCompatibility({mods:[source(AI_MOD_IDS.bca,'v4.4.*',{'common/scripted_effects/zones.txt':'# '+STEERING_CUSTOM_ZONES.join(' ')})]});
 assert.equal(result.ok,false);assert.ok(result.blockers.some(row=>row.code==='BCA_GAME_VERSION_UNVERIFIED'));
 assert.deepEqual(result.blockers.find(row=>row.code==='BCA_CUSTOM_ZONES_UNSUPPORTED').details.missingZones,STEERING_CUSTOM_ZONES);
 assert.ok(result.blockers.some(row=>row.code==='BCA_NATIVE_AI_OWNERSHIP_UNVERIFIED'));
 assert.equal(result.enabledByChecker,false);assert.equal(result.runtimeTested,false);
});
test('a 4.4.6 native patch and a standalone BCA jobs submod are blocked without running any installer',()=>{
 const result=assessAiModCompatibility({mods:[source(AI_MOD_IDS.bcaParallel),source(AI_MOD_IDS.bcaJobs)]});
 assert.ok(result.blockers.some(row=>row.code==='BCA_PARALLEL_BINARY_VERSION_MISMATCH'));
 assert.ok(result.blockers.some(row=>row.code==='BCA_JOBS_MISSING_PARENT'));
});
test('unavailable Intelligent files and unreviewed AI overhaul stacking cannot become an asserted compatible install',()=>{
 assert.throws(()=>assertAiModCompatibility({mods:[{workshopId:AI_MOD_IDS.intelligent}]}),error=>error.code==='AI_MOD_COMPATIBILITY_BLOCKED');
 const result=assessAiModCompatibility({mods:[source(AI_MOD_IDS.stellarVanillaJobs),source(AI_MOD_IDS.intelligent)]});
 assert.ok(result.blockers.some(row=>row.code==='AI_OVERHAUL_INTEGRATION_UNVERIFIED'));
 assert.ok(result.warnings.some(row=>row.code==='INTELLIGENT_MODIFICATION_RESTRICTED'));
});
test('one sourced Stellar version remains eligible; disabled alternatives do not prevent installing it',()=>{
 const result=assessAiModCompatibility({mods:[source(AI_MOD_IDS.stellarVanillaJobs),{workshopId:AI_MOD_IDS.bca,enabled:false}]});
 assert.equal(result.ok,true);
 const both=assessAiModCompatibility({mods:[source(AI_MOD_IDS.stellarVanillaJobs),source(AI_MOD_IDS.stellar)]});
 assert.ok(both.blockers.some(row=>row.code==='STELLAR_VARIANTS_TOGETHER'));
});
