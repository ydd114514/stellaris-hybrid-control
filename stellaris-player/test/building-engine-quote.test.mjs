import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {NativeGame} from '../src/native-game.mjs';
import {OperationalContext} from '../src/operational-context.mjs';
import {buildingInspectionScope,constructionInspectionScope,inspectConstruction,inspectBuildingQuote} from '../src/construction-inspection.mjs';

test('模型可调用真实己方特区定向CanBuild只读报价，保留拒绝原因且不伪造候选或授权施工',async()=>{
 const messages=await new Promise((done,fail)=>{
  const child=spawn(process.execPath,['src/native-mcp.mjs'],{cwd:process.cwd(),windowsHide:true,
   env:{...process.env,DEEPSEEK_API_KEY:'',CYBERFISH_NATIVE_COUNTRY_AI:'1'},stdio:['pipe','pipe','pipe']});let output='';
  const timer=setTimeout(()=>{child.kill();fail(Error('仅tools/list的离线进程超时'));},5000);
  child.stdout.setEncoding('utf8');child.stdout.on('data',s=>output+=s);child.stderr.resume();
  child.once('error',error=>{clearTimeout(timer);fail(error);});child.once('exit',code=>{clearTimeout(timer);code===0?done(output.trim().split('\n').map(JSON.parse)):fail(Error('仅tools/list进程失败'));});
  child.stdin.end(JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})+'\n');
 });
 const inspect=messages[0].result.tools.find(t=>t.name==='inspect');
 assert.equal(inspect.inputSchema.properties.building_key.pattern,'^building_[a-z0-9_]{1,100}$');
 assert.equal(inspect.inputSchema.properties.zone_id.minimum,0);assert.match(inspect.description,/定向只读核验/);
 const apply=messages[0].result.tools.find(t=>t.name==='apply_orders');
 for(const command of ['build_building','move_fleet','set_fleet_stance'])assert.equal(apply.inputSchema.properties.orders.items.properties.command.enum.includes(command),true);
 assert.equal(apply.inputSchema.properties.orders.items.properties.command.enum.includes('build_ship'),false);
 for(const request of [{topic:'planet',building_key:'building_hive_node',zone_id:0},{topic:'buildings',building_key:'wrong',zone_id:0},
  {topic:'buildings',building_key:'building_hive_node'},{topic:'buildings',zone_id:0},{topic:'buildings',building_key:'building_hive_node',zone_id:-1},
  {topic:'construction',sections:['jobs'],building_key:'building_hive_node',zone_id:0}])assert.throws(()=>buildingInspectionScope(request));
 const target=buildingInspectionScope({topic:'buildings',building_key:'building_hive_node',zone_id:0});
 const calls=[],planet={planet_id:0,colony_id:0,kpi:{pop_groups:100},construction_queue:[]};let allowed=true,foreign=false,badZone=false;
 const rpc=async(method,params)=>{
  assert.ok(method.startsWith('get_'));calls.push({method,params});
  if(method==='get_planet_details')return structuredClone(planet);
  if(method==='get_buildable_districts')return {success:true,planet_id:0,colony_id:0,current:[],buildable:[]};
  assert.equal(method,'get_buildable_buildings');
  if(!params.building_key)return {success:true,planet_id:0,colony_id:foreign?1:0,zones:[{zone_id:badZone?7:0,zone:'zone_default',district:'district_hive',buildings:3,max_buildings:6,buildable:[]}]};
  assert.deepEqual(params,{planet_id:0,building_key:'building_hive_node',zone_id:0});
  return {success:true,planet_id:0,building_key:'building_hive_node',zones:[{zone_id:0,zone:'zone_default',can_build:allowed,
   ...(allowed?{cost:{minerals:400},build_days:360}:{reason:'当前可用矿物不足400'})}]};
 };
 const game=Object.create(NativeGame.prototype);
 game.lastState={date:'2201.06.01',colonies:[{colonies_summary:[{planet_id:0}]}]};
 game.guard=async()=>({date:{formatted:'2201.06.01'},outliner:{sectors_summary:{sectors:game.lastState.colonies}}});
 game.rpc=rpc;game.operationalContext=new OperationalContext();game.log=async()=>{};
 const result=await game.inspect({topic:'buildings',id:0,building_key:'building_hive_node',zone_id:0});
 assert.equal(result.coverageKnown,true);assert.equal(result.can_build,true);assert.equal(result.quoteOnly,true);assert.equal(result.executionAuthorized,false);
 assert.deepEqual(result.quote,{costKnown:true,cost:{minerals:400},build_days:360});assert.equal(result.buildable,undefined);assert.equal(result.zones,undefined);
 assert.match(game.operationalContext.view()[0].facts,/当前引擎允许建造/);
 assert.deepEqual(calls.map(c=>c.method),['get_planet_details','get_buildable_buildings','get_buildable_buildings']);
 allowed=false;
 const blocked=await game.inspect({topic:'buildings',id:0,building_key:'building_hive_node',zone_id:0});
 assert.equal(blocked.can_build,false);assert.equal(blocked.reason,'当前可用矿物不足400');assert.equal(blocked.quote.costKnown,false);assert.equal(blocked.quote.cost,null);
 const scope=constructionInspectionScope({topic:'construction',sections:['buildings','districts'],building_key:'building_hive_node',zone_id:0});
 const bundled=await inspectConstruction({planetId:0,scope,rpc});
 assert.equal(bundled.sections.buildings.known,true);assert.equal(bundled.sections.buildings.data.can_build,false);assert.equal(bundled.sections.districts.known,true);
 const before=calls.length;await assert.rejects(game.inspect({topic:'buildings',id:1,building_key:'building_hive_node',zone_id:0}),/己方/);assert.equal(calls.length,before);
 for(const failure of ['foreign','badZone']){
  foreign=failure==='foreign';badZone=failure==='badZone';const start=calls.length;
  await assert.rejects(inspectBuildingQuote({planetId:0,buildingTarget:target,rpc}),/归属|zone_id/);
  assert.equal(calls.slice(start).some(c=>c.params.building_key),false);
 }
});
