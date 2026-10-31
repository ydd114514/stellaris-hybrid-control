import {NativeGame} from '../src/native-game.mjs';
import {mkdir,writeFile,readFile} from 'node:fs/promises';import {resolve,join} from 'node:path';
if(!process.argv.includes('--execute'))throw Error('需要 --execute；仅对当前已载入独立测试档做正常航行与调查试验');
const directory=resolve('.local/hybrid-control',`frontier-${Date.now()}`);await mkdir(directory,{recursive:true});
const game=new NativeGame({directory,minutes:4,hybridSurvey:true,presentOrders:false}),report={directory,hypothesis:'normal arrival in an unexplored candidate may change native survey admission; no result assumed'};
const finishIndex=process.argv.indexOf('--finish-existing'),previous=finishIndex>=0?JSON.parse(await readFile(process.argv[finishIndex+1],'utf8')):null;
try{
 const state=await game.start({keepPaused:true});report.initial=state;
 if(state.player.country_id!==0||state.player.capital_system_id!==1||!state.paused||state.pendingEvents.length||state.wars.length)throw Error('当前测试会话不满足暂停、无中央事件和无战争条件');
 const ship=state.civilian.science_ships.find(x=>x.fleet_id===1);if(!ship?.leader_id||!previous&&ship.status!=='无指令')throw Error('科研船尚未空闲或缺科学官');
 const off=await game.surveyControl({operation:'inspect',fleetId:1});if(off.automation_enabled!==false||!previous&&off.orders.length)throw Error('原生调查尚未关闭');
 if(!previous)await game.surveyControl({operation:'recover',fleetId:1,snapshotId:game.snapshotId});
 const candidates=await game.rpc('find_systems',{purpose:'unsurveyed',fleet_id:1,limit:8});report.candidates=candidates;
 let selected=previous?.selected;
 if(!previous)for(const target of candidates.systems||[]){if(target.intel!==0)continue;const path=await game.rpc('find_path',{fleet_id:1,to_system_id:target.id});if(path.reachable===true&&path.systems?.length){selected={target,path};break;}}
 if(!selected)throw Error('没有可核对的未探索、可达候选');report.selected=selected;
 if(!previous)report.movement=await game.apply({requestId:'frontier-normal-move',snapshotId:game.snapshotId,explanation:'先选择一处邻近航道探索，抵达后再让科研船处理例行调查。',orders:[{command:'set_speed',arguments:{speed:2}},{command:'set_fleet_stance',arguments:{fleet_id:1,stance:'evasive'}},{command:'move_fleet',arguments:{fleet_id:1,system_id:selected.target.id}}]});
 for(let n=0;n<8;n++){
  report.latest=await game.watch(15);const sys=await game.rpc('get_system',{system_id:selected.target.id});report.targetSystem=sys;
  if(report.latest.pendingEvents.length)throw Error('航行中出现中央事件，保持暂停并结束本次条件试验');
  const orders=await game.rpc('get_fleet_automation',{fleet_id:1});
  if(sys.fleets?.some(f=>f.id===1&&f.own)&&orders.known&&orders.automation_enabled===false&&orders.orders?.length===0){report.arrived=true;break;}
  if(report.latest.decisionAttention?.reasons?.some(x=>x!=='new_alert'))throw Error('本地安全保护需要新的战略判断');
 }
 if(!report.arrived)throw Error('有界时间内尚未确认抵达，不重发航行');
 report.delegate=await game.surveyControl({operation:'delegate',fleetId:1,snapshotId:game.snapshotId});
 report.watched=await game.watch(20);report.automation=await game.rpc('get_fleet_automation',{fleet_id:1});
 report.nativeChildObserved=report.automation.orders?.some(x=>x.automation===false)===true;
}catch(error){report.error=error.message;}
finally{
 await game.stop();report.cleanup=game.cleanup;try{const s=await game.rpc('get_status');report.finalDate=s.date?.formatted;report.paused=s.is_paused;report.finalAutomation=await game.rpc('get_fleet_automation',{fleet_id:1});}catch(error){report.finalError=error.message;}
 game.pipe.close();await writeFile(join(directory,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({directory,error:report.error,arrived:report.arrived,nativeChildObserved:report.nativeChildObserved,date:report.finalDate,paused:report.paused,cleanup:report.cleanup}));
}
