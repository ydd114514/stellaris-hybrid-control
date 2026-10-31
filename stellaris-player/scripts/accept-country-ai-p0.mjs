// A1 only: same paused game, no model, no local operating orders, no time advance.
// The candidate must already be explicitly loaded after a manual game restart.
import assert from 'node:assert/strict';
import {mkdir,writeFile,appendFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {NativePipe} from '../src/native-pipe.mjs';
import {inspectNativeProcess} from '../src/native-process.mjs';
import {CountryAIControl} from '../src/country-ai-control.mjs';

const directory=resolve('.local/country-ai-p0-acceptance-'+Date.now());
await mkdir(directory,{recursive:true});
const report={startedAt:new Date().toISOString(),scope:'A1_paused_switch_only',modelCalls:0,gameTimeAdvanced:false,passed:false};
const pipe=new NativePipe();let epoch=0,control,observerArmed=false;
pipe.beforeWrite=()=>{if(epoch&&pipe.connectionEpoch!==epoch)throw Error('桥连接已更换，停止沿用旧国家 AI 权限');};
try {
 const binding=await inspectNativeProcess({op:'identity'});report.binding=binding;
 control=new CountryAIControl({rpc:async(m,p)=>{const result=await pipe.request(m,p);epoch||=pipe.connectionEpoch;return result;},
  assertBinding:async()=>{const now=await inspectNativeProcess({op:'bound_identity',pid:binding.pid,creationTime:binding.creationTime});assert.equal(now.pid,binding.pid);assert.equal(now.creationTime,binding.creationTime);},
  record:async event=>appendFile(resolve(directory,'events.jsonl'),JSON.stringify(event)+'\n')});
 report.before=await control.status();assert.equal(report.before.paused,true);assert.equal(report.before.single_local_human_guard,true);
 if(!process.argv.includes('--execute-paused-flags'))throw Error('只读预检完成；需明确 --execute-paused-flags 才发送 A1 开关命令');
 assert.deepEqual(report.before.global_flags,{normal_ai:true,human_ai:false,force_human_ai:false},'A1 要求原开关均关闭；不覆盖已有托管');
 report.observationStart=await control.call('country_ai_observation',{action:'start',expected:report.before.precondition});
 assert.equal(report.observationStart.success,true);observerArmed=true;
 report.enable=await control.setPausedResearchFlags({human_ai:true,force_human_ai:true});
 assert.equal(report.enable.phase,'paused_confirmed');
 const enabled=await control.status();
 report.duplicate=await control.call('set_country_ai_state',{human_ai:true,force_human_ai:true,expected:enabled.precondition});
 assert.equal(report.duplicate.phase,'already_observed');
 assert.equal(report.duplicate.state.precondition.sequence,enabled.precondition.sequence,'幂等请求不产生新命令');
 report.restore=await control.restorePausedResearchFlags();assert.equal(report.restore.phase,'restored');
 report.after=await control.status();assert.deepEqual(report.after.global_flags,report.before.global_flags);
 assert.equal(report.after.precondition.date,report.before.precondition.date);assert.equal(report.after.country_id,report.before.country_id);
 assert.deepEqual(report.after.human_countries,report.before.human_countries);assert.equal(report.after.paused,true);
 report.passed=true;
} catch(error){report.error=error.stack;process.exitCode=1;}
finally {
 if(control?.original)try {report.finalRestore=await control.restorePausedResearchFlags();}
 catch(error){report.restoreError=error.stack;report.passed=false;process.exitCode=1;}
 if(observerArmed)try {report.observationStop=await control.call('country_ai_observation',{action:'stop'});}
 catch(error){report.observationStopError=error.stack;report.passed=false;process.exitCode=1;}
 pipe.close();report.finishedAt=new Date().toISOString();
 await writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({report:resolve(directory,'report.json'),passed:report.passed,error:report.error,restoreError:report.restoreError}));
}
