// Read-only supplement for work produced during the silent-host expiry window.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {NativePipe} from '../src/native-pipe.mjs';
import {inspectNativeProcess} from '../src/native-process.mjs';
import {nativeCountryScope,COUNTRY_AI_P1_BRIDGE_VERSION} from '../src/native-country-ai.mjs';

const path=resolve(process.argv[2]||'');
assert.ok(process.argv[2],'必须明确指定原始验收报告');
const original=await readFile(path,'utf8'),report=JSON.parse(original);
const checkpoint=JSON.parse(await readFile('.local/native-bridge/latest-session.json','utf8'));
assert.ok(report.passed);assert.equal(checkpoint.sessionId,report.start.snapshotId.split(':')[0]);
const supplement={at:new Date().toISOString(),originalReport:path,
 originalSha256:createHash('sha256').update(original).digest('hex'),readOnly:true,gameTimeAdvanced:false,passed:false,coreGoalComplete:false};
const pipe=new NativePipe();
try{
 supplement.binding=await inspectNativeProcess({op:'bound_identity',pid:checkpoint.binding.pid,creationTime:checkpoint.binding.creationTime});
 assert.equal(supplement.binding.pid,checkpoint.binding.pid);assert.equal(supplement.binding.creationTime,checkpoint.binding.creationTime);
 const ping=await pipe.request('ping');assert.equal(ping.bridge_version,COUNTRY_AI_P1_BRIDGE_VERSION);
 supplement.state=await pipe.request('get_country_ai_state');
 const expected=report.expiry.last_native_state;
 assert.deepEqual(nativeCountryScope(supplement.state),nativeCountryScope(expected));
 assert.equal(supplement.state.precondition.date,expected.precondition.date);
 assert.equal(supplement.state.paused,true);assert.equal(supplement.state.global_flags.human_ai,false);assert.equal(supplement.state.global_flags.force_human_ai,false);
 supplement.colonies=[];supplement.witnesses=[];
 for(const before of report.windows.at(-1).after.colonies){
  const automation=await pipe.request('get_colony_automation',{planet_id:before.planet_id});
  const planet=await pipe.request('get_planet_details',{planet_id:before.planet_id});
  supplement.colonies.push({automation,planet});
  assert.equal(automation.owner_id,supplement.state.country_id);
  assert.equal(automation.queue.known,true);assert.equal(automation.queue.queue_id,before.queue.queue_id);
  assert.equal(planet.colony_id,automation.colony_id);
  const oldIds=new Set(before.queue.items.map(i=>i.item_id));
  const actualIds=new Set(automation.queue.items.map(i=>i.item_id));
  for(const event of report.expiry.observation.events){
   if(event.stage!=='native_execute_returned'||event.domain!=='planet_construction'||event.queue_id!==automation.queue.queue_id||event.colony_reference!==automation.colony_id)continue;
   for(const item of planet.construction_queue){
    if(actualIds.has(item.item_id)&&!oldIds.has(item.item_id)&&item.key===event.definition_key)
     supplement.witnesses.push({domain:'planet_construction',colonyId:automation.colony_id,planetId:before.planet_id,
      queueId:event.queue_id,itemId:item.item_id,definition:item.key,trackingId:event.tracking_id,decisionSequence:event.decision_sequence});
   }
  }
 }
 // Ensure the readback did not accidentally span an external resume or reload.
 const final=await pipe.request('get_country_ai_state');
 assert.deepEqual(final.precondition,supplement.state.precondition);assert.equal(final.paused,true);
 assert.ok(supplement.witnesses.length,'没有可配对的新原生建设项目，不把旧队列算成功');
 supplement.passed=true;
}catch(error){supplement.error=error.stack;process.exitCode=1;}
finally{
 pipe.close();const output=resolve(dirname(path),'construction-readback-supplement.json');
 await writeFile(output,JSON.stringify(supplement,null,2));
 console.log(JSON.stringify({report:output,passed:supplement.passed,witnesses:supplement.witnesses,error:supplement.error}));
}
