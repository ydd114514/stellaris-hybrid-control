import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {NativePipe} from '../src/native-pipe.mjs';
import {ensureNativeGame} from '../src/native-bootstrap.mjs';
import {assertBridgeCapabilities} from '../src/bridge-capabilities.mjs';
process.env.CYBERFISH_REQUIRE_RUNNING_GAME='1';
const directory=resolve('.local/gestalt-live/current');await mkdir(directory,{recursive:true});
await ensureNativeGame();
const pipe=new NativePipe({timeoutMs:12000}),report={at:Date.now(),kind:'read_only_preflight',observations:{}};
try{
 for(const [name,method,params]of [['ping','ping',{}],['status','get_status',{}],['government','get_government',{}],['world','get_galaxy_overview',{}],['contacts','get_contacts',{mode:'empires'}],['forces','get_war_fleets',{}],['wars','get_wars',{}]])report.observations[name]=await pipe.request(method,params);
 assertBridgeCapabilities(report.observations.ping);
 await writeFile(resolve(directory,'preflight.json'),JSON.stringify(report,null,2));
 const {status,government,world,contacts,forces,wars,ping}=report.observations;
 console.log(JSON.stringify({bridge:ping.bridge_version,date:status.date,paused:status.is_paused,government,player:world.player,knownEmpires:contacts.empires,forces,wars,report:resolve(directory,'preflight.json')},null,2));
}finally{pipe.close();}
