import test from 'node:test';
import assert from 'node:assert/strict';
import {countryAIControlTool} from '../src/native-country-ai-tool.mjs';
test('normal DSH schema retains verified r2 scope without silently exposing the economic candidate',()=>{
 const tool=countryAIControlTool();
 assert.deepEqual(tool.inputSchema.properties.policy.enum,['research','planet_construction','research_and_planet_construction']);
 assert.equal(tool.inputSchema.properties.operation.enum.includes('protect'),false);
 assert.equal(tool.inputSchema.properties.protectedTargets,undefined);
});
test('explicit economic schema exposes strategic protection with full handles and honest pending status',()=>{
 const tool=countryAIControlTool({economyCandidate:true}),p=tool.inputSchema.properties;
 assert.ok(p.operation.enum.includes('protect'));assert.ok(p.policy.enum.includes('economy_and_ship_production'));
 assert.deepEqual(Object.keys(p.protectedTargets.properties),['jobs','colonies','shipyards']);
 for(const value of Object.values(p.protectedTargets.properties)){
  assert.equal(value.maxItems,256);assert.equal(value.items.minimum,0);assert.equal(value.items.maximum,0xfffffffe);
 }
 assert.match(tool.description,/pending_native_revalidation不是已生效/);
 assert.match(tool.description,/不取消已有施工/);assert.equal(tool.inputSchema.additionalProperties,false);
});
