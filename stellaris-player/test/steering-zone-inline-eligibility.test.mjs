import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {researchZoneOverrides,loadZoneInlineScripts,generateSteeringZoneOverrides} from '../src/steering-zone-overrides.mjs';
import {scriptBlocks,generateStellarSteeringCompatibility} from '../src/stellar-steering-compat.mjs';

const body=row=>row.text.slice(row.text.indexOf('{')+1,-1);
const roots=text=>scriptBlocks(text);
function assertOnePotential(text){
 const entries=roots(text);assert.equal(entries.length,4);
 for(const entry of entries){
  const potentials=roots(body(entry)).filter(row=>row.key==='potential');
  assert.equal(potentials.length,1,entry.key+' must have one effective root potential');
  assert.match(potentials[0].text,/has_edict = cfsteer_economy_/);
 }
 return entries;
}
test('inline and visible eligibility are conjoined once; nested modifiers and parameterised jobs remain intact',()=>{
 const names=['zone_research','zone_research_physics','zone_research_society','zone_research_engineering'];
 const source=names.map(key=>`${key} = { inline_script = { script = zones/shared_test AMOUNT = 500 } potential = { has_planet_flag = visible_eligibility } }`).join('\n');
 const inlineScripts=new Map([['zones/shared_test','potential = { owner = { is_spiritualist = yes } } inline_script = { script = jobs/zone_researchers_add AMOUNT = $AMOUNT$ } triggered_planet_modifier = { potential = { has_planet_flag = nested_only } science = 1 }']]);
 const result=researchZoneOverrides(source,{inlineScripts});
 for(const entry of assertOnePotential(result)){
  const fields=roots(body(entry)),potential=fields.find(row=>row.key==='potential').text;
  assert.match(potential,/is_spiritualist = yes/);assert.match(potential,/has_planet_flag = visible_eligibility/);
  assert.doesNotMatch(potential,/nested_only/);assert.match(entry.text,/potential = \{ has_planet_flag = nested_only \}/);
  assert.match(entry.text,/script = jobs\/zone_researchers_add AMOUNT = 500/);
 }
 assert.throws(()=>researchZoneOverrides(source),/资格定义未读取/);
});

const game=process.env.STELLARIS_GAME_DIR??'D:/SteamLibrary/steamapps/common/Stellaris';
const stellar=process.env.STELLARIS_STELLAR_AI_DIR??'C:/Tools/SteamCMD/steamapps/workshop/content/281990/3686836322';
function verifyActualEligibility(text,inlineScripts){
 const entries=assertOnePotential(text),byName=new Map(entries.map(row=>[row.key,row]));
 for(const [name,path]of [['zone_unity','zones/shared_unity_zone'],['zone_unity_spiritualist','zones/shared_unity_spiritualist_zone'],['zone_unity_bio_trophy','zones/shared_unity_bio_trophy_zone']]){
  if(!byName.has('cfsteer_'+name))continue;
  const original=roots(inlineScripts.get(path)).find(row=>row.key==='potential');
  assert.ok(byName.get('cfsteer_'+name).text.includes(body(original).trim()),name+' lost original empire/layout eligibility');
 }
}
test('installed 4.5.2 base zones retain spiritualist, servitor and AI layout qualifications without duplicate potentials',{skip:!existsSync(join(game,'common/zones/00_zones.txt'))},async()=>{
 const original=await readFile(join(game,'common/zones/00_zones.txt'),'utf8'),inlines=await loadZoneInlineScripts(game,original);
 const output=await generateSteeringZoneOverrides(game);
 assertOnePotential(output.content.toString());
 verifyActualEligibility(output.extraFiles.find(row=>row.path.includes('zones/zz_cfsteer_unity')).content.toString(),inlines);
});
test('actual Stellar overlay uses its shared zone scripts while keeping all inherited empire restrictions',{skip:!existsSync(join(stellar,'descriptor.mod'))||!existsSync(join(game,'common/zones/00_zones.txt'))},async()=>{
 const original=await readFile(join(stellar,'common/zones/00_zones.txt'),'utf8'),inlines=await loadZoneInlineScripts(game,original,{modDirectories:[stellar]});
 const output=await generateStellarSteeringCompatibility({gameDirectory:game,stellarDirectory:stellar,steeringDirectory:resolve('mod/cyberfish_steering_v1')});
 assertOnePotential(output.files.find(row=>row.path.includes('/zones/')&&row.path.endsWith('_research.txt')).content.toString());
 const unity=output.files.find(row=>row.path.includes('/zones/')&&row.path.endsWith('_unity.txt')).content.toString();
 verifyActualEligibility(unity,inlines);assert.match(unity,/stellarai_planet_unity_push/);assert.match(unity,/ai_resource_production/);
});
