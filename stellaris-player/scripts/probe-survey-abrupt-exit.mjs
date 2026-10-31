import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';import {fileURLToPath} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';import {setTimeout as delay} from 'node:timers/promises';
import {NativeGame} from '../src/native-game.mjs';import {NativePipe} from '../src/native-pipe.mjs';
import {inspectNativeProcess} from '../src/native-process.mjs';
import {supervisorCleanup} from '../src/supervisor-cleanup.mjs';

const args=process.argv.slice(2),option=k=>args[args.indexOf(k)+1];
if(!args.includes('--execute')||!args.includes('--expected-date'))throw Error('需要明确execute与expected-date');
const expectedDate=option('--expected-date');
if(args.includes('--child')){
 const game=new NativeGame({directory:option('--directory'),minutes:2,hybridSurvey:true});
 const state=await game.start({keepPaused:true});
 if(state.date!==expectedDate||!state.paused)throw Error('当前测试局不匹配');
 // Explicit negative-test setup: bypass work admission only to test cleanup.
 // No game-time advancement, resource editing or paid model request.
 const control=await game.surveyDelegation.change(1,true);
 if(control.owner!=='native')throw Error('未确认委派');
 console.log(JSON.stringify({ready:true,sessionId:game.sessionId,pid:process.pid}));
 await delay(120000);process.exit(2);
}
const started=Date.now(),directory=resolve('.local/hybrid-control/abrupt-exit-'+started);
await mkdir(directory,{recursive:true});
const controllerRunId=randomUUID();
const report={directory,started,controllerRunId,scenario:'paused abrupt process termination, not productive survey acceptance'};
const child=spawn(process.execPath,[fileURLToPath(import.meta.url),...args,'--child','--directory',directory],{windowsHide:true,env:{...process.env,CYBERFISH_CONTROLLER_RUN:controllerRunId},stdio:['ignore','pipe','pipe']});
const exited=new Promise(done=>child.once('exit',(code,signal)=>done({code,signal})));
const pipe=new NativePipe();
try{
 await new Promise((done,fail)=>{
  const timeout=setTimeout(()=>fail(Error('试点子进程未就绪')),15000);let data='';
  child.once('error',e=>{clearTimeout(timeout);fail(e);});
  child.once('exit',()=>{clearTimeout(timeout);fail(Error('子进程提前退出'));});
  child.stdout.on('data',chunk=>{data+=chunk;if(data.includes('\n')){try{report.child=JSON.parse(data.split('\n')[0]);clearTimeout(timeout);done();}catch(e){clearTimeout(timeout);fail(e);}}});
  child.stderr.resume();
 });
 child.kill('SIGKILL');report.exit=await exited;await delay(200);
 report.cleanup=await supervisorCleanup({directory,started,runId:controllerRunId,rpc:(m,p)=>pipe.request(m,p),release:()=>pipe.close(),identity:()=>inspectNativeProcess({op:'identity'})});
 if(!report.cleanup.paused||!report.cleanup.survey.some(r=>r.fleetId===1&&r.confirmed))throw Error('强制退出后的实际收权未全部确认');
}catch(error){report.error=error.message;process.exitCode=1;}
finally{
 if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}
 try{await pipe.request('set_paused',{paused:true});report.final=await pipe.request('get_fleet_automation',{fleet_id:1});}catch(error){report.finalError=error.message;}
 pipe.close();await writeFile(resolve(directory,'result.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
}
