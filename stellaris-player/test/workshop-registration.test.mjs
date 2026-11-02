import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {registerDownloadedWorkshopMod,installStellarCompatibilityMod} from '../src/mod-install.mjs';

async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'fish-workshop-'));
 t.after(async()=>{assert.ok(resolve(root).startsWith(resolve(tmpdir())));await rm(root,{recursive:true,force:true})});
 const documents=join(root,'documents'),source=join(root,'source');await mkdir(documents);await mkdir(source);
 await writeFile(join(documents,'dlc_load.json'),'{"enabled_mods":["mod/existing.mod"]}');
 await writeFile(join(source,'descriptor.mod'),'name="Stellar AI experiment"\nsupported_version="v4.5.2"\nremote_file_id="3686836322"\n');
 return {documents,source};
}
test('download registration preserves official source and existing enabled list, with an idempotent external descriptor',async t=>{
 const {documents,source}=await fixture(t),options={documentsPath:documents,sourceDirectory:source,workshopId:'3686836322'};
 const dry=await registerDownloadedWorkshopMod({...options,dryRun:true});assert.equal(dry.created,false);assert.deepEqual(await readdir(documents),['dlc_load.json']);
 const registered=await registerDownloadedWorkshopMod(options);assert.equal(registered.enabledByInstaller,false);assert.equal(registered.created,true);
 assert.match(await readFile(registered.descriptorPath,'utf8'),/path=".*\/source"/);
 assert.equal(await readFile(join(documents,'dlc_load.json'),'utf8'),'{"enabled_mods":["mod/existing.mod"]}');
 assert.equal((await registerDownloadedWorkshopMod(options)).created,false);
 const steamSource=join(source,'..','steam-source');await mkdir(steamSource);await writeFile(join(steamSource,'descriptor.mod'),await readFile(join(source,'descriptor.mod')));
 await assert.rejects(registerDownloadedWorkshopMod({...options,sourceDirectory:steamSource}),/未覆盖/);
 assert.equal((await registerDownloadedWorkshopMod({...options,sourceDirectory:steamSource,previousSourceDirectory:source})).migrated,true);
 assert.match(await readFile(registered.descriptorPath,'utf8'),/path=".*\/steam-source"/);
});
test('wrong workshop IDs, obsolete versions and missing real compatibility sources cannot create a partial mod',async t=>{
 const {documents,source}=await fixture(t);
 await assert.rejects(registerDownloadedWorkshopMod({documentsPath:documents,sourceDirectory:source,workshopId:'2250100617'}),/编号不符/);
 await writeFile(join(source,'descriptor.mod'),'remote_file_id="3686836322"\nsupported_version="v4.4.*"');
 await assert.rejects(registerDownloadedWorkshopMod({documentsPath:documents,sourceDirectory:source,workshopId:'3686836322'}),/4.5兼容/);
 await assert.rejects(installStellarCompatibilityMod({documentsPath:documents}),/尚未取得/);
 assert.deepEqual(await readdir(documents),['dlc_load.json']);
});
