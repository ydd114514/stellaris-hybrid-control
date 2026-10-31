import {readFile,writeFile,rename,stat} from 'node:fs/promises';
import {join} from 'node:path';import {setTimeout as delay} from 'node:timers/promises';
export async function writeStopRequest(directory,{runId,reason,now=Date.now()}){
 if(typeof runId!=='string'||!/^[a-zA-Z0-9-]{1,100}$/.test(runId))throw Error('停止请求缺少有效运行代次');
 const request={version:1,runId,requestedAt:now,reason:String(reason).slice(0,200)};
 const file=join(directory,'stop-request.json');await writeFile(file+'.tmp',JSON.stringify(request));await rename(file+'.tmp',file);return request;
}
export async function readStopRequest({directory,runId,baseline,now=Date.now(),stopFile='.local/STOP'}){
 try{const r=JSON.parse(await readFile(join(directory,'stop-request.json'),'utf8'));
  if(r.version===1&&r.runId===runId&&typeof runId==='string'&&Number.isFinite(r.requestedAt)&&r.requestedAt>=baseline&&r.requestedAt<=now+1000)return '本轮监督器请求停止';
 }catch{}
 try{if((await stat(stopFile)).mtimeMs>=baseline)return '已收到停止指令';}catch{}
 return null;
}
export async function writeStopCompletion(directory,{runId,sessionId,cleanup,now=Date.now()}){
 const scopeKnown=cleanup?.bindingConfirmed!==false&&cleanup?.pauseStateUnknown!==true;
 const result={version:1,runId,sessionId,scope:'session_delegations',completedAt:now,pauseConfirmed:scopeKnown&&cleanup?.pauseConfirmed===true,
  surveyConfirmed:scopeKnown&&!cleanup?.surveyCleanupError&&(cleanup?.survey||[]).every(x=>x.confirmed===true),monthlyTradeConfirmed:scopeKnown&&cleanup?.monthlyTrade?.confirmed!==false,colonyControlConfirmed:!cleanup?.colonyControlError&&!cleanup?.colonyUpgradeCleanupError};
 const file=join(directory,'stop-complete.json');await writeFile(file+'.tmp',JSON.stringify(result));await rename(file+'.tmp',file);return result;
}
export async function readStopCompletion(directory,{runId,requestedAt}){
 try{const r=JSON.parse(await readFile(join(directory,'stop-complete.json'),'utf8'));
  return r.version===1&&r.runId===runId&&typeof r.sessionId==='string'&&Number.isFinite(r.completedAt)&&r.completedAt>=requestedAt?r:null;
 }catch{return null;}
}
// Liveness comes from the actual ChildProcess, never from a checkpoint/lock.
// A completion is only evidence that the actor finished cleanup; the supervisor
// still performs its independent native readback after the child tree exits.
export async function stopControlledChild({alive,request,completion,terminate,requestExit,exitGraceMs=5000,timeoutMs=15000,now=Date.now,sleep=delay}){
 if(!Number.isFinite(exitGraceMs)||exitGraceMs<0||exitGraceMs>10000)throw Error('宿主退出宽限无效');
 if(!Number.isFinite(timeoutMs)||timeoutMs<0||timeoutMs>30000)throw Error('停止等待上限无效');
 if(!alive())return {method:'already_exited'};
 let receipt;
 try{receipt=await request();}catch{return {method:'forced_request_failed',...await terminate()};}
 const until=now()+timeoutMs;
 while(alive()&&now()<until){
  const done=await completion(receipt);
  if(done){
   if(requestExit){
    try{await requestExit(done);}catch{await terminate();return {method:'forced_host_exit_request_failed',completion:done};}
    const exitUntil=now()+exitGraceMs;
    while(alive()&&now()<exitUntil)await sleep(Math.min(100,Math.max(0,exitUntil-now())));
    if(!alive())return {method:'cooperative_cleanup_then_natural_exit',completion:done};
    await terminate();return {method:'forced_host_exit_timeout',completion:done};
   }
   await terminate();return {method:'cooperative_cleanup_then_exit',completion:done};
  }
  await sleep(Math.min(250,Math.max(0,until-now())));
 }
 if(!alive())return {method:'exited_during_cleanup'};
 await terminate();return {method:'forced_timeout'};
}
