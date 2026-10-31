import {mkdir,writeFile,readFile} from 'node:fs/promises';import {resolve,join} from 'node:path';import {randomUUID} from 'node:crypto';
import {NativeGame} from '../src/native-game.mjs';import {NativePipe} from '../src/native-pipe.mjs';import {analyzeControlEvidence} from '../src/control-evidence.mjs';
const directory=resolve('.local/hybrid-control',`watch-window-${Date.now()}`);await mkdir(directory,{recursive:true});
const result={directory,surveyWatchSeconds:90,realModelCalls:0,matchedBenchmark:false,longRunAcceptance:false,executed:process.argv.includes('--execute')};
if(!result.executed){await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));process.exit(0);}
process.env.CYBERFISH_CONTROLLER_RUN=randomUUID();
const game=new NativeGame({directory:join(directory,'native'),minutes:3,hybridSurvey:true,surveyWatchSeconds:90,presentOrders:false,requirePicture:false});
const deadline=setTimeout(()=>game.requestStop('watch-window probe deadline'),150000);deadline.unref();
try{
 const state=await game.start({keepPaused:true});result.initial={date:state.date,paused:state.paused,player:state.player};
 if(!state.paused||state.pendingEvents?.length||state.wars?.length)throw Error('需要暂停、无当前中央事件与战争的测试条件');
 const ship=state.civilian.science_ships.find(x=>x.fleet_id===1&&x.leader_id);if(!ship)throw Error('缺少已指定科研船与科学官');
 result.recovery=await game.surveyControl({operation:'recover',fleetId:1,snapshotId:game.snapshotId});
 result.delegate=await game.surveyControl({operation:'delegate',fleetId:1,snapshotId:game.snapshotId});
 const began=Date.now(),observed=await game.watch(90);result.waitedMs=Date.now()-began;result.waitPolicy=observed.waitPolicy;result.wakeReasons=observed.wakeReasons;result.finalObservedDate=observed.date;
 result.effectiveWindowAccepted=observed.waitPolicy?.effectiveSeconds===90&&observed.waitPolicy.nativeWorkConfirmed===true;
 result.quietFullWindowObserved=result.effectiveWindowAccepted&&result.waitedMs>=90000&&observed.wakeReasons?.length===1&&observed.wakeReasons[0]==='scheduled_review';
 result.protectiveWakeObserved=result.effectiveWindowAccepted&&observed.wakeReasons?.some(x=>x!=='scheduled_review')===true;
}catch(e){result.error=e.message;process.exitCode=1;}
finally{
 clearTimeout(deadline);try{await game.stop();result.cleanup=game.cleanup;}catch(e){result.cleanupError=e.message;process.exitCode=1;}game.pipe.close();
 const pipe=new NativePipe();try{const status=await pipe.request('get_status'),automation=await pipe.request('get_fleet_automation',{fleet_id:1});result.independent={date:status.date?.formatted,paused:status.is_paused,known:automation.known,automationEnabled:automation.automation_enabled,orderChainComplete:automation.order_chain_complete};if(status.is_paused!==true||automation.known!==true||automation.automation_enabled!==false||automation.order_chain_complete!==true)throw Error('独立暂停或收权回读未确认');}catch(e){result.finalError=e.message;process.exitCode=1;}finally{pipe.close();}
 try{const rows=(await readFile(join(game.directory,`session-${game.sessionId}.jsonl`),'utf8')).trim().split('\n').map(JSON.parse);result.controlEvidence=analyzeControlEvidence(rows);}catch(e){result.evidenceError=e.message;}
 result.limitations='Zero-model technical run in the post-benchmark world. No claim about request reduction, paired efficiency, colony spending or long-run acceptance.';
 await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({directory,effectiveWindowAccepted:result.effectiveWindowAccepted,quietFullWindowObserved:result.quietFullWindowObserved,protectiveWakeObserved:result.protectiveWakeObserved,waitedMs:result.waitedMs,wakeReasons:result.wakeReasons,independent:result.independent,controlEvidence:result.controlEvidence,error:result.error,finalError:result.finalError},null,2));
}
