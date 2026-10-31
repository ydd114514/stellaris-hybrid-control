import {NativePipe} from '../src/native-pipe.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {SURVEY_BRIDGE_VERSION} from '../src/bridge-capabilities.mjs';

const args=process.argv.slice(2),value=flag=>args[args.indexOf(flag)+1];
const fleetId=Number(value('--fleet')),execute=args.includes('--execute');
if(!args.includes('--fleet')||!Number.isSafeInteger(fleetId)||fleetId<0||fleetId>=0xffffffff)throw Error('需要明确科研船完整ID');
if(execute&&!args.includes('--expected-date'))throw Error('执行试验需要明确预期游戏日期');
const pipe=new NativePipe(),report={fleetId,execute,startedAt:new Date().toISOString(),reads:[]};
const directory=resolve('.local/hybrid-control');await mkdir(directory,{recursive:true});
const file=resolve(directory,`roundtrip-${Date.now()}.json`);
const save=()=>writeFile(file,JSON.stringify(report,null,2));
const read=async()=>{const s=await pipe.request('get_fleet_automation',{fleet_id:fleetId});report.reads.push(s);await save();return s;};
async function confirm(enabled){
 for(let i=0;i<8;i++){
  const s=await read();
  if(s.known===true&&s.order_chain_complete===true&&s.automation_enabled===enabled)return s;
  await delay(150);
 }
 throw Error('自动调查状态未在限次回读中确认');
}
try{
 report.ping=await pipe.request('ping');
 if(report.ping.bridge_version!==SURVEY_BRIDGE_VERSION)throw Error('候选桥版本不符');
 report.status=await pipe.request('get_status');
 if(!report.status.in_game||!report.status.is_paused)throw Error('试验要求已载入且暂停');
 if(execute&&report.status.date?.formatted!==value('--expected-date'))throw Error('游戏日期与指定试验不符');
 report.before=await read();
 if(!report.before.known||report.before.automation_enabled||report.before.orders?.length)throw Error('科研船不是已确认的空闲状态');
 report.preflight=await pipe.request('set_survey_automation',{fleet_id:fleetId,enabled:true,execute:false});
 if(!report.preflight.success)throw Error(report.preflight.error||'预检查拒绝');
 if(execute){
  report.enableAttempted=true;await save();
  report.enable=await pipe.request('set_survey_automation',{fleet_id:fleetId,enabled:true,execute:true});
  report.enabled=await confirm(true);
  report.revoke=await pipe.request('set_survey_automation',{fleet_id:fleetId,enabled:false,execute:true});
  report.disabled=await confirm(false);
 }
}catch(error){report.error=error.message;process.exitCode=1;}
finally{
 if(report.enableAttempted&&!report.disabled){
  try{report.emergencyPause=await pipe.request('set_paused',{paused:true});
   report.cleanupRevoke=await pipe.request('set_survey_automation',{fleet_id:fleetId,enabled:false,execute:true});
   report.disabled=await confirm(false);
  }catch(error){report.cleanupError=error.message;}
 }
 try{const status=await pipe.request('get_status');report.final={paused:status.is_paused,date:status.date?.formatted};}catch(error){report.finalError=error.message;}
 await save();pipe.close();console.log(JSON.stringify({file,...report}));
}
