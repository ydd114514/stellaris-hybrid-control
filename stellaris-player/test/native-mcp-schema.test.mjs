import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
test('the model-facing MCP schema advertises reviewed route, industry and job capabilities without opening the game',async()=>{
  const messages=await new Promise((done,fail)=>{
    const child=spawn(process.execPath,['src/native-mcp.mjs'],{cwd:process.cwd(),windowsHide:true,env:{...process.env,DEEPSEEK_API_KEY:'',CYBERFISH_HYBRID_SURVEY:'0',CYBERFISH_COLONY_UPGRADE_PILOT:'0',CYBERFISH_MONTHLY_LIFECYCLE_PILOT:'0',CYBERFISH_LOCAL_WAIT_PILOT:'0',CYBERFISH_SURVEY_PILOT:'0'},stdio:['pipe','pipe','pipe']});let output='';
    child.stdout.setEncoding('utf8');child.stdout.on('data',s=>output+=s);child.stderr.resume();
    child.on('error',fail);child.on('exit',code=>code===0?done(output.trim().split('\n').map(line=>JSON.parse(line))):fail(new Error('MCP schema process failed')));
    child.stdin.end(JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})+'\n');
  });
  const tools=messages[0].result.tools,inspect=tools.find(x=>x.name==='inspect'),apply=tools.find(x=>x.name==='apply_orders');
  for(const topic of ['route','zones','jobs'])assert.ok(inspect.inputSchema.properties.topic.enum.includes(topic));
  assert.equal(inspect.inputSchema.properties.district_type.type,'string');
  assert.equal(inspect.inputSchema.properties.resource.type,'string');
  assert.deepEqual(inspect.inputSchema.properties.action.enum,['buy','sell']);
  assert.equal(inspect.inputSchema.properties.units.maximum,5000);
  assert.equal(apply.inputSchema.properties.manualSurveyReason.maxLength,300);
  assert.equal(tools.find(x=>x.name==='tasks').inputSchema.properties.manualSurveyReason.maxLength,300);
  assert.equal(tools.some(x=>x.name==='colony_upgrade_control'),false);
  const colony=tools.find(x=>x.name==='colony_control');
  assert.deepEqual(colony.inputSchema.properties.operation.enum,['inspect','delegate','advance','pause','resume','reclaim']);
  assert.equal(colony.inputSchema.properties.policy.properties.maxBuilds.maximum,4);
  const monthly=tools.find(x=>x.name==='monthly_trade');
  assert.equal(monthly.annotations.readOnlyHint,false);
  assert.deepEqual(monthly.inputSchema.properties.operation.enum,['inspect','preview','execute','reconcile','recover']);
  assert.ok(monthly.inputSchema.properties.previousSessionId);
  assert.ok(monthly.inputSchema.properties.requestId);
  assert.ok(monthly.inputSchema.properties.snapshotId);
  const item=apply.inputSchema.properties.orders.items;
  const branch=name=>item.anyOf.find(x=>x.properties.command.const===name);
  const research=branch('select_research').properties.arguments;
  assert.deepEqual(research.properties.slot.enum,['physics','society','engineering']);
  assert.deepEqual(research.required,['slot','tech_key']);assert.equal(research.additionalProperties,false);
  assert.equal(research.properties.area,undefined);
  for(const [name,key]of [['adopt_tradition','tradition_key'],['adopt_ascension_perk','perk_key'],['set_council_agenda','agenda_key'],['launch_council_agenda','agenda_key']]){
    const args=branch(name).properties.arguments;assert.deepEqual(args.required,[key]);assert.equal(args.additionalProperties,false);assert.equal(args.properties[key].pattern,'^[a-zA-Z0-9_]{1,100}$');
  }
  assert.equal(apply.inputSchema.properties.requestId.pattern,'^[a-zA-Z0-9_-]{1,80}$');
  assert.equal(apply.inputSchema.properties.snapshotId.minLength,1);

  for(const command of ['set_district_zone','set_job_priority'])assert.ok(apply.inputSchema.properties.orders.items.properties.command.enum.includes(command));
});
