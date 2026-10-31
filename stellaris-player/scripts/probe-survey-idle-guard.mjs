import {NativeGame} from '../src/native-game.mjs';
import {mkdir,writeFile} from 'node:fs/promises';import {resolve} from 'node:path';
const args=process.argv.slice(2),value=k=>args.includes(k)?args[args.indexOf(k)+1]:undefined;
const fleetId=Number(value('--fleet')),date=value('--expected-date');
if(!args.includes('--execute')||!date||!Number.isSafeInteger(fleetId)||fleetId<0||fleetId>=0xffffffff)throw Error('需要execute、fleet、expected-date');
const directory=resolve(`.local/hybrid-control/idle-watch-${Date.now()}`);await mkdir(directory,{recursive:true});
const game=new NativeGame({directory,minutes:2,hybridSurvey:true,presentOrders:false}),report={directory};
try{
 const s=await game.start({keepPaused:true});if(s.date!==date||!s.paused)throw Error('测试局状态不符');
 if(s.pendingEvents.length||s.warGoalsWindow)throw Error('关键事件尚未处理，不建立待命测试情境');
 report.before=s;report.delegated=await game.surveyControl({operation:'delegate',fleetId,snapshotId:s.snapshotId});
 report.watched=await game.watch(20);
 report.actual=await game.rpc('get_fleet_automation',{fleet_id:fleetId});report.status=await game.rpc('get_status');
 report.passed=report.watched.wakeReasons?.includes('survey_no_work')&&report.actual.automation_enabled===false&&report.status.is_paused===true;
 if(!report.passed)report.limitation='本轮未到达待命保护分支，其他事件或实际工作不能替代该分支验收';
}catch(error){report.error=error.message;process.exitCode=1;}
finally{
 await game.stop();report.cleanup=game.cleanup;
 const file=resolve(directory,'result.json');await writeFile(file,JSON.stringify(report,null,2));
 console.log(JSON.stringify({file,passed:report.passed,error:report.error,limitation:report.limitation,date:report.status?.date?.formatted,reasons:report.watched?.wakeReasons}));
}
