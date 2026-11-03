import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { installObserverMod, installSteeringMod, MOD_NAME } from '../src/mod-install.mjs'

async function fixture(t) {
  const folder = await mkdtemp(join(tmpdir(), 'fish-observer-mod-'))
  t.after(async () => { assert.ok(resolve(folder).startsWith(resolve(tmpdir()))); await rm(folder, { recursive: true, force: true }) })
  await mkdir(join(folder, 'mod'))
  return folder
}
test('steering updates preserve launcher-formatted descriptors but refuse redirected targets',async t=>{
 const folder=await fixture(t);await installSteeringMod({documentsPath:folder});
 const descriptor=join(folder,'mod','cyberfish_steering_v1.mod');
 const text='name="Cyberfish Steering v1"\nversion="1.0.0"\ntags={ "AI" }\nsupported_version="4.5.*"\npath="'+join(folder,'mod','cyberfish_steering_v1').replaceAll('\\','/')+'"';
 await writeFile(descriptor,text);assert.deepEqual((await installSteeringMod({documentsPath:folder})).created,[]);
 assert.equal(await readFile(descriptor,'utf8'),text);
 await writeFile(descriptor,text.replace('path="','path="redirected/'));
 await assert.rejects(installSteeringMod({documentsPath:folder}),/未覆盖/);
});
test('steering removes its known fixed personality and backs it up without touching customized files',async t=>{
 const folder=await fixture(t);await installSteeringMod({documentsPath:folder});
 const path=join(folder,'mod','cyberfish_steering_v1/common/personalities/cfsteer_personality.txt');
 const current=[
  'cfsteer_reserved_diplomacy = {',' aggressiveness = 0',' bravery = 1',' trade_willingness = 1',
  ' military_spending = 1',' colony_spending = 1',' weapon_preferences = weapon_type_energy',
  ' armor_ratio = 0.4',' shields_ratio = 0.4',' hull_ratio = 0.2',
  ' allow = { OR = { has_edict = cfsteer_economy_balanced has_edict = cfsteer_economy_unity_traditions has_edict = cfsteer_economy_consumer_stability has_edict = cfsteer_economy_alloys_military has_edict = cfsteer_economy_research } }',
  ' weight_modifier = { weight = 100000 }',' behaviour = { conqueror = yes opportunist = no crisis_fighter = yes }','}',''
 ].join('\r\n');
 await writeFile(path,current);
 const result=await installSteeringMod({documentsPath:folder,updateGenerated:true,backupDirectory:join(folder,'backup')});
 assert.deepEqual(result.removed,[path]);
 assert.equal(await readFile(result.backups[0],'utf8'),current);
 await assert.rejects(readFile(path),{code:'ENOENT'});
 const custom=current+'\n# custom personality\n';
 await writeFile(path,custom);
 await assert.rejects(installSteeringMod({documentsPath:folder}),/未覆盖/);
 assert.equal(await readFile(path,'utf8'),custom);
});
test('steering upgrade backs up and neutralizes an installed peaceful unity personality',async t=>{
 const folder=await fixture(t);await installSteeringMod({documentsPath:folder});
 const path=join(folder,'mod','cyberfish_steering_v1/common/personalities/zz_cfsteer_unity_exploration.txt');
 const old='cfsteer_unity_exploration_hive = { military_spending = 0 }';
 await writeFile(path,old);
 await assert.rejects(installSteeringMod({documentsPath:folder}),/未覆盖/);
 const result=await installSteeringMod({documentsPath:folder,updateGenerated:true,backupDirectory:join(folder,'backup')});
 assert.deepEqual(result.created,[path]);
 assert.equal(await readFile(result.backups[0],'utf8'),old);
 assert.doesNotMatch(await readFile(path,'utf8'),/\bmilitary_spending\b/);
});
test('installation adds only its own four files and never changes enabled mods', async t => {
  const folder = await fixture(t), settings = '{"enabled_mods":["mod/existing.mod"]}'
  await writeFile(join(folder, 'dlc_load.json'), settings)
  await writeFile(join(folder, 'mod', 'existing.mod'), 'name="existing"')
  const result = await installObserverMod({ documentsPath: folder })
  assert.equal(result.created.length, 4); assert.equal(result.enabledByInstaller, false)
  assert.equal(await readFile(join(folder, 'dlc_load.json'), 'utf8'), settings)
  assert.equal(await readFile(join(folder, 'mod', 'existing.mod'), 'utf8'), 'name="existing"')
  assert.match(await readFile(join(folder, 'mod', `${MOD_NAME}.mod`), 'utf8'), /path="mod\/cyberfish_observer_v1"/u)
  assert.deepEqual((await installObserverMod({ documentsPath: folder })).created, [])
})
test('preflight refuses modified same-name files without writing partial content', async t => {
  const folder = await fixture(t)
  await writeFile(join(folder, 'mod', `${MOD_NAME}.mod`), 'user custom mod')
  await assert.rejects(installObserverMod({ documentsPath: folder }), /未覆盖/u)
  assert.deepEqual(await readdir(join(folder, 'mod')), [`${MOD_NAME}.mod`])
})
test('dry run describes real UTF8 files without installing or enabling', async t => {
  const folder = await fixture(t), result = await installObserverMod({ documentsPath: folder, dryRun: true })
  assert.equal(result.dryRun, true); assert.equal(result.files.length, 4)
  assert.deepEqual(await readdir(join(folder, 'mod')), [])
  const script = await readFile(new URL('../mod/cyberfish_observer_v1/events/cfobs_events.txt', import.meta.url), 'utf8')
  assert.match(script, /trigger = \{ is_ai = no \}/u)
  assert.doesNotMatch(script, /\b(?:add_resource|add_building|research_technology|add_modifier|set_country_flag|replace_path)\s*=/u)
  for (const key of ['energy','minerals','food','consumer_goods','alloys','influence','unity']) {
    assert.match(script, new RegExp(`FISH_OBS\\|1\\|RESOURCE\\|${key}\\|`))
    assert.match(script, new RegExp(`clear_variable = cfobs_stock_${key}`))
  }
})
