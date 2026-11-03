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


const steeringPath = '../mod/cyberfish_steering_v1/common/'
const personalityPath = 'personalities/cfsteer_personality.txt'
const budgetPath = 'ai_budget/cfsteer_budget.txt'
const budgetSource = () => readFile(new URL(steeringPath + budgetPath, import.meta.url), 'utf8')

test('aggressive expansion raises the appropriate 4.5.2 spending weights', async () => {
  await assert.rejects(readFile(new URL(steeringPath + personalityPath, import.meta.url)), { code: 'ENOENT' })
  const budget = await budgetSource()
  function expansionWeight(key, resource, category, balancedWeight, eligibility) {
    const entry = budget.split('cfsteer_budget_expand_' + key + ' = {')[1]?.split(/\r?\n}/)[0]
    assert.ok(entry, key)
    assert.ok(entry.split(/\r?\n/).includes(' resource = ' + resource))
    assert.ok(entry.split(/\r?\n/).includes(' category = ' + category))
    assert.match(entry, /has_edict = cfsteer_expansion_aggressive/)
    assert.match(entry, eligibility)
    assert.ok(Number(entry.match(/weight = \{ weight = ([0-9.]+)/)[1]) > balancedWeight)
  }
  expansionWeight('stations', 'alloys', 'starbases', 0.4 + 0.2, /has_ai_expansion_plan = yes[\s\S]+NOT = \{ ai_colonize_plans > 0 \}/)
  expansionWeight('colonies', 'alloys', 'colonies', 0.8, /ai_colonize_plans > 0/)
  expansionWeight('influence', 'influence', 'stations', 0.5, /has_ai_expansion_plan = yes/)
})

test('steering update retires the shipped personality and preserves edited files', async t => {
  const folder = await fixture(t)
  const target = join(folder, 'mod', 'cyberfish_steering_v1', 'common')
  const path = join(target, personalityPath)
  await installSteeringMod({ documentsPath: folder })
  await mkdir(join(target, 'personalities'))
  const old = [
    'cfsteer_reserved_diplomacy = {',
    ' aggressiveness = 0',
    ' bravery = 1',
    ' trade_willingness = 1',
    ' military_spending = 1',
    ' colony_spending = 1',
    ' weapon_preferences = weapon_type_energy',
    ' armor_ratio = 0.4',
    ' shields_ratio = 0.4',
    ' hull_ratio = 0.2',
    ' allow = { OR = { has_edict = cfsteer_economy_balanced has_edict = cfsteer_economy_consumer_stability has_edict = cfsteer_economy_alloys_military has_edict = cfsteer_economy_research } }',
    ' weight_modifier = { weight = 100000 }',
    ' behaviour = { conqueror = yes opportunist = no crisis_fighter = yes }',
    '}',
    '',
  ].join('\r\n')
  await writeFile(path, old)
  await installSteeringMod({ documentsPath: folder, dryRun: true })
  assert.equal(await readFile(path, 'utf8'), old)
  assert.deepEqual((await installSteeringMod({ documentsPath: folder })).removed, [path])
  await assert.rejects(readFile(path), { code: 'ENOENT' })
  await writeFile(path, old + '# customized')
  await assert.rejects(installSteeringMod({ documentsPath: folder }), /已被修改/)
  assert.equal(await readFile(path, 'utf8'), old + '# customized')
})
