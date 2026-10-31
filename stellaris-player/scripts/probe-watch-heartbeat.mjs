// Zero-model technical check in the current post-benchmark world. Never loads a save.
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {NativeGame} from '../src/native-game.mjs';
import {NativePipe} from '../src/native-pipe.mjs';
import {executionStatus} from '../src/execution-status.mjs';
const directory=resolve('.local/hybrid-control',`watch-heartbeat-${Date.now()}`);
await mkdir(directory,{recursive:true});
const result={directory,executed:process.argv.includes('--execute'),modelCalls:0,pairedEfficiencyAcceptance:false};
if(!result.executed){await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));process.exit(0);}
const game=new NativeGame({directory:join(directory,'native'),minutes:1,hybridSurvey:false,presentOrders:false,requirePicture:false});
let polling=true,poll;
try{
 const s=await game.start({keepPaused:true});
 if(!s.paused||s.pendingEvents?.length||s.wars?.length)throw Error('需要暂停且无当前事件/战争的测试世界');
 const off=await game.rpc('get_fleet_automation',{fleet_id:1});
 if(!off.known||off.automation_enabled!==false||off.order_chain_complete!==true)throw Error('需要已收回原生调查的世界');
 const initial={snapshotId:s.snapshotId,date:s.date,observedAt:game.snapshotAt};result.initial=initial;
 result.heartbeats=[];
 poll=(async()=>{while(polling){await delay(250);try{
  const c=JSON.parse(await readFile(join(game.directory,'latest-session.json'),'utf8'));
  const live=executionStatus(c);
  if(c.sessionId===game.sessionId&&c.state.snapshotId===initial.snapshotId&&c.observedAt===initial.observedAt&&live.known&&live.paused===false&&c.runtimeStatus.observedAt>initial.observedAt){
   const last=result.heartbeats.at(-1);if(last?.observedAt!==c.runtimeStatus.observedAt)result.heartbeats.push({observedAt:c.runtimeStatus.observedAt,date:live.date,decisionDate:c.state.date,snapshotId:c.state.snapshotId});
  }
 }catch{}}})();
 const start=Date.now();const watched=await game.watch(12);result.waitedMs=Date.now()-start;result.wakeReasons=watched.wakeReasons;
 polling=false;await poll;
 result.liveWhileDecisionUnchanged=result.heartbeats.length>=2;
 if(!result.liveWhileDecisionUnchanged)throw Error('未观察到两次等待期间的独立执行心跳');
}catch(e){result.error=e.message;process.exitCode=1;}
finally{
 polling=false;await poll;
 try{await game.stop();result.cleanup=game.cleanup;}catch(e){result.cleanupError=e.message;process.exitCode=1;}game.pipe.close();
 const p=new NativePipe();try{const s=await p.request('get_status');result.final={paused:s.is_paused,date:s.date?.formatted};if(s.is_paused!==true)throw Error('停止后未确认暂停');}catch(e){result.finalError=e.message;process.exitCode=1;}finally{p.close();}
 result.limitations='Technical heartbeat probe only; current world advances during the bounded wait. No desktop input, save load, model calls, efficiency comparison or long-run acceptance.';
 await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}
