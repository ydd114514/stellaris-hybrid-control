import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {expansionBudgetOverrides} from '../src/steering-expansion-overrides.mjs';
import {scriptBlocks} from '../src/stellar-steering-compat.mjs';

const alloyBudget='01_alloys_budget.txt';
const influenceBudget='04_influence_budget.txt';
const starbases={
 alloys_expenditure_starbases:0.4,
 alloys_expenditure_starbases_fallen_empires:0.2,
 alloys_expenditure_starbases_expand:0.2,
};
const colonyAlloys={
 alloys_expenditure_colonies_infernal_expand:0.8,
 alloys_expenditure_colonies_expand:0.5,
};
const otherAlloys={
 alloys_expenditure_ships:0.6,
 alloys_expenditure_ship_upgrades:0.2,
 alloys_expenditure_planets:0.1,
};
const vanillaWeight={...starbases,...colonyAlloys,...otherAlloys,influence_expenditure_stations:0.5};
const names={
 '00_energy_budget.txt':['energy_expenditure_colonies_infernal_hive','energy_expenditure_colonies_machine'],
 '00_minerals_budget.txt':['minerals_expenditure_colonies_lithoid_expand'],
 '00_food_budget.txt':['food_expenditure_colonies_expand','food_expenditure_colonies_expand_rock_tree'],
 [alloyBudget]:[...Object.keys(colonyAlloys),...Object.keys(starbases)],
 '01_consumer_goods_budget.txt':['consumer_goods_expenditure_colonies_expand'],
 '01_trade_budget.txt':['trade_expenditure_colonies_sponsored'],
 [influenceBudget]:['influence_expenditure_stations']
};
function fixture(){
 return Object.fromEntries(Object.entries(names).map(([file,keys])=>[file,keys.map(key=>{
  const resource=key.split('_expenditure_')[0],category=resource==='influence'?'stations':key in starbases?'starbases':'colonies';
  return [
   key+' = {',' resource = '+resource,' type = expenditure',' category = '+category,
   ' potential = {','  is_nomadic = no','  OR = { has_origin = origin_tree_of_life always = yes }',' }',
   ' weight = { weight = '+(vanillaWeight[key]??0.5)+' modifier = { factor = 2 is_at_war = yes } }',
   ' desired_min = { base = @colony_cost_low }',' desired_max = { base = 150 }',' # brace } ignored',' }'
  ].join('\n');
 }).join('\n\n')]));
}

const expansionModifier=/modifier\s*=\s*\{\s*factor\s*=\s*(\d+(?:\.\d+)?)\s*has_edict\s*=\s*cfsteer_expansion_aggressive\s*OR\s*=\s*\{\s*has_ai_expansion_plan\s*=\s*yes\s*ai_colonize_plans\s*>\s*0\s*\}\s*\}/;

test('consolidate restricts colony and outpost influence budgets while aggressive scales only expansion alloys',()=>{
 const originals=fixture(),sources={...originals};
 sources[alloyBudget]+='\nalloys_expenditure_ships = { resource = alloys type = expenditure category = ships potential = { always = yes } }'+
  '\nalloys_expenditure_stations = { resource = alloys type = expenditure category = stations potential = { always = yes } }'+
  '\nalloys_expenditure_ship_upgrades = { resource = alloys type = expenditure category = ship_upgrades potential = { always = yes } }';
 const result=expansionBudgetOverrides(sources);
 assert.equal((result.match(/NOT = \{ has_edict = cfsteer_expansion_consolidate \}/g)??[]).length,10);
 assert.equal((result.match(/category = colonies/g)??[]).length,9);
 assert.equal((result.match(/category = stations/g)??[]).length,1);
 assert.equal((result.match(/category = starbases/g)??[]).length,3);
 assert.deepEqual([...new Set([...result.matchAll(/resource = (\w+)/g)].map(match=>match[1]))].sort(),['alloys','consumer_goods','energy','food','influence','minerals','trade']);
 assert.doesNotMatch(result,/alloys_expenditure_(?:ships|stations|ship_upgrades)\s*=/);
 // Removing the new country conditions recovers the original definitions.
 // Keep original rules, including comments, reserves and modifiers.
 assert.doesNotMatch(result,/is_ai = no|factor = 100000|category = ships|category = ship_upgrades/);
 const strip=value=>value.replace(/#.*$/gm,'').replace(/\s+/g,'');
 const unmodified=strip(result.replaceAll('\n\t\tNOT = { has_edict = cfsteer_expansion_consolidate }','').replace(new RegExp(expansionModifier,'g'),''));
 for(const source of Object.values(originals))for(const row of scriptBlocks(source))assert.ok(unmodified.includes(strip(row.text)),row.key);
});

test('generation preserves local variables and refuses missing or mismatched installed budgets',()=>{
 const sources=fixture();sources['00_energy_budget.txt']='@fixture_budget = 42\n'+sources['00_energy_budget.txt'];
 assert.match(expansionBudgetOverrides(sources),/@fixture_budget = 42/);
 const missing={...sources};delete missing['01_trade_budget.txt'];
 assert.throws(()=>expansionBudgetOverrides(missing),/文件缺失/);
 assert.throws(()=>expansionBudgetOverrides({...sources,'01_trade_budget.txt':''}),/定义缺失/);
 assert.throws(()=>expansionBudgetOverrides({...sources,'01_trade_budget.txt':sources['01_trade_budget.txt'].replace('category = colonies','category = ships')}),/类型不符/);
 assert.throws(()=>expansionBudgetOverrides({...sources,'01_trade_budget.txt':sources['01_trade_budget.txt'].replace('potential =','eligibility =')}),/缺少potential/);
 assert.throws(()=>expansionBudgetOverrides({...sources,[alloyBudget]:sources[alloyBudget].replace('weight = {','fraction = {')}),/缺少weight/);
});

test('4.5.2 normalized colony and outpost alloy shares never fall under aggressive expansion',async()=>{
 // Vanilla common/ai_budget/00_README.txt defines weight = { weight = ... }
 // and normalizes against the total. 01_alloys_budget.txt uses starbases for
 // outpost alloys; 04_influence_budget.txt uses stations for outpost influence.
 // The fallback fixture contains just the observed base weights and categories.
 const gameDirectory=process.env.STELLARIS_GAME_DIR;
 const sources=fixture();
 for(const [key,weight] of Object.entries(otherAlloys)){
  sources[alloyBudget]+='\n'+key+' = { resource = alloys type = expenditure weight = { weight = '+weight+' } }';
 }
 if(gameDirectory){
  for(const file of Object.keys(sources))sources[file]=await readFile(join(gameDirectory,'common/ai_budget',file),'utf8');
 }
 const byKey=source=>new Map(scriptBlocks(source).map(row=>[row.key,row.text]));
 const originals=byKey(sources[alloyBudget]+'\n'+sources[influenceBudget]);
 const updated=byKey(expansionBudgetOverrides(sources));
 const weight=key=>{
  const match=/\bweight\s*=\s*\{\s*weight\s*=\s*(\d+(?:\.\d+)?)/.exec(originals.get(key));
  assert.ok(match,key);
  return Number(match[1]);
 };
 assert.match(originals.get('influence_expenditure_stations'),/\bcategory\s*=\s*stations/);
 assert.match(originals.get('alloys_expenditure_starbases_expand'),/\bcategory\s*=\s*starbases/);
 const factor=key=>{
  const entry=updated.get(key);
  if(!entry)return 1;
  const expansion=expansionModifier.exec(entry);
  assert.ok(expansion,key);
  return Number(expansion[1]);
 };
 const [baseStarbase,,expandStarbase]=Object.keys(starbases);
 const [infernalColony,regularColony]=Object.keys(colonyAlloys);
 for(const [eligibleStarbases,eligibleColonies] of [
  [[[baseStarbase,1],[expandStarbase,1]],[]],
  [[[baseStarbase,0.25]],[[regularColony,1]]],
  [[[baseStarbase,2*1.5*1.5]],[[regularColony,1]]],
  [[[baseStarbase,0.5]],[[infernalColony,1]]],
 ]){
  const terms=[eligibleStarbases,eligibleColonies,Object.keys(otherAlloys).map(key=>[key,1])];
  const total=scale=>terms.map(entries=>entries.reduce((sum,[key,vanillaModifier])=>sum+weight(key)*vanillaModifier*scale(key),0));
  const shares=weights=>weights.map(value=>value/weights.reduce((sum,w)=>sum+w,0));
  const balanced=shares(total(()=>1)),aggressive=shares(total(factor));
  for(const category of [0,1]){
   assert.ok(aggressive[category]>=balanced[category]);
   if(balanced[category]>0)assert.ok(aggressive[category]>balanced[category]);
  }
 }
 const staticBudget=await readFile(new URL('../mod/cyberfish_steering_v1/common/ai_budget/cfsteer_budget.txt',import.meta.url),'utf8');
 const influence=byKey(staticBudget).get('cfsteer_budget_expand_influence');
 assert.match(influence,/\bresource\s*=\s*influence[\s\S]*\bcategory\s*=\s*stations/);
 assert.doesNotMatch(staticBudget,/\bcfsteer_budget_expand_(?:stations|colonies)\s*=/);
});
