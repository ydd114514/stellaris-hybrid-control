// Explicitly user-authorized accelerated live-test fixture; never shipped or
// available as a model tool. Keeps the model's existing enemy and objectives.
import {NativePipe} from '../src/native-pipe.mjs';
import {mkdir,readdir,readFile,writeFile,rename} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const p=new NativePipe({timeoutMs:20000}),directory=resolve('.local/native-bridge'),report={at:Date.now(),authorization:'用户明确允许控制台准备首战功能测试条件',steps:[]};
const call=async(method,args={})=>{const r=await p.request(method,args);report.steps.push({method,args,result:r});return r;};
try{
 const status=await call('get_status');if(status.is_paused!==true)throw Error('只可在暂停局准备测试');
 const checkpoint=JSON.parse(await readFile(join(directory,'latest-session.json'),'utf8'));
 const campaign=checkpoint.state.gestalt.campaign;
 if(campaign.phase!=='muster'||campaign.warId!==undefined)throw Error('只用于已选目标、尚未宣战的集结测试');
 const tactics=await call('get_fleet_tactics',{details:true}),primary=tactics.fleets.find(f=>f.fleet_id===campaign.execution.fleetId);
 if(primary?.system_id!==campaign.execution.rallySystem)throw Error('原主力尚未在其自己选择的集结点');
 const console=async command=>{const r=await call('run_console',{command});if(r.ok!==true)throw Error(r.error||'控制台拒绝');};
 await call('cancel_fleet_orders',{fleet_ids:[primary.fleet_id]});
 // Capture the known main fleet's system through ordinary script scopes. In
 // this fixture it is the only non-MIA military fleet with at least ten ships.
 const eligible=tactics.fleets.filter(f=>f.total_ships>=10);
 if(eligible.length!==1||eligible[0].fleet_id!==primary.fleet_id)throw Error('测试范围不唯一，不能用宽泛舰队条件');
 await console('effect every_owned_fleet = { limit = { is_ship_class = shipclass_military num_ships > 9 } solar_system = { save_global_event_target_as = cyberfish_test_rally } while = { count = 20 create_ship = { name = random random_existing_design = corvette } } }');
 await console('effect capital_scope = { while = { count = 18 create_army = { owner = root species = root type = assault_army } } }');
 const before=await call('get_war_fleets');
 const home=await call('get_galaxy_overview');
 const capital=home.player.capital_planet_id??3;
 const embarked=await call('embark_all_armies',{planet_id:capital});if(embarked.success!==true)throw Error('正常登舰失败');
 // The posted embarkation must drain before identifying the actual new fleet.
 await call('get_status');await call('get_status');
 const after=await call('get_war_fleets');
 const fresh=after.fleets.filter(f=>f.ship_class==='shipclass_transport'&&f.embarked_armies>=18&&!before.fleets.some(old=>old.fleet_id===f.fleet_id));
 if(fresh.length!==1)throw Error('尚未确认新运输舰，不能猜ID');
 await console('effect every_owned_fleet = { limit = { is_ship_class = shipclass_transport num_ships > 17 } set_location = event_target:cyberfish_test_rally }');
 await call('cancel_fleet_orders',{fleet_ids:[fresh[0].fleet_id]});
 await call('get_status');
 const system=await call('get_system',{system_id:campaign.execution.rallySystem});
 if(!system.fleets.some(f=>f.id===fresh[0].fleet_id&&f.own))throw Error('测试运输舰未放到集结点，不修改战役');
 const files=await readdir(directory);let updated=false;
 for(const f of files.filter(f=>/^gestalt-[a-f0-9]+\.json$/.test(f))){
  const path=join(directory,f),d=JSON.parse(await readFile(path,'utf8'));
  if(d.campaign?.createdDate!==campaign.createdDate||d.campaign?.target!==campaign.target)continue;
  await writeFile(path+'.fixture-backup-'+report.at,JSON.stringify(d,null,2));
  d.campaign.execution.transportId=fresh[0].fleet_id;
  d.campaign.execution.finishDate='2210.01.01';d.campaign.reviewDate='2206.01.01';
  d.campaign.history.push({date:status.date.formatted,phase:'muster',reason:'用户授权功能测试补充己方兵力并替换失踪运输舰；未改敌国、战争目标或占领目标'});
  await writeFile(path+'.tmp',JSON.stringify(d,null,2));await rename(path+'.tmp',path);updated=true;
 }
 if(!updated)throw Error('没有匹配的持久战役');report.transportId=fresh[0].fleet_id;
}catch(error){report.error=error.message;process.exitCode=1;}
finally{p.close();await mkdir('.local/gestalt-live/current',{recursive:true});await writeFile('.local/gestalt-live/current/fixture-'+report.at+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify({at:report.at,error:report.error,transportId:report.transportId}));}
