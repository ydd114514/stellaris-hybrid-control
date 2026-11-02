import test from 'node:test';
import assert from 'node:assert/strict';
import {countryAIControlTool} from '../src/native-country-ai-tool.mjs';
test('native control schema defaults to full routine ownership and labels each protected entity namespace',()=>{
 const tool=countryAIControlTool(),p=tool.inputSchema.properties;
 assert.equal(p.policy.default,'full_with_reserved');assert.ok(p.policy.enum.includes('full_with_reserved'));
 assert.ok(p.operation.enum.includes('protect'));assert.equal(p.maxWallSeconds.maximum,3600);
 assert.deepEqual(Object.keys(p.protectedTargets.properties),['jobs','colonies','shipyards','fleets']);
 for(const value of Object.values(p.protectedTargets.properties)){
  assert.equal(value.maxItems,256);assert.equal(value.items.minimum,0);assert.equal(value.items.maximum,0xfffffffe);
 }
 assert.match(p.protectedTargets.properties.jobs.description,/CPopJob/);
 assert.match(p.protectedTargets.properties.colonies.description,/CColony.*colony_id.*不是planet_id/);
 assert.match(p.protectedTargets.properties.shipyards.description,/CStarbase.*starbase_id.*不是system_id、fleet_id或queue_id/);
 assert.match(p.protectedTargets.properties.shipyards.description,/科研船和工程船/);
 assert.equal(tool.inputSchema.additionalProperties,false);
});
test('protection schema does not promise selected military-ship blocking or premature activation',()=>{
 const tool=countryAIControlTool();
 assert.match(tool.description,/不能传system_id/);assert.match(tool.description,/不能.*只.*禁止扩军/);
 assert.match(tool.description,/pending_native_revalidation不是已生效/);assert.match(tool.description,/不取消已有施工/);
});
