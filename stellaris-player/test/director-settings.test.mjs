import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,readdir,unlink,rmdir} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {loadDirectorSettings,saveDirectorSettings,directorSummary} from '../src/director-settings.mjs';
test('missing config defaults to auto, invalid config stays fixed, mode saves atomically',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'cyberfish-director-')),path=join(dir,'director.json');
 try{
  assert.deepEqual(await loadDirectorSettings(path),{mode:'auto',configurationKnown:true});
  for(const raw of ['{','{"mode":"other"}','{"version":2,"mode":"auto"}']){
   await writeFile(path,raw);assert.deepEqual(await loadDirectorSettings(path),{mode:'fixed',configurationKnown:false});
  }
  await saveDirectorSettings(path,'fixed');assert.equal((await loadDirectorSettings(path)).mode,'fixed');
  await saveDirectorSettings(path,'auto');assert.equal((await loadDirectorSettings(path)).mode,'auto');
  const before=await readFile(path,'utf8');await assert.rejects(saveDirectorSettings(path,'unknown'));assert.equal(await readFile(path,'utf8'),before);
  assert.deepEqual(await readdir(dir),['director.json']);
 }finally{await unlink(path).catch(()=>{});await rmdir(dir);}
});
test('public status exposes deadlines and reason codes without raw logs or future timestamps',()=>{
 const raw={mode:'auto',topic:'exploration',lastGalaxyAt:1000,blocked:'presentation_failed',secret:'private'};
 const summary=directorSummary(raw,{now:61000,active:true});assert.equal(summary.galaxyRemainingSeconds,60);assert.equal(summary.topic,'科研船探索');assert.equal(summary.galaxyOverdue,false);assert.equal('secret' in summary,false);
 assert.equal(directorSummary(raw,{now:121000}).galaxyOverdue,true);
 assert.equal(directorSummary({...raw,lastGalaxyAt:999999,topic:'unknown',blocked:'raw error'},{now:61000}).blocked,'');
 assert.equal(directorSummary({...raw,lastGalaxyAt:999999},{now:61000}).galaxyOverdue,true);
});
