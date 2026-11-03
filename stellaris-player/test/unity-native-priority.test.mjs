import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {scriptBlocks,unityNodeBuildingPreference,unityPriorityEconomyOverrides,compatibleEconomyPlans,generateSteeringUnityPriorityOverrides} from '../src/stellar-steering-compat.mjs';
import {installSteeringMod} from '../src/mod-install.mjs';

const node=`building_hive_node = {
 base_buildtime = @node_time
 category = unity
 building_sets = { unity }
 potential = { exists = owner owner = { is_hive_empire = yes is_wilderness_empire = no } num_buildings = { type = building_hive_node value < 2 } }
 inline_script = { script = jobs/unity_jobs_add AMOUNT = @node_jobs }
 ai_weight_coefficient = 0.1
 resources = { category = planet_buildings cost = { minerals = 456 } upkeep = { energy = 3 } }
 prerequisites = { tech_hive_node }
}`;
const own=(entry,key)=>scriptBlocks(entry.slice(entry.indexOf('{')+1,-1)).filter(row=>row.key===key);

test('node preference retains the complete effective building and only adds conditional AI valuation',()=>{
 const result=unityNodeBuildingPreference({key:'building_hive_node',text:node,variables:'@node_time = 360\n@node_jobs = 200'});
 const built=scriptBlocks(result).find(row=>row.key==='building_hive_node').text;
 const valuation=own(built,'ai_resource_production');assert.equal(valuation.length,1);
 assert.equal(built.replace(valuation[0].text,'').replace(/#.*\n/g,'').replace(/\s/g,''),node.replace(/\s/g,''));
 assert.match(result,/@node_jobs = 200/);assert.match(valuation[0].text,/unity = 60/);
 assert.match(valuation[0].text,/owner = \{ has_edict = cfsteer_economy_unity_traditions has_edict = cfsteer_military_peaceful is_at_war = no/);
 for(const guard of ['has_available_jobs = coordinator','has_forbidden_jobs = coordinator','has_building_construction = building_hive_node'])assert.ok(valuation[0].text.includes('NOT = { '+guard+' }'));
 for(const guard of ['free_housing >= 0','free_amenities >= 0','num_unemployed > 0','has_active_tradition = tr_virtuality_4'])assert.ok(valuation[0].text.includes(guard));
 for(const resource of ['energy','minerals','food','consumer_goods','alloys'])assert.ok(valuation[0].text.includes('NOT = { has_deficit = '+resource+' }'));
 assert.equal(scriptBlocks(result).filter(row=>row.key.startsWith('building_')).length,1);
 assert.throws(()=>unityNodeBuildingPreference({key:'building_hive_node',text:'building_hive_node = { cost = 1 }'}),/定义缺失或结构改变/);
});

test('unity plan excludes competing surplus plans only for the player peace edicts and preserves accumulated original eligibility',()=>{
 const rows=[
  {key:'basic_economy_plan',text:'basic_economy_plan = { ai_weight = { weight = 900 } potential = { is_nomadic = no } income = { alloys = 80 physics_research = 100 } }'},
  {key:'basic_economy_plan',text:'basic_economy_plan = { ai_weight = { weight = 850 } subplan = { set_name = "normal_recovery" income = { energy = 20 } } }'},
  {key:'late_plan',text:'late_plan = { income = { alloys = 800 } potential = { has_technology = tech_one } }'}
 ];
 for(const result of [unityPriorityEconomyOverrides(rows),compatibleEconomyPlans(rows).content]){
  const blocks=scriptBlocks(result),base=blocks.find(row=>row.key==='basic_economy_plan').text;
  assert.match(base,/AND = \{ is_nomadic = no \}/);
  assert.match(base,/NOT = \{ has_edict = cfsteer_economy_unity_traditions has_edict = cfsteer_military_peaceful is_at_war = no \}/);
  const priority=blocks.find(row=>row.key==='cfsteer_unity_priority_plan').text;
  assert.match(priority,/income = \{ energy = 0 minerals = 0 food = 0 consumer_goods = 0 alloys = 0/);
  assert.doesNotMatch(priority,/physics_research|society_research|engineering_research|naval_cap|pops =|years_passed|unity = 600/);
  assert.match(priority,/scaling = yes income = \{ unity = 100 \}/);
  for(const resource of ['energy','minerals','food','consumer_goods','alloys','volatile_motes','exotic_gases','rare_crystals']){
   const repair=own(priority,'subplan').find(row=>row.text.includes('"cfsteer_unity_supply_'+resource+'"')).text;
   assert.match(repair,new RegExp('has_deficit = '+resource));
   assert.match(repair,new RegExp('resource_income_compare = \\{ resource = '+resource+' value < 0'));
   assert.doesNotMatch(repair,/resource_stockpile_compare|has_monthly_income|scaling/);
  }
 }
});

test('normal steering keeps peaceful unity planning without changing personalities or shared ship budgets',async t=>{
 const root=await mkdtemp(join(tmpdir(),'unity-native-priority-'));t.after(()=>{assert.ok(root.startsWith(join(tmpdir(),'unity-native-priority-')));return rm(root,{recursive:true,force:true});});
 for(const folder of ['buildings','economic_plans','personalities'])await mkdir(join(root,'common',folder),{recursive:true});
 await writeFile(join(root,'common/buildings/08_unity_buildings.txt'),'@node_time = 360\n@node_jobs = 200\n'+node);
 await writeFile(join(root,'common/economic_plans/basic.txt'),'basic_economy_plan = { income = { alloys = 50 } ai_weight = { weight = 900 } }');
 await writeFile(join(root,'common/personalities/00_personalities.txt'),'hive = { aggressiveness = 1 military_spending = 1 allow = { is_hive_empire = yes } weight_modifier = { weight = 20 } }');
 const files=await generateSteeringUnityPriorityOverrides(root);
 assert.ok(files.some(row=>row.path==='common/buildings/zz_cfsteer_unity_node.txt'&&row.content.includes('building_hive_node')));
 assert.ok(files.some(row=>row.path==='common/economic_plans/zz_cfsteer_unity_priority.txt'&&row.content.includes('cfsteer_unity_priority_plan')));
 assert.equal(files.some(row=>row.path.startsWith('common/personalities/')),false);
 assert.equal(files.some(row=>row.path.startsWith('common/ai_budget/')),false);
});

const gameDirectory=process.env.STELLARIS_GAME_DIR??'D:/SteamLibrary/steamapps/common/Stellaris';
test('explicit generated-file update backs up the exact prior bytes and still refuses static custom changes',{skip:!existsSync(join(gameDirectory,'common/zones/00_zones.txt'))},async t=>{
 const root=await mkdtemp(join(tmpdir(),'unity-installer-'));t.after(()=>{assert.ok(root.startsWith(join(tmpdir(),'unity-installer-')));return rm(root,{recursive:true,force:true});});
 await mkdir(join(root,'mod'));
 await installSteeringMod({documentsPath:root,gameDirectory});
 const nodePath=join(root,'mod/cyberfish_steering_v1/common/buildings/zz_cfsteer_unity_node.txt'),prior=(await readFile(nodePath,'utf8'))+'\n# previous generated preference\n';
 await writeFile(nodePath,prior);
 await assert.rejects(installSteeringMod({documentsPath:root,gameDirectory}),/内容不同/);
 const output=await installSteeringMod({documentsPath:root,gameDirectory,updateGenerated:true,backupDirectory:join(root,'backup')});
 assert.equal(output.backups.length,1);assert.equal(await readFile(output.backups[0],'utf8'),prior);
 assert.notEqual(await readFile(nodePath,'utf8'),prior);
 const staticPath=join(root,'mod/cyberfish_steering_v1/common/personalities/cfsteer_personality.txt');
 await writeFile(staticPath,'# custom static personality');
 await assert.rejects(installSteeringMod({documentsPath:root,gameDirectory,updateGenerated:true,backupDirectory:join(root,'backup2')}),/已被修改/);
 assert.equal(await readFile(staticPath,'utf8'),'# custom static personality');
});

// 4.5 drops zero values from income goals and diagnoses an empty base goal.
// Focus/scaling are continuing targets; they are deliberately not tier gates.
test('unity priority has a positive base goal and an exclusive continuing fallback without other surplus targets',()=>{
 const rows=[
  {key:'basic_economy_plan',text:'basic_economy_plan = { ai_weight = { weight = 900 } income = { energy = 50 } }'},
  {key:'mature_economy_plan',text:'mature_economy_plan = { ai_weight = { weight = 300 } income = { alloys = 500 } potential = { is_nomadic = no } }'}
 ];
 for(const generated of [unityPriorityEconomyOverrides(rows),compatibleEconomyPlans(rows).content]){
  const blocks=scriptBlocks(generated),priority=blocks.find(row=>row.key==='cfsteer_unity_priority_plan').text;
  const income=own(priority,'income');assert.equal(income.length,1);
  assert.match(income[0].text,/\bunity = 1\s*}/);
  for(const resource of ['energy','minerals','food','consumer_goods','alloys','volatile_motes','exotic_gases','rare_crystals'])assert.match(income[0].text,new RegExp('\\b'+resource+' = 0\\b'));
  assert.match(own(priority,'focus')[0].text,/unity = 1000/);
  const scaling=own(priority,'subplan').find(row=>row.text.includes('"cfsteer_unity_priority_scaling"')).text;
  assert.match(scaling,/scaling = yes income = \{ unity = 100 \}/);
  for(const key of rows.map(row=>row.key))assert.match(blocks.find(row=>row.key===key).text,/NOT = \{ has_edict = cfsteer_economy_unity_traditions has_edict = cfsteer_military_peaceful is_at_war = no \}/);
  assert.doesNotMatch(priority,/years_passed|unity = 600|physics_research|society_research|engineering_research/);
 }
});
