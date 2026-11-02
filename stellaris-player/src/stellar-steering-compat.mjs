import {readFile,readdir} from 'node:fs/promises';
import {join,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {researchZoneOverrides,unityZoneOverrides,unityTechnologyOverrides,traditionPriorityOverrides,loadZoneInlineScripts} from './steering-zone-overrides.mjs';

export const STELLAR_VANILLA_JOBS_ID='3686836322';
const focuses=['balanced','unity_traditions','consumer_stability','alloys_military','research'];
const scope='OR = { '+focuses.map(key=>'has_edict = cfsteer_economy_'+key).join(' ')+' }';
export const STEERED_COUNTRY_TRIGGER='cfcompat_steered_country';
export const STEERED_COUNTRY_DEFINITION=STEERED_COUNTRY_TRIGGER+' = { '+scope+' }\n';
// Dedicated player edicts are never enabled by NPC AI. A real war immediately
// restores the original plans even before the controller changes its edicts.
export const UNITY_PRIORITY_CONDITION='has_edict = cfsteer_economy_unity_traditions has_edict = cfsteer_military_peaceful is_at_war = no';
const researchZones=['zone_research','zone_research_physics','zone_research_society','zone_research_engineering'];
const unityZones=['zone_unity','zone_unity_spiritualist','zone_unity_bio_trophy','zone_research_unity'];
const technologies=['tech_cultural_heritage','tech_heritage_site','tech_hypercomms_forum','tech_autocurating_vault','tech_holographic_rituals','tech_consecration_fields'];
const hash=body=>createHash('sha256').update(body).digest('hex');

// A small structural reader: comments and quoted braces never become script
// objects. We preserve original bodies rather than reconstructing game rules.
export function scriptBlocks(text){
 if(typeof text!=='string'||text.length>8_000_000)throw Error('Mod脚本缺失或过大');
 const result=[];let depth=0,quote=false,escape=false,comment=false,last=0,start=null,key=null;
 for(let i=0;i<text.length;i++){
  const ch=text[i];
  if(comment){if(ch==='\n'){comment=false;if(depth===0)last=i+1;}continue;}
  if(quote){if(escape)escape=false;else if(ch==='\\')escape=true;else if(ch==='"')quote=false;continue;}
  if(ch==='#'){comment=true;continue;}if(ch==='"'){quote=true;continue;}
  if(ch==='{'){
   if(depth===0){const match=/([a-zA-Z_$][\w.$?]*)\s*=\s*$/.exec(text.slice(last,i));if(!match)throw Error('Mod顶层对象名称无法识别');key=match[1];start=i-(match[0].length);}
   depth++;
  }else if(ch==='}'){
   if(--depth<0)throw Error('Mod脚本括号不匹配');
   if(depth===0){result.push({key,text:text.slice(start,i+1)});last=i+1;start=null;key=null;}
  }else if(depth===0&&ch==='\n')last=i+1;
 }
 if(depth!==0||quote)throw Error('Mod脚本括号或引号不完整');
 return result;
}

function ownBlock(entry,name){
 const body=entry.slice(entry.indexOf('{')+1,-1);
 return scriptBlocks(body).filter(row=>row.key===name).at(-1)?.text;
}
function replaceOwn(entry,name,replace){
 const original=ownBlock(entry,name);
 if(!original)return entry.slice(0,-1)+'\n'+name+' = { '+replace('')+' }\n}';
 return entry.replace(original,name+' = { '+replace(original.slice(original.indexOf('{')+1,-1))+' }');
}
export function includeSteeredPlayer(body){
 const widen=text=>text.replace(/\bis_ai\s*=\s*yes\b/g,'OR = { is_ai = yes '+scope+' }');
 let result='',offset=0;
 for(const block of scriptBlocks(body)){
  const at=body.indexOf(block.text,offset);result+=widen(body.slice(offset,at));
  // Positive country-local logical groups retain the same scope. Negations
  // and foreign/entity scopes are intentionally untouched.
  result+=['AND','OR','if','else_if','else','limit','trigger','potential','allow'].includes(block.key)?block.key+' = {'+includeSteeredPlayer(block.text.slice(block.text.indexOf('{')+1,-1))+'}':block.text;
  offset=at+block.text.length;
 }
 return result+widen(body.slice(offset));
}
function localVariables(text,prefix){
 const vars=[...text.matchAll(/^\s*(@\w+)\s*=\s*([^\r\n#]+)/gm)].map(match=>[match[1],match[2].trim()]);
 const names=new Map(vars.map(([name])=>[name,`@cfsc_${prefix}_${name.slice(1)}`]));
 const rename=value=>value.replace(/@[a-zA-Z_]\w*/g,key=>names.get(key)??key);
 return {definitions:vars.map(([name,value])=>names.get(name)+' = '+rename(value)).join('\n'),rename};
}

async function filesAt(root,category){
 const directory=join(root,'common',category);let entries;
 try{entries=await readdir(directory,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return [];throw error;}
 const files=[];
 for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name,'en'))){
  if(entry.isSymbolicLink())throw Error('Mod源文件目录不能包含链接：'+category);
  if(entry.isFile()&&entry.name.endsWith('.txt'))files.push(join(directory,entry.name));
 }
 return files;
}
async function effectiveCategory(gameDirectory,stellarDirectory,category,manifest){
 // A mod file at the same virtual path replaces the entire vanilla file; a
 // later different file can override a definition (plans remain additive).
 const files=new Map();
 for(const root of [gameDirectory,stellarDirectory].filter(Boolean))for(const path of await filesAt(root,category))files.set(relative(join(root,'common',category),path),{path,root});
 const definitions=new Map(),all=[];
 let index=0;
 for(const [virtual,file]of [...files].sort(([a],[b])=>a.localeCompare(b,'en'))){
  const raw=await readFile(file.path,'utf8'),variables=localVariables(raw,`${category.replace(/\W/g,'')}_${index++}`);
  if(file.root===stellarDirectory)manifest.push({path:'common/'+category+'/'+virtual,sha256:hash(raw)});
  for(const block of scriptBlocks(raw)){
   const row={key:block.key,text:variables.rename(block.text),variables:variables.definitions,origin:file.path};
   definitions.set(row.key,row);all.push(row);
  }
 }
 return {definitions,all};
}
const joined=rows=>rows.map(row=>row.variables+'\n'+row.text).join('\n\n');
function selected(category,keys){return joined(keys.map(key=>{const row=category.definitions.get(key);if(!row)throw Error('实际生效Mod定义缺失：'+key);return row;}));}
const file=(path,text)=>({path,content:Buffer.from(text,'utf8')});

function economyPlanDefinitions(rows){
 const plans=new Map(),potentials=new Map();
 for(const row of rows){
  if(row.key.startsWith('cfsteer_'))continue;
  const potential=ownBlock(row.text,'potential');if(potential)potentials.set(row.key,potential);
  if(ownBlock(row.text,'income')||ownBlock(row.text,'ai_weight'))plans.set(row.key,row);
 }
 return {plans,potentials};
}
const supplyResources={energy:10,minerals:10,food:10,consumer_goods:5,alloys:5,volatile_motes:1,exotic_gases:1,rare_crystals:1};
export function unityPriorityEconomyPlan(){
 return `# A separate plan prevents positive alloy/research stretch goals from competing with the owner's unity-first direction.
# Vanilla economic_plans/00_example.txt: income is surplus income; scaling continues after the base plan is fulfilled.
cfsteer_unity_priority_plan = {
 potential = { ${UNITY_PRIORITY_CONDITION} }
 ai_weight = { weight = 1000000 }
 income = { ${Object.keys(supplyResources).map(key=>key+' = 0').join(' ')} unity = 0 }
 focus = { unity = 1000 }
 subplan = { set_name = "cfsteer_unity_priority_scaling" scaling = yes income = { unity = 100 } }
${Object.entries(supplyResources).map(([resource,target])=>` subplan = {
 set_name = "cfsteer_unity_supply_${resource}"
 potential = { OR = { has_deficit = ${resource} resource_income_compare = { resource = ${resource} value < 0 } } }
 focus = { ${resource} = ${target} }
 }`).join('\n')}
}
`;
}
function unityExcludedPotential(potential,{includePlayer=false}={}){
 let body=potential?.slice(potential.indexOf('{')+1,-1)??'';
 if(includePlayer)body=includeSteeredPlayer(body);
 return 'potential = {\n'+(body.trim()?' AND = {'+body+'}\n':'')+' NOT = { '+UNITY_PRIORITY_CONDITION+' }\n}';
}
export function unityPriorityEconomyOverrides(rows){
 const {plans,potentials}=economyPlanDefinitions(rows);
 if(!plans.size)throw Error('实际经济计划为空，不能生成凝聚优先分支');
 return '# Economic plans are additive in the official 4.5 schema: only eligibility is overridden; every original non-unity goal and subplan remains loaded.\n'+
  [...plans.keys()].map(key=>key+' = {\n'+unityExcludedPotential(potentials.get(key))+'\n}').join('\n\n')+'\n\n'+unityPriorityEconomyPlan();
}
export function compatibleEconomyPlans(rows){
 const {plans,potentials}=economyPlanDefinitions(rows);
 if(!plans.size)throw Error('Stellar AI实际经济计划为空，不能生成兼容补丁');
 const contents=['# Local compatibility integration for Stellar AI Vanilla Job Levels. Generated from installed sources; no job outputs are changed.',
  '# Disable only Cyberfish standalone plans so Stellar AI keeps its own recovery and tier progression.'];
 for(const key of ['research','alloys_military','consumer_stability'])contents.push(`cfsteer_${key}_plan = { potential = { always = no } }`);
 let index=0;
 for(const [key,row]of plans){
  // Only widen positive country-local is_ai guards; foreign scopes and
  // negative tests retain their original meanings.
  const potential=unityExcludedPotential(potentials.get(key),{includePlayer:true});
  const tier=['basic','intermediate','advanced','mature','endgame','beyond_endgame'].find(t=>key===`${t}_economy_plan`);
  const suffix=tier??`stellar_${index++}`;
  contents.push(`${key} = {\n${potential??''}
 subplan = { set_name = "cfsteer_unity_focus_${suffix}" potential = { has_edict = cfsteer_economy_unity_traditions } focus = { unity = 1000 } }
 subplan = { set_name = "cfsteer_unity_scaling_${suffix}" scaling = yes potential = { has_edict = cfsteer_economy_unity_traditions } income = { unity = 100 } }
 subplan = { set_name = "cfsteer_stellar_research_${suffix}" potential = { has_edict = cfsteer_economy_research } focus = { physics_research = 1000 society_research = 1000 engineering_research = 1000 } }
 subplan = { set_name = "cfsteer_stellar_alloys_${suffix}" potential = { has_edict = cfsteer_economy_alloys_military } focus = { alloys = 500 } }
 subplan = { set_name = "cfsteer_stellar_stability_${suffix}" potential = { has_edict = cfsteer_economy_consumer_stability } focus = { energy = 300 unity = 300 } }
 subplan = { set_name = "cfsteer_stellar_goods_${suffix}" potential = { has_edict = cfsteer_economy_consumer_stability NOT = { has_ethic = ethic_gestalt_consciousness } } focus = { consumer_goods = 300 } }
}`);
 }
 return {content:contents.join('\n\n')+'\n\n'+unityPriorityEconomyPlan(),plans:[...plans.keys()]};
}

/** The full effective building entry is retained. Only its AI valuation changes,
 * as in vanilla manufacturing/research buildings; resources/jobs are untouched. */
export function unityNodeBuildingPreference(row){
 if(row?.key!=='building_hive_node'||!/^building_hive_node\s*=\s*\{/.test(row.text)||!/script\s*=\s*jobs\/unity_jobs_add/.test(row.text)||!/tech_hive_node/.test(row.text))throw Error('真实突触节点定义缺失或结构改变，未生成猜测建筑');
 const code=row.text.replace(/#[^\n]*/g,'');
 if(code.includes('cfsteer_economy_unity_traditions'))throw Error('突触节点已含本机偏好，请从实际游戏或Stellar源重新生成');
 const bonus=`
 # AI valuation only: vanilla 04_manufacturing_buildings and 08_unity_buildings use this triggered field.
 ai_resource_production = {
  unity = 60
  trigger = {
   exists = owner
   owner = { ${UNITY_PRIORITY_CONDITION}
    ${['energy','minerals','food','consumer_goods','alloys'].map(resource=>'NOT = { has_deficit = '+resource+' } NOT = { resource_income_compare = { resource = '+resource+' value < 0 } }').join('\n    ')}
   }
   NOT = { has_available_jobs = coordinator }
   NOT = { has_forbidden_jobs = coordinator }
   NOT = { has_building_construction = building_hive_node }
  }
 }
`;
 return '# Derived from the complete effective building_hive_node. No costs, jobs, eligibility, outputs or other-country preference are replaced.\n'+(row.variables??'')+'\n'+row.text.slice(0,-1)+bonus+'}\n';
}
export async function generateSteeringUnityPriorityOverrides(gameDirectory){
 const buildings=await effectiveCategory(gameDirectory,null,'buildings',[]),plans=await effectiveCategory(gameDirectory,null,'economic_plans',[]);
 const reserved=await readFile(new URL('../mod/cyberfish_steering_v1/common/personalities/cfsteer_personality.txt',import.meta.url),'utf8');
 return [file('common/buildings/zz_cfsteer_unity_node.txt',unityNodeBuildingPreference(buildings.definitions.get('building_hive_node'))),
  file('common/economic_plans/zz_cfsteer_unity_priority.txt',unityPriorityEconomyOverrides(plans.all)),
  file('common/personalities/zz_cfsteer_unity_exploration.txt',excludeUnityExploration(reserved)+'\n'+unityExplorationPersonality(reserved,'cfsteer_unity_exploration_reserved')),
  ...['english','simp_chinese'].map(language=>file(`localisation/${language}/zz_cfsteer_unity_exploration_l_${language}.yml`,'\ufeffl_'+language+':\n cfsteer_unity_exploration_reserved:0 "$cfsteer_reserved_diplomacy$"\n'))];
}

export function compatibleExpansionBudgets(rows){
 const restricted=[];
 for(const row of rows){
  const body=row.text.slice(row.text.indexOf('{')+1,-1),category=/\bcategory\s*=\s*(\w+)/.exec(body)?.[1],resource=/\bresource\s*=\s*(\w+)/.exec(body)?.[1];
  if(!/\btype\s*=\s*expenditure\b/.test(body)||category!=='colonies'&&!(category==='stations'&&resource==='influence'))continue;
  let text=replaceOwn(row.text,'potential',original=>'NOT = { has_edict = cfsteer_expansion_consolidate }\n'+original);
  restricted.push({...row,text});
 }
 if(!restricted.some(row=>/category\s*=\s*colonies/.test(row.text))||!restricted.some(row=>/resource\s*=\s*influence/.test(row.text)))throw Error('实际Mod殖民/前哨预算不完整，不能保留巩固控制');
 return {content:'# Generated from effective AI budget definitions; original recovery, reserve and weight rules remain intact.\n'+joined(restricted)+'\n',keys:restricted.map(row=>row.key)};
}

function excludeUnityExploration(text){return replaceOwn(text.trim(),'allow',body=>body+'\nNOT = { '+UNITY_PRIORITY_CONDITION+' }');}
function unityExplorationPersonality(text,key){
 let result=text.trim().replace(/^[a-zA-Z_]\w*/,key);
 result=replaceOwn(result,'allow',body=>body+'\n'+UNITY_PRIORITY_CONDITION);
 // Vanilla personalities/00_personalities.txt documents this as the budget
 // for navies and armies. Shared ships budgets also fund science/construction.
 return /\bmilitary_spending\s*=\s*[-+@\w.]+/.test(result)?result.replace(/\bmilitary_spending\s*=\s*[-+@\w.]+/,'military_spending = 0'):result.slice(0,-1)+'\nmilitary_spending = 0\n}';
}
export function compatiblePersonalities(rows,reservedSource){
 const clones=[],aliases=[];
 for(const row of rows){
  if(row.key.startsWith('cfsteer_')||!ownBlock(row.text,'allow')||!ownBlock(row.text,'weight_modifier'))continue;
  const key='cfsteer_stellar_'+row.key;
  let text=row.text.replace(new RegExp('^'+row.key+'\\b'),key);
  text=replaceOwn(text,'allow',body=>scope+'\n'+includeSteeredPlayer(body));
  text=replaceOwn(text,'weight_modifier',body=>body+'\nmodifier = { factor = 1000000 }');
  if(/\baggressiveness\s*=\s*[-+@\w.]+/.test(text))text=text.replace(/\baggressiveness\s*=\s*[-+@\w.]+/,'aggressiveness = 0');
  else text=text.slice(0,-1)+'\naggressiveness = 0\n}';
  clones.push({...row,text:excludeUnityExploration(text)});aliases.push([key,row.key]);
  const explorationKey='cfsteer_unity_exploration_'+row.key;
  clones.push({...row,text:unityExplorationPersonality(text,explorationKey)});aliases.push([explorationKey,row.key]);
 }
 if(!clones.length)throw Error('实际Mod人格定义为空，不能保证保留决策控制');
 const fallback=reservedSource.replace(/weight_modifier\s*=\s*\{\s*weight\s*=\s*100000\s*\}/,'weight_modifier = { weight = 0.001 }');
 if(fallback===reservedSource)throw Error('本机保留人格已变更，兼容生成器未覆盖');
 aliases.push(['cfsteer_unity_exploration_reserved','cfsteer_reserved_diplomacy']);
 return {content:'# Player-edict variants retain all source traits; only the peaceful unity/exploration variant suspends navy/army expansion spending. Civilian ship budgets remain intact.\n'+excludeUnityExploration(fallback)+'\n'+unityExplorationPersonality(fallback,'cfsteer_unity_exploration_reserved')+'\n'+joined(clones)+'\n',aliases};
}

const bodyOf=row=>row.text.slice(row.text.indexOf('{')+1,-1);
function required(category,key){const row=category.definitions.get(key);if(!row)throw Error('实际Stellar AI规划定义缺失：'+key);return row;}
export function compatibleZoneTriggers(category){
 const research=[...researchZones,'zone_research_unity'],pureUnity=unityZones.filter(key=>key!=='zone_research_unity');
 const families={has_any_research_zone:research,has_any_unspecialized_research_zone:['zone_research','zone_research_unity'],
  has_any_research_unity_zone:['zone_research_unity'],has_any_research_physics_zone:['zone_research_physics'],
  has_any_research_society_zone:['zone_research_society'],has_any_research_engineering_zone:['zone_research_engineering'],
  has_any_unity_zone:pureUnity,stellarai_has_generic_research_zone:['zone_research'],
  stellarai_has_research_unity_zone:['zone_research_unity'],stellarai_has_unity_zone:pureUnity};
 const result=[];
 for(const [key,zones]of Object.entries(families)){
  const row=required(category,key);
  result.push(row.variables+'\n'+key+' = { OR = { AND = {'+bodyOf(row)+'} '+zones.map(zone=>'has_zone = { zone = cfsteer_'+zone+' }').join(' ')+' } }');
 }
 const pair=required(category,'stellarai_has_research_zone_pair');
 result.push(pair.variables+'\nstellarai_has_research_zone_pair = { OR = { AND = {'+bodyOf(pair)+'} '+research.map(zone=>'num_zones = { type = cfsteer_'+zone+' value > 1 } AND = { has_zone = { zone = '+zone+' } has_zone = { zone = cfsteer_'+zone+' } }').join('\n')+' } }');
 return result.join('\n\n')+'\n';
}

export function compatiblePlayerServices(triggers,effects,warEvent){
 const scoped=[];
 for(const key of ['stellarai_managed_empire','stellarai_settled_ai_has_unemployment','stellarai_war_fleet_push',
  'stellarai_colonization_push','stellarai_expansion_phase','stellarai_long_war_refit','stellarai_opportunity_ready','stellarai_army_objective','stellarai_fleet_readiness_focus']){
  const row=required(triggers,key);let body=includeSteeredPlayer(bodyOf(row));
  if(['stellarai_colonization_push','stellarai_expansion_phase'].includes(key))body+='\nNOT = { has_edict = cfsteer_expansion_consolidate }';
  if(key==='stellarai_opportunity_ready')body+='\nNOT = { has_edict = cfsteer_military_peaceful }';
  if(key==='stellarai_fleet_readiness_focus')body+='\nNOT = { '+UNITY_PRIORITY_CONDITION+' }';
  scoped.push({...row,text:key+' = {'+body+'}'});
 }
 const plan=required(effects,'stellarai_plan_research_worlds');
 const effectRows=[{...plan,text:plan.key+' = {'+includeSteeredPlayer(bodyOf(plan))+'}'}];
 for(const key of ['stellarai_run_monthly_aid','stellarai_run_monthly_market']){
  const row=required(effects,key);
  effectRows.push({...row,text:key+' = { if = { limit = { NOT = { '+STEERED_COUNTRY_TRIGGER+' = yes } } '+bodyOf(row)+' } }'});
 }
 // Transfer runs in the recipient's scope while ROOT is the donor. Guard both
 // ends: native command/market/diplomacy controls cannot see script resource effects.
 const transfer=required(effects,'stellarai_aid_transfer_resource');
 effectRows.push({...transfer,text:transfer.key+' = { if = { limit = { NOT = { '+STEERED_COUNTRY_TRIGGER+' = yes } root = { NOT = { '+STEERED_COUNTRY_TRIGGER+' = yes } } } '+bodyOf(transfer)+' } }'});
 const counter=ownBlock(warEvent,'immediate');
 if(!counter||!counter.includes('stellarai_war_months')||!counter.includes('@stellarai_refit_war_months'))throw Error('Stellar AI战争计数器结构改变，未启用本国服务桥');
 return {triggers:STEERED_COUNTRY_DEFINITION+'\n'+joined(scoped)+'\n',effects:joined(effectRows)+'\n',events:`namespace = cfcompat_stellar
# Original Stellar dispatcher serves is_ai=yes. This complementary dispatcher
# serves only steered human countries; no original event ID is duplicated.
event = { id = cfcompat_stellar.1 hide_window = yes is_triggered_only = yes immediate = {
 every_country = { limit = { ${STEERED_COUNTRY_TRIGGER} = yes is_ai = no is_nomadic = no NOT = { has_country_flag = cfcompat_stellar_monthly_serviced } }
  set_timed_country_flag = { flag = cfcompat_stellar_monthly_serviced days = 1 }
  country_event = { id = stellarai_commitment.904 }
  country_event = { id = cfcompat_stellar.2 }
 }
} }
country_event = { id = cfcompat_stellar.2 hide_window = yes is_triggered_only = yes trigger = { ${STEERED_COUNTRY_TRIGGER} = yes is_ai = no is_nomadic = no }
 ${counter}
}
`,onActions:'on_game_start = { events = { cfcompat_stellar.1 } }\non_monthly_pulse = { events = { cfcompat_stellar.1 } }\n'};
}

export function compatibleZoneCountWeights(source,zones){
 const blocks=scriptBlocks(source).filter(row=>row.key==='complex_trigger_modifier');
 const additional=[];
 for(const zone of zones){
  // Stellar recognises bio-trophy unity zones structurally but omits them
  // from this two-entry counter. Its custom pure-unity counterpart uses the
  // same unity-per-zone coefficient, without changing any NPC base entry.
  const original=blocks.find(row=>new RegExp('\\btype\\s*=\\s*'+zone+'\\b').test(row.text))??(zone==='zone_unity_bio_trophy'?blocks.find(row=>/\btype\s*=\s*zone_unity\b/.test(row.text)):null);
  if(!original)throw Error('Stellar AI区域权重缺少类型：'+zone);
  additional.push(original.text.replace(/(\btype\s*=\s*)zone_[\w]+\b/,'$1cfsteer_'+zone));
 }
 return '# Effective Stellar weights plus equivalent Cyberfish zone counts; no buildings or jobs are changed.\n'+source+'\n'+additional.join('\n\n')+'\n';
}

/** Build a local integration, never modify Stellar AI, vanilla, enabled_mods or launcher databases. */
export async function generateStellarSteeringCompatibility({gameDirectory,stellarDirectory,steeringDirectory}={}){
 if(!gameDirectory||!stellarDirectory||!steeringDirectory)throw Error('需要真实游戏、Stellar AI及Steering源码目录');
 const descriptor=await readFile(join(stellarDirectory,'descriptor.mod'),'utf8');
 if(/\breplace_path\s*=/.test(descriptor))throw Error('Stellar AI声明replace_path，必须按实际替换目录另行适配');
 const workshop=/\bremote_file_id\s*=\s*"?(\d+)/.exec(descriptor)?.[1];
 if(workshop&&workshop!==STELLAR_VANILLA_JOBS_ID)throw Error('此适配只接受Stellar AI原版岗位产出版，不与其他版本叠加');
 if(!/supported_version\s*=\s*"v?4\.5(?:\.[2*]|\*)/.test(descriptor))throw Error('实际Stellar AI版本未声明4.5兼容');
 if((await filesAt(stellarDirectory,'pop_jobs')).length)throw Error('实际Stellar AI含岗位文件，未按原版岗位产出版生成适配');
 const manifest=[],categories={};
 for(const category of ['ai_budget','economic_plans','buildings','zones','technology','scripted_triggers','scripted_effects','tradition_categories','personalities'])categories[category]=await effectiveCategory(gameDirectory,stellarDirectory,category,manifest);
 if(!manifest.some(row=>row.path.startsWith('common/economic_plans/')))throw Error('真实Stellar AI未包含经济计划文件，不能只用简介生成补丁');
 const economy=compatibleEconomyPlans(categories.economic_plans.all);
 const expansion=compatibleExpansionBudgets([...categories.ai_budget.definitions.values()]);
 const personality=compatiblePersonalities([...categories.personalities.definitions.values()],await readFile(join(steeringDirectory,'common/personalities/cfsteer_personality.txt'),'utf8'));
 const node=required(categories.buildings,'building_hive_node'),nodeSource=await readFile(node.origin,'utf8');
 manifest.push({path:'common/buildings/'+node.origin.replace(/^.*[\\/]/,''),sourcePath:node.origin,sha256:hash(nodeSource)});
 const research=selected(categories.zones,researchZones),unity=selected(categories.zones,unityZones);
 const inlineScripts=await loadZoneInlineScripts(gameDirectory,research+'\n'+unity,{modDirectories:[stellarDirectory],onSource:row=>manifest.push({path:row.path,sourcePath:row.sourcePath,sha256:hash(row.content)})});
 const traditions=Object.fromEntries([...categories.tradition_categories.definitions].filter(([key])=>key.startsWith('tradition_')).map(([key,row])=>[key.slice(10),joined([row])]));
 const warPath='events/stellarai_strategy_events.txt',warSource=await readFile(join(stellarDirectory,warPath),'utf8');manifest.push({path:warPath,sha256:hash(warSource)});
 const warEvent=scriptBlocks(warSource).find(row=>row.key==='country_event'&&/\bid\s*=\s*stellarai_strategy\.1\b/.test(row.text));
 if(!warEvent)throw Error('Stellar AI原始战争计数事件缺失');
 const services=compatiblePlayerServices(categories.scripted_triggers,categories.scripted_effects,warEvent.text);
 const files=[
  file('common/economic_plans/zzzz_cfsteer_stellar_plans.txt',economy.content),
  file('common/ai_budget/zzzz_cfsteer_stellar_expansion.txt',expansion.content),
  file('common/personalities/zzzz_cfsteer_stellar_personalities.txt',personality.content),
  file('common/buildings/zzzz_cfsteer_stellar_unity_node.txt',unityNodeBuildingPreference(node)),
  file('common/zones/zzzz_cfsteer_stellar_research.txt',researchZoneOverrides(research,{inlineScripts})),
  file('common/zones/zzzz_cfsteer_stellar_unity.txt',unityZoneOverrides(unity,{inlineScripts})),
  file('common/technology/zzzz_cfsteer_stellar_unity.txt',unityTechnologyOverrides(selected(categories.technology,technologies))),
  file('common/tradition_categories/zzzz_cfsteer_stellar_traditions.txt',traditionPriorityOverrides(traditions)),
  file('common/scripted_triggers/zzzz_cfsteer_stellar_zones.txt',compatibleZoneTriggers(categories.scripted_triggers)),
  file('common/scripted_triggers/zzzz_cfsteer_stellar_services.txt',services.triggers),
  file('common/scripted_effects/zzzz_cfsteer_stellar_services.txt',services.effects),
  file('common/on_actions/zzzz_cfcompat_stellar.txt',services.onActions),
  file('events/cfcompat_stellar_service.txt',services.events)
 ];
 for(const [name,zones]of [['research', [...researchZones,'zone_research_unity']],['unity',['zone_unity','zone_unity_spiritualist','zone_unity_bio_trophy']]]){
  const path=`common/inline_scripts/stellarai/${name}_zones_weight_scaling.txt`,source=await readFile(join(stellarDirectory,path),'utf8');manifest.push({path,sha256:hash(source)});
  files.push(file(path,compatibleZoneCountWeights(source,zones)));
 }
 for(const language of ['english','simp_chinese'])files.push(file(`localisation/${language}/zzzz_cfsteer_stellar_l_${language}.yml`,'\ufeffl_'+language+':\n'+personality.aliases.map(([key,source])=>` ${key}:0 "$${source}$"`).join('\n')+'\n'));
 return {workshopId:STELLAR_VANILLA_JOBS_ID,identityConfirmed:workshop===STELLAR_VANILLA_JOBS_ID,files,economyPlans:economy.plans,restrictedExpansionBudgets:expansion.keys,sourceFiles:manifest,sourceFingerprint:hash(JSON.stringify(manifest)),jobOutputsChanged:false,
  unityPriority:{condition:UNITY_PRIORITY_CONDITION,building:'building_hive_node',valuationOnly:true,preserveSupply:true,militarySpending:'peaceful_unity_only_zero',civilianShipBudgetsUnchanged:true,runtimeTested:false},
  requiresLoadAfter:[/\bname\s*=\s*"([^"\r\n]+)"/.exec(descriptor)?.[1]??'Stellar AI Vanilla Job Levels'],humanAIConditions:'Steered country trigger covers human_ai regardless of is_ai; mutually exclusive monthly dispatch preserves NPC service and suppresses scripted market/aid effects for controlled countries.'};
}
