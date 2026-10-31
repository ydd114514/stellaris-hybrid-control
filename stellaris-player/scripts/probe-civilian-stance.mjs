import {NativeGame} from '../src/native-game.mjs';import {mkdir,writeFile} from 'node:fs/promises';import {join,resolve} from 'node:path';
if(!process.argv.includes('--execute'))throw Error('需要 --execute；正常设置己方空闲科研船的回避姿态');
const directory=resolve('.local/hybrid-control',`civilian-stance-${Date.now()}`);await mkdir(directory,{recursive:true});
const game=new NativeGame({directory,minutes:2,hybridSurvey:true,presentOrders:false}),report={directory};
try{
 const s=await game.start({keepPaused:true});if(!s.paused||s.pendingEvents.length||s.wars.length)throw Error('当前测试局需要暂停且无待处理中央事件或战争');
 const auto=await game.surveyControl({operation:'inspect',fleetId:1});if(auto.automation_enabled!==false||auto.orders.length)throw Error('科研船尚未完全收权');
 const origin=await game.rpc('find_path',{fleet_id:1,to_system_id:s.player.capital_system_id});const systemId=origin.from_system_id;if(origin.fleet_id!==1||!Number.isSafeInteger(systemId))throw Error('科研船位置未知');
 report.before=await game.rpc('get_system',{system_id:systemId});
 report.result=await game.apply({requestId:'science-stance-evasive',snapshotId:game.snapshotId,explanation:'让科研船优先回避交战，减少探索时的意外损失。',orders:[{command:'set_fleet_stance',arguments:{fleet_id:1,stance:'evasive'}}]});
 report.after=await game.rpc('get_system',{system_id:systemId});
 report.verified=report.result.orders[0]?.status==='posted'&&report.after.fleets?.some(f=>f.id===1&&f.own&&f.stance==='evasive')===true;
}catch(error){report.error=error.message;}
finally{await game.stop();report.cleanup=game.cleanup;game.pipe.close();await writeFile(join(directory,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({directory,verified:report.verified,error:report.error,result:report.result?.orders,cleanup:report.cleanup}));}
