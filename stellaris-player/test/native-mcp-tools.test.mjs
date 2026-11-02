import test from 'node:test';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,dirname,resolve} from 'node:path';
async function tools(mode,{upgrade=false,monthly=false,local=false,native=false}={}){
 const directory=await mkdtemp(join(tmpdir(),'cyberfish-tools-'));
 const env={...process.env,CYBERFISH_NATIVE_DIRECTORY:directory,CYBERFISH_NATIVE_COUNTRY_AI:native?'1':'0',CYBERFISH_HYBRID_SURVEY:mode,CYBERFISH_COLONY_UPGRADE_PILOT:upgrade?'1':'0',CYBERFISH_MONTHLY_LIFECYCLE_PILOT:monthly?'1':'0',CYBERFISH_LOCAL_WAIT_PILOT:local?'1':'0',CYBERFISH_SURVEY_PILOT:'0'};delete env.DEEPSEEK_API_KEY;
 const child=spawn(process.execPath,[fileURLToPath(new URL('../src/native-mcp.mjs',import.meta.url))],{env,windowsHide:true,stdio:['pipe','pipe','pipe']});
 let out='';child.stdout.setEncoding('utf8');child.stderr.resume();
 const response=new Promise((done,fail)=>{
  const timer=setTimeout(()=>{child.kill();fail(Error('MCP tools/list timed out'));},5000);
  child.once('error',e=>{clearTimeout(timer);fail(e);});
  child.once('exit',code=>{if(!out.includes('\n')){clearTimeout(timer);fail(Error(`MCP exited ${code}`));}});
  child.stdout.on('data',data=>{out+=data;if(out.length>1024*1024){clearTimeout(timer);child.kill();fail(Error('Oversized tool list'));}else if(out.includes('\n')){clearTimeout(timer);try{done(JSON.parse(out.split('\n')[0]).result.tools);}catch(e){fail(e);}}});
 });
 const exit=new Promise(done=>child.once('exit',done));
 child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})+'\n');
 try{return await response;}finally{child.stdin.end();await exit;if(dirname(directory)!==resolve(tmpdir()))throw Error('测试清理目录不正确');await rm(directory,{recursive:true,force:true});}
}
test('原生模式提供已接管后的中央事件和战争目标决策，日常经营仍不交给模型',async()=>{
 const list=await tools('0',{native:true}),apply=list.find(t=>t.name==='apply_orders'),commands=apply.inputSchema.properties.orders.items.properties.command.enum;
 for(const command of ['resolve_event','open_war_goals','set_defender_war_goal','close_war_goals'])assert.ok(commands.includes(command));
 for(const command of ['build_ship','build_district','select_research'])assert.equal(commands.includes(command),false);
 for(const command of ['move_fleet','set_fleet_stance','build_building'])assert.equal(commands.includes(command),true);
 assert.match(apply.description,/先实际接管并确认暂停/);
});
test('普通和原生模式均可核查法令，原生只在有界战略设置入口开放普通法令调整',async()=>{
 for(const native of [false,true]){
  const list=await tools('0',{native}),inspect=list.find(t=>t.name==='inspect');
  assert.ok(inspect.inputSchema.properties.topic.enum.includes('edicts'));assert.match(inspect.description,/法令清单/);
  if(native){
   assert.equal(list.find(t=>t.name==='apply_orders').inputSchema.properties.orders.items.properties.command.enum.includes('toggle_edict'),false);
   const strategy=list.find(t=>t.name==='strategy_contract'),domestic=strategy.inputSchema.properties.contract.properties.domesticActions;
   const branches=domestic.items.oneOf,edict=branches.find(row=>row.properties.type.const==='toggle_edict');
   assert.equal(domestic.maxItems,4);assert.ok(edict);
   assert.ok(edict.properties.arguments.properties.edict_key.enum.includes('nutritional_plenitude'));
   assert.ok(branches.some(row=>row.properties.type.const==='set_council_agenda'));assert.ok(branches.some(row=>row.properties.type.const==='launch_council_agenda'));
   assert.match(strategy.description,/enabled:false/);assert.match(strategy.description,/can_activate=true/);
  }
 }
});
test('disabled MCP retains recovery tools while new delegation stays outside its schema',async()=>{
 const list=await tools('0'),survey=list.find(t=>t.name==='survey_control');
 assert.ok(survey);assert.deepEqual(survey.inputSchema.properties.operation.enum,['inspect','reclaim','reconcile','recover']);
 assert.ok(list.some(t=>t.name==='apply_orders'));
 const monthly=list.find(t=>t.name==='monthly_trade');assert.deepEqual(monthly.inputSchema.properties.operation.enum,['inspect','preview','execute','reconcile','recover']);assert.equal(monthly.annotations.readOnlyHint,false);const branches=monthly.inputSchema.properties.change.anyOf;assert.deepEqual(branches.find(x=>x.properties.operation.const==='cancel').required,['orderId']);assert.ok(branches.find(x=>x.properties.operation.const==='set').required.includes('priceLimit'));

 assert.equal(list.find(t=>t.name==='watch').inputSchema.properties.seconds.maximum,20);
});
test('enabled MCP advertises the same recovery operations plus scoped delegation',async()=>{
 const list=await tools('1'),survey=list.find(t=>t.name==='survey_control');
 assert.ok(survey.inputSchema.properties.operation.enum.includes('delegate'));
 assert.equal(list.find(t=>t.name==='watch').inputSchema.properties.seconds.maximum,60);
});

test('delivered desktop feature flags expose bounded upgrades, monthly conditions and local queue waiting',async()=>{
 const list=await tools('0',{upgrade:true,monthly:true,local:true});
 const upgrade=list.find(t=>t.name==='colony_upgrade_control');assert.ok(upgrade);assert.ok(upgrade.inputSchema.properties.operation.enum.includes('delegate'));
 assert.ok(list.find(t=>t.name==='monthly_trade').inputSchema.properties.policy);
 assert.equal(list.find(t=>t.name==='watch').inputSchema.properties.seconds.maximum,60);
});

test('MCP exposes bounded construction sections and current upgrade availability without old pending-only wording',async()=>{
 const list=await tools('1',{upgrade:true}),inspect=list.find(t=>t.name==='inspect');assert.ok(inspect.inputSchema.properties.topic.enum.includes('construction'));assert.equal(inspect.inputSchema.properties.sections.maxItems,3);assert.equal(inspect.inputSchema.properties.sections.uniqueItems,true);assert.ok(inspect.description.includes('construction'));assert.equal(list.find(t=>t.name==='colony_upgrade_control').description.includes('待统一验收'),false);
});
