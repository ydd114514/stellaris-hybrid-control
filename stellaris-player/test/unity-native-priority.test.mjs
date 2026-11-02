import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {scriptBlocks,unityNodeBuildingPreference,unityPriorityEconomyOverrides,compatibleEconomyPlans,compatiblePersonalities,generateSteeringUnityPriorityOverrides} from '../src/stellar-steering-compat.mjs';
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

test('exploration personality suspends navy spending only in the unity peace branch and retains civilian development and wartime source traits',()=>{
 const original='hive = { aggressiveness = 1 military_spending = 1.3 colony_spending = 1.1 allow = { is_hive_empire = yes } weight_modifier = { weight = 20 } behaviour = { conqueror = yes crisis_fighter = yes } }';
 const fallback='cfsteer_reserved_diplomacy = { aggressiveness = 0 military_spending = 1 allow = { is_hive_empire = yes } weight_modifier = { weight = 100000 } }';
 const result=compatiblePersonalities([{key:'hive',text:original,variables:''}],fallback),blocks=scriptBlocks(result.content);
 const normal=blocks.find(row=>row.key==='cfsteer_stellar_hive').text,explore=blocks.find(row=>row.key==='cfsteer_unity_exploration_hive').text;
 assert.match(normal,/military_spending = 1.3/);assert.match(normal,/NOT = \{ has_edict = cfsteer_economy_unity_traditions has_edict = cfsteer_military_peaceful is_at_war = no \}/);
 assert.match(explore,/military_spending = 0/);assert.doesNotMatch(explore,/NOT = \{ has_edict = cfsteer_economy_unity_traditions has_edict = cfsteer_military_peaceful/);
 for(const text of [normal,explore]){assert.match(text,/colony_spending = 1.1/);assert.match(text,/is_hive_empire = yes/);assert.match(text,/crisis_fighter = yes/);}
 assert.equal(result.aliases.some(([key])=>key==='cfsteer_unity_exploration_hive'),true);
});

test('normal steering generation wires the complete building, exclusive plan and exploration personality without disabling shared ships budgets',async t=>{
 const root=await mkdtemp(join(tmpdir(),'unity-native-priority-'));t.after(()=>{assert.ok(root.startsWith(join(tmpdir(),'unity-native-priority-')));return rm(root,{recursive:true,force:true});});
 for(const folder of ['buildings','economic_plans'])await mkdir(join(root,'common',folder),{recursive:true});
 await writeFile(join(root,'common/buildings/08_unity_buildings.txt'),'@node_time = 360\n@node_jobs = 200\n'+node);
 await writeFile(join(root,'common/economic_plans/basic.txt'),'basic_economy_plan = { income = { alloys = 50 } ai_weight = { weight = 900 } }');
 const files=await generateSteeringUnityPriorityOverrides(root);
 assert.ok(files.some(row=>row.path==='common/buildings/zz_cfsteer_unity_node.txt'&&row.content.includes('building_hive_node')));
 assert.ok(files.some(row=>row.path==='common/economic_plans/zz_cfsteer_unity_priority.txt'&&row.content.includes('cfsteer_unity_priority_plan')));
 assert.ok(files.some(row=>row.path==='common/personalities/zz_cfsteer_unity_exploration.txt'&&row.content.includes('military_spending = 0')));
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
 await writeFile(staticPath,(await readFile(staticPath,'utf8'))+'\n# custom static personality');
 await assert.rejects(installSteeringMod({documentsPath:root,gameDirectory,updateGenerated:true,backupDirectory:join(root,'backup2')}),/内容不同/);
});
