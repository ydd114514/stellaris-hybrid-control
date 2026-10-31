// User-authorized fixture: train test troops in the capital, normally embark,
// then shorten their deployment to the already selected rally. No combat/peace.
import {NativePipe} from '../src/native-pipe.mjs';
import {readFile,writeFile} from 'node:fs/promises';
const p=new NativePipe({timeoutMs:15000}),report={at:Date.now(),steps:[]};
const call=async(method,args={})=>{const result=await p.request(method,args);report.steps.push({method,args,result});return result;};
try{
 const status=await call('get_status');if(status.is_paused!==true)throw Error('只在暂停局准备');
 const saved=JSON.parse(await readFile('.local/native-bridge/latest-session.json','utf8')),c=saved.state.gestalt.campaign;
 if(c.phase!=='combat')throw Error('只可为现有战争补充测试运输军');
 const tactics=await call('get_fleet_tactics',{details:true});
 const reserves=tactics.fleets.filter(f=>f.total_ships>50&&f.system_id===c.execution.rallySystem);
 if(reserves.length!==1)throw Error('测试预备舰队范围不唯一');
 await call('run_console',{command:'effect every_owned_fleet = { limit = { is_ship_class = shipclass_military num_ships > 50 } solar_system = { save_global_event_target_as = cyberfish_test_rally } }'});
 const before=await call('get_war_fleets');
 let fresh=before.fleets.filter(f=>f.ship_class==='shipclass_transport'&&f.embarked_armies>=30&&f.fleet_id!==c.execution.transportId);
 if(fresh.length===0){
 await call('run_console',{command:'effect capital_scope = { while = { count = 30 create_army = { owner = root species = root type = assault_army } } }'});
 const world=await call('get_galaxy_overview'),capitalSystem=await call('get_system',{system_id:world.player.capital_system_id});
 const capitals=capitalSystem.planets.filter(x=>x.owner_id===world.player.country_id&&Number.isSafeInteger(x.colony_id));
 if(capitals.length!==1)throw Error('测试首都殖民地不唯一');
 const embarked=await call('embark_all_armies',{planet_id:capitals[0].id});if(embarked.success!==true)throw Error('正常登舰失败');
 await call('get_status');await call('get_status');
 const after=await call('get_war_fleets');fresh=after.fleets.filter(f=>f.ship_class==='shipclass_transport'&&f.embarked_armies>=30&&f.embarked_armies-(before.fleets.find(old=>old.fleet_id===f.fleet_id)?.embarked_armies||0)>=30);
 }
 if(fresh.length!==1)throw Error('新运输军尚未确认');
 await call('run_console',{command:'effect every_owned_fleet = { limit = { is_ship_class = shipclass_transport num_ships > 29 } set_location = event_target:cyberfish_test_rally }'});
 await call('get_status');const rally=await call('get_system',{system_id:c.execution.rallySystem});
 if(!rally.fleets.some(f=>f.id===fresh[0].fleet_id&&f.own))throw Error('测试运输军未抵达集结点');
 report.replacement={fleetId:reserves[0].fleet_id,transportId:fresh[0].fleet_id,finishDate:(Number(status.date.formatted.slice(0,4))+8)+'.01.01',reason:'主力与运输军受损，调入当前已确认可用的预备舰队；测试陆军已按用户授权补充，不改变敌国与战果'};
 await writeFile('.local/gestalt-live/current/replacement.json',JSON.stringify(report.replacement,null,2));
}catch(error){report.error=error.message;process.exitCode=1;}
finally{p.close();await writeFile('.local/gestalt-live/current/replacement-evidence-'+report.at+'.json',JSON.stringify(report,null,2));console.log(JSON.stringify({error:report.error,replacement:report.replacement}));}
