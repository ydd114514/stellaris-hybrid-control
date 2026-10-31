// Read-only admission report for the currently loaded test world.
import {NativePipe} from '../src/native-pipe.mjs';
import {assertBridgeCapabilities} from '../src/bridge-capabilities.mjs';
import {delegationResourceRisks} from '../src/delegation-budget.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
const pipe=new NativePipe(),report={at:new Date().toISOString(),ships:[]};
try{
 report.ping=await pipe.request('ping');assertBridgeCapabilities(report.ping,{hybridSurvey:true});
 report.status=await pipe.request('get_status');
 if(!report.status.in_game||report.status.is_paused!==true)throw Error('请先载入独立测试档并暂停');
 report.resources=delegationResourceRisks(report.status);
 report.civilian=await pipe.request('get_civilian_fleets');
 report.events=await pipe.request('get_active_events');report.wars=await pipe.request('get_wars');
 for(const ship of report.civilian.science_ships||[]){
  report.ships.push({ship,automation:await pipe.request('get_fleet_automation',{fleet_id:ship.fleet_id}),targets:await pipe.request('find_systems',{purpose:'unsurveyed',fleet_id:ship.fleet_id,limit:5})});
 }
}catch(error){report.error=error.message;process.exitCode=1;}
finally{
 pipe.close();await mkdir('.local/hybrid-control',{recursive:true});
 const file=`.local/hybrid-control/admission-${Date.now()}.json`;await writeFile(file,JSON.stringify(report,null,2));
 console.log(JSON.stringify({file,error:report.error,date:report.status?.date?.formatted,paused:report.status?.is_paused,resources:report.resources,events:report.events,wars:report.wars,ships:report.ships}));
}
