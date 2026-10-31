import test from 'node:test';
import assert from 'node:assert/strict';
import {researchZoneOverrides} from '../src/steering-zone-overrides.mjs';
const names=['zone_research','zone_research_physics','zone_research_society','zone_research_engineering'];
test('local generation adds conditional science weights while retaining balance, potential and non-player defaults',()=>{
 const source=names.map((name,i)=>name+' = {\n potential = { always = yes }\n cost = { minerals = 123 }\n description = "brace } # inside string"\n # brace } in comment\n'+(i===1?' additional_ai_weight = { modifier = { add = 1 always = yes } }\n':'')+'}\n').join('\n')+'zone_trade = { cost = 99 }';
 const mod=researchZoneOverrides(source);
 assert.equal((mod.match(/has_edict = cfsteer_economy_research/g)??[]).length,4);
 assert.equal((mod.match(/minerals = 123/g)??[]).length,4);
 assert.equal((mod.match(/additional_ai_weight/g)??[]).length,4);
 assert.match(mod,/add = 1 always = yes/);assert.doesNotMatch(mod,/zone_trade/);
 assert.throws(()=>researchZoneOverrides('zone_research = {'),/不完整/);
 assert.throws(()=>researchZoneOverrides(''),/定义缺失/);
});
