// One normal movement order through NativeGame, without camera/panel presentation.
import {NativeGame} from '../src/native-game.mjs';
import {mkdir,writeFile} from 'node:fs/promises';import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
const args=process.argv.slice(2),value=k=>args.includes(k)?args[args.indexOf(k)+1]:undefined;
const fleetId=Number(value('--fleet')),systemId=Number(value('--system')),date=value('--expected-date');
if(!args.includes('--execute')||!date||![fleetId,systemId].every(x=>Number.isSafeInteger(x)&&x>=0&&x<0xffffffff))throw Error('需要execute、fleet、system、expected-date');
const directory=resolve(`.local/hybrid-control/position-${Date.now()}`);await mkdir(directory,{recursive:true});
const game=new NativeGame({directory,minutes:5,hybridSurvey:true,presentOrders:false}),report={fleetId,systemId,directory,samples:[]};
try{
 const state=await game.start({keepPaused:true});report.before=state;
 if(state.date!==date||!state.paused||state.pendingEvents.length||state.wars.length)throw Error('试点前置条件变化');
 report.path=await game.rpc('find_path',{fleet_id:fleetId,to_system_id:systemId});
 if(report.path.reachable!==true||!(report.path.estimated_days<500))throw Error('未确认短程正常路线');
 if(args.includes('--finish-existing')){
  const actual=await game.rpc('get_fleet_automation',{fleet_id:fleetId});
  if(report.path.from_system_id!==systemId||actual.known!==true||actual.automation_enabled!==false)throw Error('不符合已到达系统内继续完成原有航行的条件');
  report.continuedExisting=true;
 }else{
  report.move=await game.apply({requestId:'pilot-position',snapshotId:game.snapshotId,explanation:'先把科研船调到已知的调查区域附近，再交给自动调查。',orders:[{command:'move_fleet',arguments:{fleet_id:fleetId,system_id:systemId}}]});
  if(report.move.orders[0]?.status!=='posted')throw Error('正常移动未提交');
 }
 await game.rpc('set_speed',{speed:4});await game.rpc('set_paused',{paused:false});
 const until=Date.now()+180000;
 while(Date.now()<until){
  const status=await game.guard();if(status.is_paused){report.interrupted='game_paused';break;}
  await game.monitorDecision(0);if(game.decisionPause){report.interrupted=game.decisionPause;break;}
  const target=await game.rpc('get_system',{system_id:systemId});
  report.samples.push({at:new Date().toISOString(),date:status.date?.formatted,present:target.fleets?.some(f=>f.id===fleetId&&f.own)});
  const actual=await game.rpc('get_fleet_automation',{fleet_id:fleetId});
  if(report.samples.at(-1).present&&actual.known===true&&actual.order_chain_complete===true&&actual.orders.length===0){report.arrived=true;break;}
  await delay(1000);
 }
}catch(error){report.error=error.message;process.exitCode=1;}
finally{
 try{await game.rpc('set_paused',{paused:true});if(Number.isInteger(report.before?.speed))await game.rpc('set_speed',{speed:report.before.speed});}catch(error){report.speedRestoreError=error.message;}
 await game.stop();report.cleanup=game.cleanup;
 try{report.finalStatus=await game.rpc('get_status');}catch(error){report.finalError=error.message;}
 game.pipe.close();const file=resolve(directory,'result.json');await writeFile(file,JSON.stringify(report,null,2));
 console.log(JSON.stringify({file,arrived:report.arrived,interrupted:report.interrupted,error:report.error,date:report.finalStatus?.date?.formatted,paused:report.finalStatus?.is_paused}));
}
