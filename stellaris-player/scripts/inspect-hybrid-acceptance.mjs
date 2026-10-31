// Read-only prerequisites. Never starts, focuses, loads or changes the game.
import {NativePipe} from '../src/native-pipe.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const pipe=new NativePipe(),report={observedAt:new Date().toISOString(),readOnly:true};
try{
 report.bridge=await pipe.request('ping');
 report.status=await pipe.request('get_status');
 if(!report.status.in_game)throw Error('没有已载入的游戏');
 report.world=await pipe.request('get_galaxy_overview');
 report.events=await pipe.request('get_active_events');
 report.wars=await pipe.request('get_wars');
 report.market=await pipe.request('get_market');
 report.colonies=[];
 for(const sector of report.status.outliner?.sectors_summary?.sectors||[]){
  for(const colony of sector.colonies_summary||[]){
   const planetId=colony.planet_id;
   report.colonies.push({planetId,automation:await pipe.request('get_colony_automation',{planet_id:planetId}),upgrades:await pipe.request('get_building_upgrade_candidates',{planet_id:planetId})});
  }
 }
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{
 pipe.close();const directory=resolve('.local/hybrid-preflight-'+Date.now());await mkdir(directory,{recursive:true});await writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({report:resolve(directory,'report.json'),error:report.error,bridge:report.bridge?.bridge_version,date:report.status?.date,paused:report.status?.is_paused,events:report.events,wars:report.wars,colonyPrerequisites:report.colonies,monthlyOrders:report.market?.monthly_trades},null,2));
}
