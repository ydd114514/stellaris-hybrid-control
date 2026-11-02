import test from 'node:test';
import assert from 'node:assert/strict';
import {access,mkdtemp,writeFile,rm,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateAutomationCompatibility} from '../src/automation-mod-compat.mjs';
import {scriptBlocks} from '../src/stellar-steering-compat.mjs';

test('automation compatibility refuses missing, unverified or invalid-reserve sources',async()=>{
 await assert.rejects(generateAutomationCompatibility(),/实际下载/);
 await assert.rejects(generateAutomationCompatibility({ultimateDirectory:'unused',reserveAlloys:-1}),/保留值无效/);
 const root=await mkdtemp(join(tmpdir(),'cfcompat-automation-'));
 try{await writeFile(join(root,'descriptor.mod'),'remote_file_id="2250100617"\nsupported_version="4.4.*"\n');await assert.rejects(generateAutomationCompatibility({ultimateDirectory:root}),/来源或版本/);}
 finally{await rm(root,{recursive:true,force:true});}
});

const workshop=process.env.CYBERFISH_WORKSHOP_SOURCE??'C:/Tools/SteamCMD/steamapps/workshop/content/281990';
let available=true;try{await access(join(workshop,'2250100617/descriptor.mod'));await access(join(workshop,'2184737698/descriptor.mod'));}catch{available=false;}
test('downloaded official 4.5 source produces selective, balanced and non-destructive overlays',{skip:!available},async()=>{
 const result=await generateAutomationCompatibility({ultimateDirectory:join(workshop,'2250100617'),performanceDirectory:join(workshop,'2184737698')});
 const files=new Map(result.files.map(x=>[x.path,x.content.toString('utf8')]));
 for(const [path,body] of files){assert.doesNotThrow(()=>scriptBlocks(body),path);assert.ok(!path.includes('..'));}
 const profile=files.get('events/zz_cfcompat_automation_events.txt');
 for(const flag of ['auto_colonizer_enable_flag','auto_construct_outposts_flag','auto_construct_mega_flag','auto_fleet_attack_enable_flag'])assert.match(profile,new RegExp('remove_country_flag = '+flag));
 assert.match(profile,/auto_mig_une_pop_speed value = 1/);
 assert.match(profile,/remove_country_flag = cfcompat_ua_starbase_outfitting_opt_in/);
 assert.doesNotMatch(profile,/set_country_flag = auto_outfit_starbases_flag/);
 assert.equal(result.profile.starbaseOutfittingDefault,'disabled_loader_incompatible');
 const fleet=files.get('events/lazy_fle_mer_events.txt');
 assert.equal(result.profile.thirdPartyFleetMerge,false);assert.match(profile,/remove_country_flag = auto_fleet_merger_enable_flag/);assert.doesNotMatch(fleet,/merge_fleet\s*=/);
 const cleanup=scriptBlocks(fleet).find(x=>x.text.match(/\bid\s*=\s*([\w.]+)/)?.[1]==='lazy_fle_mer_events.3').text;
 assert.match(cleanup,/trigger = \{ always = no \}/);
 const performance=files.get('events/fix_events.txt');
 for(const eventId of ['fix_ai_actions.4','fix_ai_actions.21','fix_ai_actions.22']){
  const event=scriptBlocks(performance).find(x=>x.text.match(/\bid\s*=\s*([\w.]+)/)?.[1]===eventId);
  assert.ok(event);assert.match(event.text,/NOT = \{ cfcompat_steered_country = yes \}/);
 }
 assert.ok(result.profile.performanceGlobalDisabled.includes('ai_civilian_ship_spam_flag'));
 assert.ok(result.profile.performanceGlobalDisabled.includes('ai_corvette_destroyer_spam_flag'));
 assert.doesNotMatch(files.get('common/game_rules/fix_rules.txt'),/can_modify_species\s*=/);
 assert.doesNotMatch(files.get('common/ascension_perks/fix_ascension_perks.txt'),/ap_xeno_compatibility\s*=/);
 assert.match(files.get('common/script_values/zz_cfcompat_automation_budget.txt'),/multiply = value:positive_modifier_mult/);
 assert.match(files.get('common/scripted_effects/lazy_out_sta_scripted_effects.txt'),/fill_starbase_slot = \{ \}/);
 assert.ok(result.sources.length>10);assert.ok(result.sources.every(s=>/^[a-f0-9]{64}$/.test(s.sha256)));
});

test('migration-only profile isolates complete unused modules and preserves the shared cost dependency closure',{skip:!available},async()=>{
 const result=await generateAutomationCompatibility({ultimateDirectory:join(workshop,'2250100617'),performanceDirectory:join(workshop,'2184737698')});
 const files=new Map(result.files.map(x=>[x.path,x.content.toString('utf8')]));
 for(const [path,raw] of files){const body=raw.replace(/#[^\n]*/g,'');
  assert.doesNotMatch(body,/value:giga_|@giga_|has_starbase_building\s*=\s*(?:construction_office|adv_space_engineers)|has_technology\s*=\s*(?:giga_\w+|tech_SRA_\w+|tech_bombardment_(?:dm|ae))|\bstarbase_(?:stronghold|headquarters)\b|\bacot_\w+|is_pop_category\s*=\s*slave\b|set_fleet_bombardment_stance\s*=\s*(?:punishment|exterminatus)\b|merge_fleet\s*=|remove_random_building\s*=/,path);
 }
 assert.equal(result.profile.loaderProfile.ultimateMode,'migration_only');
 assert.deepEqual(result.profile.loaderProfile.migrationHelpers,['negative_modifier_mult','positive_modifier_mult']);
 assert.deepEqual(result.profile.loaderProfile.performanceSharedHelpers,[]);
 const source=join(workshop,'2250100617'),retained=new Set(result.profile.loaderProfile.migrationHelpers);
 for(const folder of ['common/scripted_effects','common/scripted_triggers','common/script_values'])for(const name of await readdir(join(source,folder))){
  if(!name.endsWith('.txt'))continue;const path=folder+'/'+name,original=scriptBlocks(await readFile(join(source,path),'utf8'));
  assert.ok(files.has(path),path);const output=scriptBlocks(files.get(path));
  assert.deepEqual(output.map(x=>x.key),original.map(x=>x.key),path);
  for(let i=0;i<output.length;i++){
   if(retained.has(output[i].key)){assert.equal(output[i].text,original[i].text);continue;}
   const empty=folder.endsWith('scripted_effects')?'':folder.endsWith('scripted_triggers')?'always = no':'base = 0';
   assert.equal(output[i].text,output[i].key+' = { '+(empty?empty+' ':'')+'}',path+':'+output[i].key);
  }
 }
 for(const name of await readdir(join(source,'events'))){
  if(!name.endsWith('.txt'))continue;const path='events/'+name,raw=await readFile(join(source,path),'utf8');
  const entries=body=>scriptBlocks(body).filter(x=>x.key==='event'||x.key.endsWith('_event'));
  const original=entries(raw),output=entries(files.get(path));
  assert.deepEqual(output.map(x=>x.text.match(/\bid\s*=\s*([\w.]+)/)?.[1]),original.map(x=>x.text.match(/\bid\s*=\s*([\w.]+)/)?.[1]),path);
  for(const event of output){
   if(event.text.match(/\bid\s*=\s*([\w.]+)/)?.[1]==='lazy_pop_mig_events.1'){
    assert.match(event.text,/resettle_pop_group/);assert.match(event.text,/cfcompat_steered_country = yes/);
    const nested=body=>scriptBlocks(body).flatMap(block=>[block,...nested(block.text.slice(block.text.indexOf('{')+1,-1))]);
    const direct=(block,key)=>scriptBlocks(block.text.slice(block.text.indexOf('{')+1,-1)).filter(child=>child.key===key);
    const blocks=nested(event.text),destination=blocks.find(block=>block.key==='random_owned_colony'&&direct(block,'resettle_pop_group').length);
    assert.ok(destination);assert.equal(blocks.filter(block=>block.key==='add_resource').length,1);
    const chargeOwner=direct(destination,'root');assert.equal(chargeOwner.length,1);assert.equal(direct(chargeOwner[0],'add_resource').length,1);
    assert.match(chargeOwner[0].text,/energy\s*=\s*100\b/);continue;
   }
   assert.match(event.text,/trigger = \{ always = no \}/,path);assert.doesNotMatch(event.text,/\bimmediate\s*=|\$[A-Z_]+\$|\[\[/,path);
  }
 }
 assert.equal(files.get('common/on_actions/lazy_actions.txt'),'on_monthly_pulse_country = { events = { cfcompat_automation.1 lazy_pop_mig_events.1 } }\n');
 for(const [path,body]of files)if(path.includes('lazy_')){
  assert.doesNotMatch(body,/\[\[|\$(?:TECH_\d+|CHECK_SYSTEM|CHECK_PLANET|BUILDING|MODULE|SLOT|ALLOYS)\$|\badd_zone\s*=|\barmy_leader\s*=|used_starbase_capacity_integer/,path);
 }
 const perf=files.get('events/fix_events.txt');
 const unemployment=scriptBlocks(perf).find(x=>x.text.match(/\bid\s*=\s*([\w.]+)/)?.[1]==='fix_ai_actions.3');
 assert.match(unemployment.text,/resettle_pop_group\s*=/);
});
