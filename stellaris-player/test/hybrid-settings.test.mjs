import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {loadHybridSettings,saveHybridSettings,saveNativeCountryAISettings} from '../src/hybrid-settings.mjs';
test('local entry defaults off and honors the same explicit config as MCP',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'fish-hybrid-settings-'));t.after(()=>rm(dir,{recursive:true,force:true}));const path=join(dir,'settings.json');
 assert.equal((await loadHybridSettings({path,environment:{}})).survey,false);
 await writeFile(path,JSON.stringify({version:1,survey:true}));
 assert.equal((await loadHybridSettings({path,environment:{}})).survey,true);
 assert.equal((await loadHybridSettings({path,environment:{CYBERFISH_HYBRID_SURVEY:'0'}})).survey,false);
 await writeFile(path,'{broken');await assert.rejects(loadHybridSettings({path,environment:{}}),/JSON/);
 await writeFile(path,JSON.stringify({version:1,survey:'true'}));await assert.rejects(loadHybridSettings({path,environment:{}}),/布尔/);
 await saveHybridSettings(true,{path});assert.equal((await loadHybridSettings({path,environment:{}})).survey,true);
 await saveHybridSettings(false,{path});assert.equal((await loadHybridSettings({path,environment:{}})).survey,false);
 await assert.rejects(saveHybridSettings('false',{path}),/布尔/);
});
test('native country mode persists separately and reaches explicit environment overrides',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'fish-native-settings-'));t.after(()=>rm(dir,{recursive:true,force:true}));const path=join(dir,'settings.json');
 await saveHybridSettings(true,{path});await saveNativeCountryAISettings(true,{path});
 let settings=await loadHybridSettings({path,environment:{}});assert.equal(settings.nativeCountryAI,true);assert.equal(settings.survey,true);
 assert.equal((await loadHybridSettings({path,environment:{CYBERFISH_NATIVE_COUNTRY_AI:'0'}})).nativeCountryAI,false);
 assert.equal((await loadHybridSettings({path,environment:{CYBERFISH_HYBRID_SURVEY:'0',CYBERFISH_NATIVE_COUNTRY_AI:'1'}})).nativeCountryAI,true);
 await saveNativeCountryAISettings(false,{path});assert.equal((await loadHybridSettings({path,environment:{}})).survey,true);
 await assert.rejects(saveNativeCountryAISettings('1',{path}),/布尔值/);
 await assert.rejects(loadHybridSettings({path,environment:{CYBERFISH_NATIVE_COUNTRY_AI:'yes'}}),/0或1/);
 await writeFile(path,JSON.stringify({version:1,survey:false,nativeCountryAI:'true'}));await assert.rejects(loadHybridSettings({path,environment:{}}),/布尔值/);
});

test('hourly request cap defaults to 60 and survives desktop mode overrides and saves',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'fish-model-settings-'));t.after(()=>rm(dir,{recursive:true,force:true}));const path=join(dir,'settings.json');
 const environment={CYBERFISH_HYBRID_SURVEY:'0',CYBERFISH_NATIVE_COUNTRY_AI:'1'};
 assert.equal((await loadHybridSettings({path,environment})).nativeModelRequestsPerHour,60);
 await writeFile(path,JSON.stringify({version:1,survey:true,nativeModelRequestsPerHour:12}));
 assert.equal((await loadHybridSettings({path,environment})).nativeModelRequestsPerHour,12);
 await saveHybridSettings(false,{path});
 await saveNativeCountryAISettings(true,{path});
 assert.equal((await loadHybridSettings({path,environment})).nativeModelRequestsPerHour,12);
 await writeFile(path,JSON.stringify({version:1,survey:true,nativeModelRequestsPerHour:0}));
 await assert.rejects(loadHybridSettings({path,environment}),/每小时模型请求上限/);
});
