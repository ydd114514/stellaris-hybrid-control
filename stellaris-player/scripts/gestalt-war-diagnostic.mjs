import {NativePipe} from '../src/native-pipe.mjs';
import {writeFile} from 'node:fs/promises';
const p=new NativePipe({timeoutMs:12000}),report={at:Date.now()};
try{
 const target=Number(process.argv[2]||41),planet=Number(process.argv[3]||198);
 for(const [key,method,args]of [['status','get_status',{}],['wars','get_wars',{}],['events','get_active_events',{}],['forces','get_war_fleets',{}],['tactics','get_fleet_tactics',{details:true}],['target','get_system',{system_id:target}],['invasion','get_invasion_state',{planet_id:planet}],['route','find_path',{fleet_id:3,to_system_id:target}],['pending','get_pending_diplomacy',{}]])report[key]=await p.request(method,args);
 await writeFile('.local/gestalt-live/current/war-diagnostic.json',JSON.stringify(report,null,2));
 console.log(JSON.stringify({date:report.status.date,paused:report.status.is_paused,events:report.events,wars:report.wars,tactics:report.tactics,forces:report.forces,route:report.route,pending:report.pending,target:report.target},null,2));
}finally{p.close();}
