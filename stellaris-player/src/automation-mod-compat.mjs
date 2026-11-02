import {readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {scriptBlocks,STEERED_COUNTRY_TRIGGER,STEERED_COUNTRY_DEFINITION} from './stellar-steering-compat.mjs';

const scope=STEERED_COUNTRY_TRIGGER;
const hash=x=>createHash('sha256').update(x).digest('hex');
const uaDisabled=['auto_army_invade_enable_flag','auto_army_recruit_enable_flag','auto_bulding_upgrader_flag','auto_colonizer_enable_flag','auto_colony_manager_flag','auto_colony_support_flag','auto_construct_mega_flag','auto_construct_outposts_flag','auto_fleet_attack_enable_flag','auto_fleet_merger_enable_flag','auto_outfit_starbases_flag','auto_planet_destroyer_enable_flag','auto_recruit_leaders_enable_flag','auto_terraforming_flag','auto_upgrade_deep_space_citadels_flag','auto_upgrade_megastructure_flag','auto_upgrade_starbases_flag'];
const perfEnabled=['ai_unemployment_flag','modifier_optimisation_flag'];
const perfDisabled=['ai_gateway_construction_flag','ai_hyper_relay_construction_flag','ai_xeno_compatibility_flag','ai_habitat_construction_flag','ai_ringworld_construction_flag','ai_corvette_destroyer_spam_flag','ai_civilian_ship_spam_flag','ai_planet_count_flag','ai_omnicodex_flag','ai_deep_space_citadel_construction_flag','ai_and_player_flag','ai_fleet_merger_flag'];
const id=entry=>entry.match(/\bid\s*=\s*([\w.]+)/)?.[1];
function own(entry,key){return scriptBlocks(entry.slice(entry.indexOf('{')+1,-1)).find(row=>row.key===key)?.text;}
function edit(entry,key,fn){const old=own(entry,key);const value=key+' = {\n'+fn(old?old.slice(old.indexOf('{')+1,-1):'')+'\n}';return old?entry.replace(old,value):entry.slice(0,-1)+'\n'+value+'\n}';}
function eventPatch(raw,fn){let result=raw;for(const entry of scriptBlocks(raw)){if(!entry.key.endsWith('_event')&&entry.key!=='event')continue;result=result.replace(entry.text,fn(entry.text,entry.key,id(entry.text)));}return result;}
const countryGuard='NOT = { '+scope+' = yes }';
const foreignGuard=type=>type==='country_event'?countryGuard:'owner = { '+countryGuard+' }';

// Unlike a runtime trigger, pruning here prevents absent database references
// from being parsed at all. Positions include parameterized scope names.
function childBlocks(body){
 const result=[];let depth=0,quoted=false,escaped=false,comment=false,start=0,key='';
 for(let i=0;i<body.length;i++){
  const ch=body[i];if(comment){if(ch==='\n')comment=false;continue;}
  if(quoted){if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch==='"')quoted=false;continue;}
  if(ch==='#'){comment=true;continue;}if(ch==='"'){quoted=true;continue;}
  if(ch==='{'){if(depth===0){const m=/([\w.$@]+)\s*=\s*$/.exec(body.slice(0,i));if(!m)throw Error('可选依赖脚本对象无法识别');start=i-m[0].length;key=m[1];}depth++;}
  else if(ch==='}'&&--depth===0)result.push({key,start,end:i+1,text:body.slice(start,i+1)});
 }
 if(depth!==0||quoted)throw Error('可选依赖脚本括号不完整');return result;
}
const code=body=>body.replace(/#[^\n]*/g,'');
const absentFlag=(limit,deps)=>{
 const text=code(limit??'').replace(/\s/g,'');if(!text||/NOT=|not=/.test(text))return false;
 const flags=(!deps.nsc?['has_nsc_active']:[]).concat(!deps.gigastructures?['giga_game_started']:[],!deps.acot?['acot_activated']:[]);
 return flags.some(flag=>new RegExp('^(?:[\\w.$]+=\\{)*has_global_flag='+flag+'\\}*$').test(text));
};
function foldAbsentBranches(body,deps){
 const blocks=childBlocks(body);let out='',offset=0;
 for(let i=0;i<blocks.length;i++){
  const b=blocks[i],inner=b.text.slice(b.text.indexOf('{')+1,-1);out+=body.slice(offset,b.start);
  const limit=childBlocks(inner).find(x=>x.key==='limit')?.text;
  if((b.key==='if'||b.key==='else_if')&&absentFlag(limit?.slice(limit.indexOf('{')+1,-1),deps)){
   const next=blocks[i+1];
   if(next&&next.key==='else'&&!code(body.slice(b.end,next.start)).trim()){
    out+=foldAbsentBranches(next.text.slice(next.text.indexOf('{')+1,-1),deps);offset=next.end;i++;continue;
   }
   if(next&&next.key==='else_if'&&!code(body.slice(b.end,next.start)).trim()){
    let end=i+1;while(blocks[end+1]&&['else_if','else'].includes(blocks[end+1].key)&&!code(body.slice(blocks[end].end,blocks[end+1].start)).trim())end++;
    out+=foldAbsentBranches(body.slice(next.start,blocks[end].end).replace(/^else_if/,'if'),deps);offset=blocks[end].end;i=end;continue;
   }
   offset=b.end;continue;
  }
  out+=b.key+' = {'+foldAbsentBranches(inner,deps)+'}';offset=b.end;
 }
 return out+body.slice(offset);
}
function unavailableReference(body,deps){
 const text=code(body);
 return !deps.gigastructures&&/\bgiga_|\bpc_giga_|@giga_|\bplanetary_computer_0\b/i.test(text)||!deps.nsc&&/\btech_nsc|\bconstruction_office\b|\badv_space_engineers\b|\bstarbase_(?:stronghold|headquarters)\b|\btech_starbase_[67]\b/i.test(text)||!deps.sra&&/tech_SRA_|civic_SRA|planet_SRA_/i.test(text)||!deps.acot&&/\bacot_|tech_bombardment_(?:dm|ae)\b/i.test(text);
}
function disabledDefinition(entry,kind){
 const eventId=id(entry.text);
 if(kind==='event')return `${entry.key} = { id = ${eventId} hide_window = yes is_triggered_only = yes trigger = { always = no } }`;
 if(kind==='trigger')return entry.key+' = { always = no }';
 if(kind==='value')return entry.key+' = { base = 0 }';
 return entry.key+' = { }';
}
function sanitizeDefinitions(raw,kind,deps){
 let result=raw;
 for(const entry of scriptBlocks(raw)){
  if(kind==='event'&&!entry.key.endsWith('_event')&&entry.key!=='event')continue;
  let body=foldAbsentBranches(entry.text.slice(entry.text.indexOf('{')+1,-1),deps);
  // Prune unavailable menu choices without disabling the valid vanilla choices.
  for(const option of childBlocks(body).filter(x=>x.key==='option'))if(unavailableReference(option.text,deps))body=body.replace(option.text,'');
  // The legacy colony transition randomly destroys planet buildings while in
  // colony scope. The unselected destructive feature is removed, not redirected.
  for(const block of childBlocks(body)){
   if(block.key==='modifier'&&!deps.nsc&&/construction_office|adv_space_engineers/.test(block.text))body=body.replace(block.text,'');
  }
  const revised=entry.key+' = {'+body+'}';
  const dependencyOnly=!deps.nsc&&/_nsc_template$/.test(entry.key)||!deps.sra&&/_sra_/.test(entry.key);
  result=result.replace(entry.text,dependencyOnly||unavailableReference(revised,deps)?disabledDefinition(entry,kind):revised);
 }
 return result;
}
const helperFolders=[['common/scripted_effects','effect'],['common/scripted_triggers','trigger'],['common/script_values','value']];
function helperReferences(body,definitions){return [...new Set(code(body).match(/[A-Za-z_]\w*/g)??[])].filter(name=>definitions.has(name));}
function helperClosure(body,definitions){
 const pending=helperReferences(body,definitions),retained=new Set();
 while(pending.length){const name=pending.pop();if(retained.has(name))continue;retained.add(name);pending.push(...helperReferences(definitions.get(name).text,definitions));}
 return retained;
}
function inertEvents(raw){
 const namespaces=[...code(raw).matchAll(/^\s*namespace\s*=\s*([\w.]+)/gm)].map(x=>'namespace = '+x[1]);
 const entries=scriptBlocks(raw).filter(x=>x.key==='event'||x.key.endsWith('_event'));
 for(const entry of entries)if(!id(entry.text))throw Error('UA停用事件缺少ID');
 return [...namespaces,...entries.map(entry=>disabledDefinition(entry,'event'))].join('\n')+'\n';
}
async function textFiles(root,folder,read){
 const result=[];
 for(const entry of (await readdir(join(root,folder),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name,'en'))){
  if(entry.isSymbolicLink())throw Error('Mod源文件目录不能包含链接：'+folder);
  if(entry.isDirectory())result.push(...await textFiles(root,folder+'/'+entry.name,read));
  else if(entry.isFile()&&entry.name.endsWith('.txt')){const path=folder+'/'+entry.name;result.push({path,raw:await read(root,path)});}
 }
 return result;
}
function chargeOnlySelectedDestination(entry){
 const visit=body=>childBlocks(body).flatMap(block=>[block,...visit(block.text.slice(block.text.indexOf('{')+1,-1))]);
 const roots=visit(entry).filter(block=>block.key==='root'&&own(block.text,'add_resource')&&scriptBlocks(block.text.slice(block.text.indexOf('{')+1,-1)).some(child=>child.key==='random_owned_colony'&&own(child.text,'resettle_pop_group')));
 if(roots.length!==1)throw Error('UA人口迁移目标和扣费结构已变化');
 const root=roots[0].text,charge=own(root,'add_resource'),destination=scriptBlocks(root.slice(root.indexOf('{')+1,-1)).find(block=>block.key==='random_owned_colony'&&own(block.text,'resettle_pop_group')).text;
 if(!/energy\s*=\s*100\b/.test(charge)||!charge.includes('negative_modifier_mult'))throw Error('UA人口迁移扣费结构已变化');
 // The Workshop script debits even when its random destination iterator finds
 // no eligible colony. Keep the original debit, but scope it to a found target.
 const selected=destination.slice(0,-1)+'\nroot = { '+charge+' }\n}';
 return entry.replace(root,root.replace(charge,'').replace(destination,selected));
}

/** Build a personal compatibility overlay from the actual installed Workshop files.
 * No source files, playsets or live games are mutated by this generator. */
export async function generateAutomationCompatibility({ultimateDirectory,performanceDirectory,reserveEnergy=500,reserveAlloys=1000,dependencies={nsc:false,gigastructures:false,sra:false,acot:false}}={}){
 if(!ultimateDirectory&&!performanceDirectory)throw Error('请提供实际下载的自动化或性能Mod目录');
 for(const [key,value] of Object.entries({reserveEnergy,reserveAlloys}))if(!Number.isSafeInteger(value)||value<0||value>100000)throw Error('资源保留值无效：'+key);
 const deps={nsc:false,gigastructures:false,sra:false,acot:false,...dependencies};
 if(Object.keys(deps).some(key=>!['nsc','gigastructures','sra','acot'].includes(key)||typeof deps[key]!=='boolean'))throw Error('可选依赖必须明确给出布尔状态');
 const files=[],sources=[],warnings=[];
 const add=(path,content)=>{const prior=files.find(x=>x.path===path);if(prior)prior.content=Buffer.from(content,'utf8');else files.push({path,content:Buffer.from(content,'utf8')});};
 const read=async(root,path)=>{const content=await readFile(join(root,path),'utf8');sources.push({path:join(root,path),sha256:hash(content)});return content;};
 const validate=async(root,remote)=>{const descriptor=await read(root,'descriptor.mod');if(!descriptor.includes('remote_file_id="'+remote+'"')||!/supported_version\s*=\s*"v?4\.5\.\*"/.test(descriptor))throw Error('自动化Mod来源或版本与已适配的4.5脚本不符');};
 add('common/scripted_triggers/zz_cfcompat_automation_scope.txt',STEERED_COUNTRY_DEFINITION);
 let profile='';const loaderProfile={dependencies:deps,removedDemolition:true,thirdPartyFleetMerge:false};
 if(ultimateDirectory){
  await validate(ultimateDirectory,'2250100617');
  const button=await read(ultimateDirectory,'common/button_effects/lazy_button_effects.txt');
  for(const flag of [...uaDisabled,'auto_pop_migration_flag','auto_pop_migration_unemployed_to_free_jobs_flag'])if(!button.includes('set_country_flag = '+flag))throw Error('UA控制开关已变化，未生成可能失效的配置：'+flag);
  profile+=uaDisabled.map(flag=>'remove_country_flag = '+flag).join('\n')+`\nset_country_flag = auto_pop_migration_flag
set_country_flag = auto_pop_migration_unemployed_to_free_jobs_flag
set_country_flag = auto_pop_migration_habitability_flag
remove_country_flag = auto_pop_migration_to_synaptic_lathe_flag
remove_country_flag = auto_non_main_pop_migration_to_synaptic_lathe_flag
set_variable = { which = auto_mig_une_pop_speed value = 1 }
remove_country_flag = cfcompat_ua_starbase_outfitting_opt_in
# Legacy third-party merge_fleet queue action is not valid in the loaded 4.5 engine.
# Native country AI retains responsibility for merging; remove only mod markers.
every_owned_fleet = { limit = { has_fleet_flag = auto_fleet_merger_flag } remove_fleet_flag = auto_fleet_merger_flag }
`;
  const pop=await read(ultimateDirectory,'events/lazy_pop_mig_events.txt');
  for(const marker of ['lazy_pop_mig_events.1','resettle_pop_group','auto_mig_une_pop_speed'])if(!pop.includes(marker))throw Error('UA人口迁移脚本结构已变化');
  const migration=scriptBlocks(pop).find(entry=>id(entry.text)==='lazy_pop_mig_events.1');
  if(!migration)throw Error('UA人口迁移主事件缺失');
  const migrationEvent=edit(chargeOnlySelectedDestination(migration.text),'trigger',body=>body+`\n${scope} = yes\nresource_stockpile_compare = { resource = energy value >= value:cfcompat_ua_migration_floor }`);
  add('events/lazy_pop_mig_events.txt',eventPatch(pop,(entry,type,eventId)=>eventId==='lazy_pop_mig_events.1'?migrationEvent:disabledDefinition({key:type,text:entry},'event')));
  add('common/script_values/zz_cfcompat_automation_budget.txt',`cfcompat_ua_migration_floor = { base = 100 multiply = value:positive_modifier_mult|MODIFIER|country_resettlement_cost_mult| add = ${reserveEnergy} }
`);
  // Runtime flags cannot isolate broken macros: the engine still expands their
  // complete bodies during startup. Keep only the reviewed migration closure;
  // replace every other UA definition and its callers before the loader sees it.
  const definitions=new Map(),helperFiles=[];
  for(const [folder,kind] of helperFolders)for(const file of await textFiles(ultimateDirectory,folder,read)){
   const entries=scriptBlocks(file.raw);helperFiles.push({...file,kind,entries});
   for(const entry of entries){if(definitions.has(entry.key))throw Error('UA共享定义重名：'+entry.key);definitions.set(entry.key,{...entry,kind,path:file.path});}
  }
  const retained=helperClosure(migrationEvent,definitions);
  if([...retained].sort().join(',')!=='negative_modifier_mult,positive_modifier_mult')throw Error('UA人口迁移依赖闭包已变化，需重新适配');
  for(const name of retained){const entry=definitions.get(name);if(entry.kind!=='value'||!/modifier:\$MODIFIER\$/.test(entry.text)||/\[\[/.test(code(entry.text)))throw Error('UA人口迁移成本依赖已变化：'+name);}
  const crossReferences=new Set();
  if(performanceDirectory)for(const folder of ['common','events'])for(const file of await textFiles(performanceDirectory,folder,read))for(const name of helperReferences(file.raw,definitions))crossReferences.add(name);
  const wouldDisable=[...crossReferences].filter(name=>!retained.has(name));
  if(wouldDisable.length)throw Error('性能Mod仍依赖待停用的UA共享定义：'+wouldDisable.join(', '));
  for(const file of helperFiles)add(file.path,file.entries.map(entry=>retained.has(entry.key)?entry.text:disabledDefinition(entry,file.kind)).join('\n')+'\n');
  for(const file of await textFiles(ultimateDirectory,'events',read))if(file.path!=='events/lazy_pop_mig_events.txt')add(file.path,inertEvents(file.raw));
  // Hide obsolete controls and remove their effects as well as the event menu;
  // no surviving button may instantiate a disabled parameterized definition.
  add('common/button_effects/lazy_button_effects.txt',scriptBlocks(button).map(entry=>`${entry.key} = { potential = { always = no } allow = { always = no } effect = { } }`).join('\n')+'\n');
  for(const folder of ['common/decisions','common/edicts'])for(const file of await textFiles(ultimateDirectory,folder,read))add(file.path,scriptBlocks(file.raw).map(entry=>edit(edit(entry.text,'potential',()=> 'always = no'),'effect',()=> '')).join('\n')+'\n');
  for(const folder of ['common/colony_automation','common/colony_automation_categories','common/scripted_variables'])for(const file of await textFiles(ultimateDirectory,folder,read))add(file.path,'# UA migration-only profile: unselected module contributes no definitions.\n');
  const actions=await read(ultimateDirectory,'common/on_actions/lazy_actions.txt');
  if(!/on_monthly_pulse_country\s*=\s*\{\s*events\s*=\s*\{/.test(actions))throw Error('UA月度入口已变化');
  add('common/on_actions/lazy_actions.txt','on_monthly_pulse_country = { events = { cfcompat_automation.1 lazy_pop_mig_events.1 } }\n');
  Object.assign(loaderProfile,{ultimateMode:'migration_only',ultimateGloballyDisabled:'all_non_migration_modules',migrationHelpers:[...retained].sort(),performanceSharedHelpers:[...crossReferences].sort()});
  warnings.push('UA现为全局迁移专用配置：仅托管本国的失业人口迁移与其两个成本值仍活动；星基配置、第三方合并、建设、领袖、殖民、攻击、菜单等其余模块连定义和入口一并隔离，对NPC也停用这些UA功能。星基opt-in已撤下；日常经营与合并交给原生国家AI。迁移每月最多一次并保留能源，尚需加载及运行验收；能源保留金不是原生AI全局硬预算。');
 }
 if(performanceDirectory){
  await validate(performanceDirectory,'2184737698');
  const raw=await read(performanceDirectory,'events/fix_events.txt');
  for(const flag of [...perfEnabled,...perfDisabled])if(!raw.includes(flag))throw Error('性能Mod控制开关已变化：'+flag);
  const defaults=[...perfEnabled.map(flag=>'set_global_flag = '+flag),...perfDisabled.map(flag=>'remove_global_flag = '+flag)].join('\n');
  add('events/fix_events.txt',eventPatch(raw,(entry,type,eventId)=>{
   if(eventId==='fix_ai_actions.1')return edit(entry,'immediate',()=>defaults);
   if(['fix_ai_actions.0','fix_ai_actions.2','fix_ai_actions.13'].includes(eventId))return entry;
   return edit(entry,'trigger',body=>body+'\n'+foreignGuard(type));
  }));
  // This file has an unconditional AI species-edit restriction, independent of
  // menu flags. Empty overlay removes only this mod file, leaving vanilla rules.
  const rules=await read(performanceDirectory,'common/game_rules/fix_rules.txt');
  if(!rules.includes('can_modify_species')||!rules.includes('count_exact_species'))throw Error('性能Mod物种规则已变化');
  add('common/game_rules/fix_rules.txt','# Compatibility profile: use the game/other-mod species modification rules; no extra AI species-count limit.\n');
  const perks=await read(performanceDirectory,'common/ascension_perks/fix_ascension_perks.txt');
  if(!perks.includes('ap_xeno_compatibility')||!perks.includes('ai_xeno_compatibility_flag'))throw Error('性能Mod天赋限制已变化');
  add('common/ascension_perks/fix_ascension_perks.txt','# Compatibility profile: keep the game/other-mod ap_xeno_compatibility definition; a later menu flag must not restrict the steered player.\n');
  profile+=`\nif = { limit = { NOT = { has_global_flag = cfcompat_performance_profile_initialized } } ${defaults} set_global_flag = cfcompat_performance_profile_initialized }
remove_modifier = micro_marketing
remove_modifier = ai_habitat_restriction
remove_modifier = ai_hyper_relay_restriction
remove_modifier = ai_gateway_restriction
remove_modifier = ai_ring_world_restriction
remove_modifier = ai_planet_restriction
remove_modifier = ai_dsp_restriction
`;
  if(!ultimateDirectory)add('common/on_actions/zz_cfcompat_performance_actions.txt','on_monthly_pulse_country = { events = { cfcompat_automation.1 } }\n');
  warnings.push('性能配置默认全局关闭发展上限、科研/工程船删除、舰种替换及不兼容的第三方合并，影响所有AI；只保留其他国家的失业迁移、批量更新，合并交回原生AI。托管本国不运行这些事件以避免重复；没有将is_ai全局改写成本国。此性能Mod的额外物种数量规则和异种兼容天赋覆盖均全局停用，保留游戏或其他Mod定义。');
 }
 // The performance mod has no references to the isolated UA modules. Its own
 // optional integration is pruned independently, without touching native AI.
 if(performanceDirectory){
  const path='events/fix_events.txt';let body=files.find(x=>x.path===path).content.toString('utf8');
  body=sanitizeDefinitions(body,'event',deps);
  body=eventPatch(body,(entry,type,eventId)=>['fix_ai_actions.17','fix_ai_actions.18','fix_ai_actions.19'].includes(eventId)?disabledDefinition({key:type,text:entry},'event'):entry);
  add(path,body);
 }
 if(performanceDirectory)warnings.push('性能Mod按未安装依赖裁剪可选集成；UA则按迁移依赖闭包整体隔离未选模块，保留事件ID和函数名为空操作，不以运行开关或缺失引用扫描代替加载验收。');
 add('events/zz_cfcompat_automation_events.txt',`namespace = cfcompat_automation
country_event = { id = cfcompat_automation.1 hide_window = yes is_triggered_only = yes trigger = { ${scope} = yes } immediate = { ${profile} } }
`);
 return {files,sources,profile:{ultimate:!!ultimateDirectory,performance:!!performanceDirectory,reserveEnergy,reserveAlloys,uaDisabled:ultimateDirectory?uaDisabled:[],performanceGlobalEnabled:performanceDirectory?perfEnabled:[],performanceGlobalDisabled:performanceDirectory?perfDisabled:[],nativeCountryExcludedFromPerformance:!!performanceDirectory,automaticallyAssignsStarbaseTemplates:false,starbaseOutfittingDefault:'disabled_loader_incompatible',thirdPartyFleetMerge:false,loaderProfile},warnings};
}
