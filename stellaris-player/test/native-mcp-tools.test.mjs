import test from 'node:test';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';
async function tools(mode,{upgrade=false,monthly=false,local=false}={}){
 const env={...process.env,CYBERFISH_HYBRID_SURVEY:mode,CYBERFISH_COLONY_UPGRADE_PILOT:upgrade?'1':'0',CYBERFISH_MONTHLY_LIFECYCLE_PILOT:monthly?'1':'0',CYBERFISH_LOCAL_WAIT_PILOT:local?'1':'0',CYBERFISH_SURVEY_PILOT:'0'};delete env.DEEPSEEK_API_KEY;
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
 try{return await response;}finally{child.stdin.end();await exit;}
}
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
