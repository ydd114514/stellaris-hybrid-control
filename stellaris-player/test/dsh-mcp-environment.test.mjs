import test from 'node:test';import assert from 'node:assert/strict';import {isAbsolute,resolve} from 'node:path';
import {readFile,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {discoverNativeStrategyModel,nativeMcpEnvironmentPatch} from '../src/dsh-mcp-environment.mjs';
import {spawn} from 'node:child_process';
test('run metadata reaches the MCP explicitly and includes no model credential',()=>{
 const patch=nativeMcpEnvironmentPatch({directory:'fixture-only/native',runId:'run-one',minutes:10,hybridSurvey:true,presentOrders:false,startPaused:true,stopBaseline:12345});
 assert.equal(patch[0].id,'cyberfish-stellaris-mcp');const env=patch[0].config.env;
 assert.equal(patch[0].config.transport,'stdio');assert.equal(patch[0].config.serverName,'stellaris');assert.ok(patch[0].config.args[0].endsWith('native-mcp.mjs'));
 assert.ok(patch[0].config.command.endsWith('node.exe'));assert.equal(patch[0].config.toolCallTimeoutMs,120000);assert.equal(patch[0].config.failOnStartupError,true);
 assert.equal(env.CYBERFISH_NATIVE_DIRECTORY,resolve('fixture-only/native'));
 assert.equal(env.CYBERFISH_CONTROLLER_RUN,'run-one');assert.equal(env.CYBERFISH_HYBRID_SURVEY,'1');assert.equal(env.CYBERFISH_TEST_MINUTES,'10');
 assert.equal(env.CYBERFISH_START_PAUSED,'1');assert.equal(env.CYBERFISH_NATIVE_PRESENTATION,'0');assert.equal(env.DEEPSEEK_API_KEY,'');
 assert.equal(env.CYBERFISH_STOP_BASELINE,'12345');assert.equal(env.CYBERFISH_SURVEY_WATCH_SECONDS,'60');
});

test('the runtime patch registers one existing absolute game memory plugin in both modes',async()=>{
 const basePatch=await readFile(new URL('../plugins/stellaris-dsh/cordis.patch.yml',import.meta.url),'utf8');
 assert.doesNotMatch(basePatch,/cyberfish-game-memory/);
 assert.match(basePatch,/- id: compaction-basic\s+disabled: true/);
 const options={directory:'some-other-directory/dsh',runId:'memory-path',minutes:5,hybridSurvey:false};
 for(const nativeCountryAI of [false,true]){
  const rows=nativeMcpEnvironmentPatch({...options,nativeCountryAI})
   .flatMap(row=>row.insert??[]).filter(row=>row.id==='cyberfish-game-memory');
  assert.equal(rows.length,1);
  const path=rows[0].name;
  assert.ok(isAbsolute(path));
  assert.equal(path,fileURLToPath(new URL('../plugins/stellaris-dsh/game-compaction.mjs',import.meta.url)));
  assert.ok((await stat(path)).isFile());
 }
});

test('feature delivery is explicit even with the SDK environment allowlist and survey comparison suppresses it',()=>{
 const base={directory:'fixture',runId:'r',minutes:5,hybridSurvey:false,colonyUpgradePilot:true,monthlyLifecyclePilot:true,localWaitPilot:true};
 const env=nativeMcpEnvironmentPatch(base)[0].config.env;
 for(const name of ['CYBERFISH_COLONY_UPGRADE_PILOT','CYBERFISH_MONTHLY_LIFECYCLE_PILOT','CYBERFISH_LOCAL_WAIT_PILOT']){
  assert.equal(env[name],'1');assert.equal(nativeMcpEnvironmentPatch({...base,surveyPilot:true})[0].config.env[name],'0');
 }
 for(const option of ['colonyUpgradePilot','monthlyLifecyclePilot','localWaitPilot'])assert.throws(()=>nativeMcpEnvironmentPatch({...base,[option]:'1'}),/布尔值/);
});

test('a real offline MCP child launched with only the final patch exposes delivered features',async()=>{
 const config=nativeMcpEnvironmentPatch({directory:'fixture-only/native',runId:'run-feature-pipeline',minutes:5,hybridSurvey:false,colonyUpgradePilot:true,monthlyLifecyclePilot:true,localWaitPilot:true})[0].config;
 // Deliberately do not inherit CYBERFISH_* from process.env: the final patch
 // must be sufficient under the SDK's restricted environment inheritance.
 const env={SystemRoot:process.env.SystemRoot,PATH:process.env.PATH,...config.env};
 const child=spawn(process.execPath,config.args,{cwd:config.cwd,env,windowsHide:true,stdio:['pipe','pipe','pipe']});let output='';
 child.stdout.setEncoding('utf8');child.stderr.resume();const exit=new Promise(done=>child.once('exit',done));
 try{
  const response=new Promise((done,fail)=>{
   const timer=setTimeout(()=>{child.kill();fail(Error('offline MCP tools/list timed out'));},5000);
   child.once('error',e=>{clearTimeout(timer);fail(e);});
   child.stdout.on('data',chunk=>{output+=chunk;if(output.includes('\n')){clearTimeout(timer);try{done(JSON.parse(output.split('\n')[0]));}catch(e){fail(e);}}});
  });
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})+'\n');
  const list=(await response).result.tools;
  assert.ok(list.some(t=>t.name==='colony_upgrade_control'));assert.ok(list.find(t=>t.name==='monthly_trade').inputSchema.properties.policy);
  assert.equal(list.find(t=>t.name==='watch').inputSchema.properties.seconds.maximum,60);
 }finally{child.stdin.end();await exit;}
});
test('invalid run identities and durations are refused before launching DSH',()=>{
 for(const runId of ['', '../other','x\nq'])assert.throws(()=>nativeMcpEnvironmentPatch({directory:'fixture',runId,minutes:10,hybridSurvey:true}));
 assert.throws(()=>nativeMcpEnvironmentPatch({directory:'fixture',runId:'r',minutes:61,hybridSurvey:true}));
 assert.equal(nativeMcpEnvironmentPatch({directory:'fixture',runId:'r',minutes:5,hybridSurvey:false})[0].config.env.CYBERFISH_HYBRID_SURVEY,'0');
});

test('experimental watch ceiling reaches MCP explicitly while transport timeout remains bounded',()=>{
 const options={directory:'fixture',runId:'r',minutes:10,hybridSurvey:true};const config=nativeMcpEnvironmentPatch({...options,surveyWatchSeconds:90})[0].config;
 assert.equal(config.env.CYBERFISH_SURVEY_WATCH_SECONDS,'90');assert.equal(config.toolCallTimeoutMs,120000);
 for(const surveyWatchSeconds of [0,20,61,120,NaN,'90'])assert.throws(()=>nativeMcpEnvironmentPatch({...options,surveyWatchSeconds}));
});

test('bounded game speed is delivered explicitly and invalid ceilings are rejected offline',()=>{
 const base={directory:'fixture',runId:'r',minutes:5,hybridSurvey:false};assert.equal(nativeMcpEnvironmentPatch({...base,maximumGameSpeed:2})[0].config.env.CYBERFISH_MAX_GAME_SPEED,'2');
 for(const maximumGameSpeed of [0,6,NaN,'2'])assert.throws(()=>nativeMcpEnvironmentPatch({...base,maximumGameSpeed}),/速度上限/);
});

test('native strategy uses the strongest compatible model in the account listing',async()=>{
 const model=await discoverNativeStrategyModel({apiKey:'fixture',fetcher:async(url,options)=>{
  assert.equal(url,'https://api.deepseek.com/models');
  assert.equal(options.method,'GET');
  assert.equal(options.headers.Authorization,'Bearer fixture');
  assert.equal(options.redirect,'error');
  assert.ok(options.signal instanceof AbortSignal);
  return {ok:true,json:async()=>({data:[
   {id:'deepseek-flash'},{id:'deepseek-reasoner'},{id:'deepseek-v4-pro'},{id:'deepseek-v5-pro'},
   {id:'deepseek-v6-pro',max_output_tokens:8192},
   {id:'deepseek-v7-pro',api_capabilities:{chat_completions:{}}},
  ]})};
 }});
 assert.equal(model,'deepseek-v5-pro');
 const options={directory:'fixture',runId:'r',minutes:5,hybridSurvey:false,strategyModel:model};
 const patch=nativeMcpEnvironmentPatch({...options,nativeCountryAI:true});
 assert.deepEqual(patch.find(x=>x.id==='agent-default-model').config,{provider:'deepseek-official',model,reasoningEffort:'high'});
 assert.deepEqual(patch.find(x=>x.id==='llm-deepseek').config,{thinking:'enabled',maxTokens:32768});
 assert.deepEqual(nativeMcpEnvironmentPatch(options).flatMap(x=>x.id?[x.id]:[]),['cyberfish-stellaris-mcp']);
});

test('missing reasoning models and custom API routes fall back without a generation probe',async()=>{
 let discoveries=0;
 const fetcher=async()=>{discoveries++;throw Error('unavailable');};
 assert.equal(await discoverNativeStrategyModel({apiKey:'fixture',baseURL:'http://127.0.0.1:1033',fetcher}),undefined);
 const strategyModel=await discoverNativeStrategyModel({apiKey:'fixture',fetcher});
 assert.equal(discoveries,1);
 const patch=nativeMcpEnvironmentPatch({directory:'fixture',runId:'r',minutes:5,hybridSurvey:false,nativeCountryAI:true,strategyModel});
 assert.equal(patch.find(x=>x.id==='agent-default-model').config.model,'deepseek-flash');
 assert.match(patch.find(x=>x.id==='system-prompt').config.personaPrefix,/使用快速模型/);
});

test('native country mode explicitly suppresses competing local actors across a restricted MCP transport',async()=>{
 const config=nativeMcpEnvironmentPatch({directory:'fixture-only/native',runId:'native-country',minutes:5,hybridSurvey:true,nativeCountryAI:true,
  surveyPilot:true,colonyUpgradePilot:true,monthlyLifecyclePilot:true,localWaitPilot:true})[0].config;
 assert.equal(config.toolCallTimeoutMs,930000);
 const env=config.env;
 const system=nativeMcpEnvironmentPatch({directory:'fixture',runId:'native-system',minutes:5,hybridSurvey:false,nativeCountryAI:true}).find(x=>x.id==='system-prompt');
 assert.match(system.config.personaPrefix,/v1\.5/);assert.match(system.config.personaPrefix,/strategy_contract/);
 assert.match(system.config.personaPrefix,/strategyBrief/);
 assert.equal(system.config.personaPrefix.includes('只有 current.is_researching=false'),false);
 assert.equal(env.CYBERFISH_NATIVE_COUNTRY_AI,'1');assert.equal(env.CYBERFISH_START_PAUSED,'1');
 for(const k of ['CYBERFISH_HYBRID_SURVEY','CYBERFISH_SURVEY_PILOT','CYBERFISH_COLONY_UPGRADE_PILOT','CYBERFISH_MONTHLY_LIFECYCLE_PILOT','CYBERFISH_LOCAL_WAIT_PILOT'])assert.equal(env[k],'0',k);
 const messages=await new Promise((done,fail)=>{
  const child=spawn(process.execPath,config.args,{cwd:config.cwd,windowsHide:true,env:{...env,SystemRoot:process.env.SystemRoot,PATH:process.env.PATH},stdio:['pipe','pipe','pipe']});
  let output='',errors='';child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>errors+=v);
  child.on('error',fail);child.on('exit',code=>code===0?done(output.trim().split('\n').map(JSON.parse)):fail(Error(errors)));
  child.stdin.end(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize'})+'\n'+JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list'})+'\n');
 });
 assert.match(messages.find(x=>x.id===1).result.instructions,/原生国家 ?AI/);
 const tools=messages.find(x=>x.id===2).result.tools;
 assert.equal(tools.find(x=>x.name==='watch').inputSchema.properties.seconds.maximum,900);
 assert.equal(tools.find(x=>x.name==='apply_orders').inputSchema.properties.strategicResearchOverride,undefined);
 assert.ok(tools.some(x=>x.name==='strategy_contract'));
 assert.equal(tools.some(x=>x.name==='colony_upgrade_control'),false);
 assert.throws(()=>nativeMcpEnvironmentPatch({directory:'fixture',runId:'r',minutes:5,hybridSurvey:false,nativeCountryAI:'1'}),/布尔值/);
});

test('normal native DSH patches the configured model provider to the budget relay',()=>{
 const options={directory:'fixture',runId:'budget-patch',minutes:5,hybridSurvey:false,modelRelayBaseURL:'http://127.0.0.1:1234/fixture'};
 const patch=nativeMcpEnvironmentPatch({...options,nativeCountryAI:true});
 assert.deepEqual(patch.find(x=>x.id==='llm-deepseek').config,{
  thinking:'enabled',maxTokens:32768,baseURL:options.modelRelayBaseURL
 });
 assert.ok(!nativeMcpEnvironmentPatch(options).some(x=>x.id==='llm-deepseek'));
});
