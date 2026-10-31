import test from 'node:test';import assert from 'node:assert/strict';import {resolve} from 'node:path';
import {nativeMcpEnvironmentPatch} from '../src/dsh-mcp-environment.mjs';
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

test('native country mode explicitly suppresses competing local actors across a restricted MCP transport',async()=>{
 const config=nativeMcpEnvironmentPatch({directory:'fixture-only/native',runId:'native-country',minutes:5,hybridSurvey:true,nativeCountryAI:true,
  surveyPilot:true,colonyUpgradePilot:true,monthlyLifecyclePilot:true,localWaitPilot:true})[0].config;
 const env=config.env;
 const system=nativeMcpEnvironmentPatch({directory:'fixture',runId:'native-system',minutes:5,hybridSurvey:false,nativeCountryAI:true}).find(x=>x.id==='system-prompt');
 assert.match(system.config.personaPrefix,/v1.4/);assert.match(system.config.personaPrefix,/strategicResearchOverride=true/);
 assert.equal(system.config.personaPrefix.includes('只有 current.is_researching=false'),false);
 assert.equal(env.CYBERFISH_NATIVE_COUNTRY_AI,'1');assert.equal(env.CYBERFISH_START_PAUSED,'1');
 for(const k of ['CYBERFISH_HYBRID_SURVEY','CYBERFISH_SURVEY_PILOT','CYBERFISH_COLONY_UPGRADE_PILOT','CYBERFISH_MONTHLY_LIFECYCLE_PILOT','CYBERFISH_LOCAL_WAIT_PILOT'])assert.equal(env[k],'0',k);
 const messages=await new Promise((done,fail)=>{
  const child=spawn(process.execPath,config.args,{cwd:config.cwd,windowsHide:true,env:{...env,SystemRoot:process.env.SystemRoot,PATH:process.env.PATH},stdio:['pipe','pipe','pipe']});
  let output='',errors='';child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>errors+=v);
  child.on('error',fail);child.on('exit',code=>code===0?done(output.trim().split('\n').map(JSON.parse)):fail(Error(errors)));
  child.stdin.end(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize'})+'\n'+JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list'})+'\n');
 });
 assert.match(messages.find(x=>x.id===1).result.instructions,/原生国家 AI/);
 const tools=messages.find(x=>x.id===2).result.tools;
 assert.equal(tools.find(x=>x.name==='watch').inputSchema.properties.seconds.maximum,90);
 assert.equal(tools.find(x=>x.name==='apply_orders').inputSchema.properties.strategicResearchOverride.type,'boolean');
 assert.equal(tools.some(x=>x.name==='colony_upgrade_control'),false);
 assert.throws(()=>nativeMcpEnvironmentPatch({directory:'fixture',runId:'r',minutes:5,hybridSurvey:false,nativeCountryAI:'1'}),/布尔值/);
});
