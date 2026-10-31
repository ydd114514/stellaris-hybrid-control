import {NativeGame} from '../src/native-game.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
const args=process.argv.slice(2),value=k=>args.includes(k)?args[args.indexOf(k)+1]:undefined;
const fleetId=Number(value('--fleet')),minutes=Number(value('--minutes')||12),expectedDate=value('--expected-date');
if(!args.includes('--execute')||!args.includes('--fleet')||!args.includes('--expected-date')||!Number.isSafeInteger(fleetId)||fleetId<0||fleetId>=0xffffffff||!Number.isFinite(minutes)||minutes<1||minutes>15)throw Error('需要execute、fleet、expected-date及1..15分钟');
const directory=resolve(`.local/hybrid-control/productive-${Date.now()}`);
await mkdir(directory,{recursive:true});
const game=new NativeGame({directory,minutes:Math.min(60,minutes+2),hybridSurvey:true});
const report={directory,fleetId,minutes,startedAt:new Date().toISOString(),samples:[],systemsBefore:{},systemsAfter:{}};
const file=resolve(directory,'result.json'),save=()=>writeFile(file,JSON.stringify(report,null,2));
let stopRequested=false;
process.on('SIGINT',()=>{stopRequested=true;});process.on('SIGTERM',()=>{stopRequested=true;});
try{
 const state=await game.start({keepPaused:true});report.before=state;
 if(state.date!==expectedDate||!state.paused)throw Error('测试局日期或暂停状态不符');
 if(state.pendingEvents.length||state.warGoalsWindow)throw Error('关键事件尚未处理，试点不推进');
 const targets=await game.rpc('find_systems',{purpose:'unsurveyed',fleet_id:fleetId,limit:50});
 report.targets=targets;
 for(const target of targets.systems||[])report.systemsBefore[target.id]=await game.rpc('get_system',{system_id:target.id});
 report.delegation=await game.surveyControl({operation:'delegate',fleetId,snapshotId:game.snapshotId});
 if(report.delegation.control.owner!=='native')throw Error('尚未确认原生控制权');
 report.speedBefore=state.speed;
 // Fastest normal game speed; no instant actions, edited resources or console.
 report.speedChange=await game.rpc('set_speed',{speed:4});
 const unpause=await game.rpc('set_paused',{paused:false});if(!unpause.success)throw Error('无法开始试点');
 const runStarted=Date.now(),until=runStarted+minutes*60000;let nextSample=0,workObserved=false;
 while(Date.now()<until&&!stopRequested){
  const status=await game.guard();
  if(status.is_paused){report.interrupted='game_paused';break;}
  await game.monitorDecision(0);
  if(game.decisionPause){report.interrupted=game.decisionPause;break;}
  if(Date.now()>=nextSample){
   const current=await game.observe(),automation=await game.surveyControl({operation:'inspect',fleetId});
   const sample={at:new Date().toISOString(),date:current.date,paused:current.paused,automation,civilian:current.civilian,research:current.research,resources:current.resources,colonies:current.colonies};
   report.samples.push(sample);await save();
   if(automation.orders?.some(o=>o.automation===false))workObserved=true;
   console.log(JSON.stringify({sample:report.samples.length,date:current.date,automation:automation.orders,ship:current.civilian.science_ships.find(r=>r.fleet_id===fleetId)}));
   if(current.paused){report.interrupted='event_or_manual_pause';break;}
   nextSample=Date.now()+10000;
  }
  if(!workObserved&&Date.now()-runStarted>40000){report.interrupted='no_native_child_task_within_40_seconds';break;}
  await delay(1000);
 }
 report.stopRequested=stopRequested;
}catch(error){report.error=error.message;process.exitCode=1;}
finally{
 try{await game.rpc('set_paused',{paused:true});if(Number.isInteger(report.speedBefore))report.speedRestored=await game.rpc('set_speed',{speed:report.speedBefore});}catch(error){report.speedRestoreError=error.message;}
 await game.stop();report.cleanup=game.cleanup;
 // stop() closes the connection, so final readback starts a new read session.
 try{
  report.finalStatus=await game.rpc('get_status');report.finalAutomation=await game.rpc('get_fleet_automation',{fleet_id:fleetId});
  for(const id of Object.keys(report.systemsBefore))report.systemsAfter[id]=await game.rpc('get_system',{system_id:Number(id)});
  report.completedSystems=Object.keys(report.systemsBefore).filter(id=>report.systemsBefore[id].surveyed===false&&report.systemsAfter[id]?.surveyed===true);
 }catch(error){report.finalError=error.message;}
 game.pipe.close();report.finishedAt=new Date().toISOString();await save();
 console.log(JSON.stringify({file,completedSystems:report.completedSystems,error:report.error,interrupted:report.interrupted,paused:report.finalStatus?.is_paused,automationEnabled:report.finalAutomation?.automation_enabled}));
}
