import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {expansionBudgetOverrides} from '../src/steering-expansion-overrides.mjs';

const names={
 '00_energy_budget.txt':['energy_expenditure_colonies_infernal_hive','energy_expenditure_colonies_machine'],
 '00_minerals_budget.txt':['minerals_expenditure_colonies_lithoid_expand'],
 '00_food_budget.txt':['food_expenditure_colonies_expand','food_expenditure_colonies_expand_rock_tree'],
 '01_alloys_budget.txt':['alloys_expenditure_colonies_infernal_expand','alloys_expenditure_colonies_expand'],
 '01_consumer_goods_budget.txt':['consumer_goods_expenditure_colonies_expand'],
 '01_trade_budget.txt':['trade_expenditure_colonies_sponsored'],
 '04_influence_budget.txt':['influence_expenditure_stations']
};
function fixture(){
 return Object.fromEntries(Object.entries(names).map(([file,keys])=>[file,keys.map(key=>{
  const resource=key.split('_expenditure_')[0],category=resource==='influence'?'stations':'colonies';
  return `${key} = {\n resource = ${resource}\n type = expenditure\n category = ${category}\n potential = {\n  is_nomadic = no\n  OR = { has_origin = origin_tree_of_life always = yes }\n }\n weight = { weight = 0.5 modifier = { factor = 2 is_at_war = yes } }\n desired_min = { base = @colony_cost_low }\n desired_max = { base = 150 }\n # brace } ignored\n }`;
 }).join('\n\n')]));
}

test('consolidate excludes all nine vanilla colony variants and only the influence outpost budget',()=>{
 const originals=fixture(),sources={...originals};
 sources['01_alloys_budget.txt']+='\nalloys_expenditure_ships = { resource = alloys type = expenditure category = ships potential = { always = yes } }'+
  '\nalloys_expenditure_stations = { resource = alloys type = expenditure category = stations potential = { always = yes } }'+
  '\nalloys_expenditure_ship_upgrades = { resource = alloys type = expenditure category = ship_upgrades potential = { always = yes } }';
 const result=expansionBudgetOverrides(sources);
 assert.equal((result.match(/NOT = \{ has_edict = cfsteer_expansion_consolidate \}/g)??[]).length,10);
 assert.equal((result.match(/category = colonies/g)??[]).length,9);
 assert.equal((result.match(/category = stations/g)??[]).length,1);
 assert.deepEqual([...new Set([...result.matchAll(/resource = (\w+)/g)].map(match=>match[1]))].sort(),['alloys','consumer_goods','energy','food','influence','minerals','trade']);
 assert.doesNotMatch(result,/alloys_expenditure_(?:ships|stations|ship_upgrades)\s*=/);
 // Removing our single country condition must recover each exact base entry.
 const unchanged=result.replaceAll('\n\t\tNOT = { has_edict = cfsteer_expansion_consolidate }','');
 for(const [file,input] of Object.entries(originals))assert.ok(unchanged.includes(input),file);
 assert.doesNotMatch(result,/is_ai = no|factor = 100000|category = ships|category = ship_upgrades/);
});

test('generation preserves local variables and refuses missing or mismatched installed budgets',()=>{
 const sources=fixture();sources['00_energy_budget.txt']='@fixture_budget = 42\n'+sources['00_energy_budget.txt'];
 assert.match(expansionBudgetOverrides(sources),/@fixture_budget = 42/);
 const missing={...sources};delete missing['01_trade_budget.txt'];
 assert.throws(()=>expansionBudgetOverrides(missing),/文件缺失/);
 assert.throws(()=>expansionBudgetOverrides({...sources,'01_trade_budget.txt':''}),/定义缺失/);
 assert.throws(()=>expansionBudgetOverrides({...sources,'01_trade_budget.txt':sources['01_trade_budget.txt'].replace('category = colonies','category = ships')}),/类型不符/);
 assert.throws(()=>expansionBudgetOverrides({...sources,'01_trade_budget.txt':sources['01_trade_budget.txt'].replace('potential =','eligibility =')}),/缺少potential/);
});

test('reserved AI personality remains available when unity is the active economic direction',async()=>{
 const source=await readFile(new URL('../mod/cyberfish_steering_v1/common/personalities/cfsteer_personality.txt',import.meta.url),'utf8');
 assert.match(source,/allow = \{ OR = \{[^\n]*has_edict = cfsteer_economy_unity_traditions/);
});
