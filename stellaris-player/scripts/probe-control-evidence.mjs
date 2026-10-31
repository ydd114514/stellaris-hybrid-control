// Paused readback/cleanup only. This is not a productive benchmark.
import {NativeGame} from '../src/native-game.mjs';import {analyzeControlEvidence} from '../src/control-evidence.mjs';
import {mkdir,readFile,writeFile} from 'node:fs/promises';import {resolve} from 'node:path';import {setTimeout as delay} from 'node:timers/promises';
if(!process.argv.includes('--execute'))throw Error('需要execute：仅暂停核对，不推进时间');
const directory=resolve(`.local/hybrid-control/paused-evidence-${Date.now()}`);await mkdir(directory,{recursive:true});
const game=new NativeGame({directory,minutes:1,hybridSurvey:false,presentOrders:false}),report={directory,scenario:'paused observation and cleanup, not efficiency or productive-work acceptance'};
try{
 const state=await game.start({keepPaused:true});report.initialDate=state.date;
 report.inspect=await game.surveyControl({operation:'inspect',fleetId:1});
 if(report.inspect.known!==true||report.inspect.automation_enabled!==false)throw Error('测试要求既有自动调查已关闭，不改动用户现有自动化');
 report.recover=await game.surveyControl({operation:'recover',fleetId:1,snapshotId:game.snapshotId});
 await delay(1200);report.pausedRead=await game.guard();
}catch(error){report.error=error.message;process.exitCode=1;}
finally{
 await game.stop();report.cleanup=game.cleanup;
 try{const final=await game.rpc('get_status');report.finalDate=final.date?.formatted;report.paused=final.is_paused;await Promise.allSettled([...game.evidencePending]);}catch(error){report.finalError=error.message;}
 game.pipe.close();
 const events=(await readFile(game.journal,'utf8')).trim().split('\n').map(line=>JSON.parse(line));report.evidence=analyzeControlEvidence(events);
 const file=resolve(directory,'result.json');await writeFile(file,JSON.stringify(report,null,2));
 console.log(JSON.stringify({file,error:report.error,initialDate:report.initialDate,finalDate:report.finalDate,paused:report.paused,evidence:report.evidence}));
}
