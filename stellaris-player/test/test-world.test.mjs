import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {selectedTestWorld,verifyContinueWorld} from '../src/test-world.mjs';

async function cleanTemporaryWorld(root) {
  assert.ok(root.startsWith(join(tmpdir(),'cyberfish-world-')),'只清理本测试创建的临时目录');
  await rm(root,{recursive:true,force:true});
}

test('explicit new world resumes only its own existing save, without changing the legacy default',async()=>{
  const root=await mkdtemp(join(tmpdir(),'cyberfish-world-'));
  try {
    const configPath=join(root,'active-world.json'),documents=join(root,'documents');
    assert.equal(await selectedTestWorld(configPath),'_929703252');
    await writeFile(configPath,JSON.stringify({directory:'_new_large'}));
    const world=join(documents,'save games','_new_large');await mkdir(world,{recursive:true});
    const save=join(world,'autosave_2200.01.01.sav');await writeFile(save,'offline test');
    await writeFile(join(documents,'continue_game.json'),JSON.stringify({title:'save games/_new_large/autosave_2200.01.01'}));
    assert.equal(await verifyContinueWorld({documents,configPath}),save);
    await writeFile(join(documents,'continue_game.json'),JSON.stringify({title:'save games/_929703252/autosave_2340.07.01'}));
    await assert.rejects(verifyContinueWorld({documents,configPath}),/其他存档/);
    await writeFile(join(documents,'continue_game.json'),JSON.stringify({title:'save games/_new_large/../../other'}));
    await assert.rejects(verifyContinueWorld({documents,configPath}),/路径无效/);
  }finally{await cleanTemporaryWorld(root);}
});

test('invalid or damaged explicit world configuration never silently chooses a different world',async()=>{
  const root=await mkdtemp(join(tmpdir(),'cyberfish-world-'));
  try {
    const configPath=join(root,'active-world.json');
    for(const directory of ['../old','..','C:\\other','nested/old','_new.','_new ']){
      await writeFile(configPath,JSON.stringify({directory}));
      await assert.rejects(selectedTestWorld(configPath),/配置无效/);
    }
    await writeFile(configPath,'{broken');await assert.rejects(selectedTestWorld(configPath));
  }finally{await cleanTemporaryWorld(root);}
});
