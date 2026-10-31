import {spawn} from 'node:child_process';import {randomUUID} from 'node:crypto';
import {mkdir,writeFile,readFile,appendFile} from 'node:fs/promises';import {join,resolve} from 'node:path';import {setTimeout as delay} from 'node:timers/promises';
import {writeStopRequest,readStopCompletion,stopControlledChild} from '../src/cooperative-stop.mjs';import {NativePipe} from '../src/native-pipe.mjs';import {analyzeControlEvidence} from '../src/control-evidence.mjs';
if(!process.argv.includes('--execute'))throw Error('需要 --execute；此检查不推进时间、不委派调查、不调用模型');
const started=Date.now(),runId=randomUUID(),directory=resolve('.local/hybrid-control',`cooperative-stop-${started}`);await mkdir(directory,{recursive:true});
const preflight=new NativePipe();let fleetId,automationBefore;
try{const fleets=await preflight.request('get_civilian_fleets');fleetId=fleets.science_ships?.[0]?.fleet_id;if(!Number.isInteger(fleetId))throw Error('没有当前己方科研船');automationBefore=await preflight.request('get_fleet_automation',{fleet_id:fleetId});if(automationBefore.known!==true)throw Error('原调查状态未知');}finally{preflight.close();}
const env={...process.env,CYBERFISH_NATIVE_DIRECTORY:directory,CYBERFISH_CONTROLLER_RUN:runId,CYBERFISH_STOP_BASELINE:String(started),CYBERFISH_START_PAUSED:'1',CYBERFISH_NATIVE_PRESENTATION:'0',CYBERFISH_HYBRID_SURVEY:'1',CYBERFISH_TEST_MINUTES:'2'};delete env.DEEPSEEK_API_KEY;
const child=spawn(process.execPath,['src/native-mcp.mjs'],{env,windowsHide:true,stdio:['pipe','pipe','pipe']});
let buffer='',nextId=1,forced=false;const pending=new Map();const exited=new Promise((done,fail)=>{child.once('exit',(code,signal)=>done({code,signal}));child.once('error',fail);});
child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{void appendFile(join(directory,'protocol.jsonl'),chunk);buffer+=chunk;let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{const response=JSON.parse(line),p=pending.get(response.id);if(p){clearTimeout(p.timer);pending.delete(response.id);p.done(response);}}catch{}}});
child.stderr.on('data',chunk=>void appendFile(join(directory,'stderr.log'),chunk));
const request=(method,params)=>new Promise((done,fail)=>{const id=nextId++,timer=setTimeout(()=>{pending.delete(id);fail(Error('MCP响应超时'));},10000);pending.set(id,{done,timer});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
const alive=()=>child.exitCode===null&&child.signalCode===null;
const terminate=async()=>{if(!alive())return;await Promise.race([exited,delay(1000)]);if(alive()){forced=true;child.kill();}};
const report={directory,runId,scenario:'paused native MCP cooperative exit; preserve pre-existing unowned automation; not productive gameplay or model-host acceptance',modelCalls:0,fleetId,automationBefore};
try{
 await request('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'cooperative-stop-probe',version:'1'}});
 const observed=await request('tools/call',{name:'observe',arguments:{}});
 if(observed.result?.isError)throw Error(observed.result.content?.[0]?.text||'原生观察失败');
 report.before=JSON.parse(observed.result.content[0].text);if(report.before.paused!==true)throw Error('没有确认暂停');
 report.stop=await stopControlledChild({alive,request:()=>writeStopRequest(directory,{runId,reason:'暂停会话退出证据验证'}),completion:r=>readStopCompletion(directory,{runId,requestedAt:r.requestedAt}),terminate});
 report.exit=await exited;report.forced=forced;
 const checkpoint=JSON.parse(await readFile(join(directory,'latest-session.json'),'utf8'));
 const rows=(await readFile(join(directory,`session-${checkpoint.sessionId}.jsonl`),'utf8')).trim().split('\n').map(JSON.parse);report.controlEvidence=analyzeControlEvidence(rows);
 report.completion=JSON.parse(await readFile(join(directory,'stop-complete.json'),'utf8'));
 if(!report.before.civilian?.science_ships?.some(f=>f.fleet_id===fleetId))throw Error('验收中的己方科研船身份改变');
 const pipe=new NativePipe();try{const s=await pipe.request('get_status');report.finalDate=s.date?.formatted;report.paused=s.is_paused;report.automation=await pipe.request('get_fleet_automation',{fleet_id:fleetId});}finally{pipe.close();}
 report.passed=report.exit.code===0&&!forced&&report.paused===true&&report.finalDate===report.before.date&&report.completion.pauseConfirmed===true&&report.completion.surveyConfirmed===true&&report.controlEvidence.writeBoundaryComplete===true&&report.controlEvidence.forbiddenWritesAfterStop===0&&report.automation.known===true&&report.automation.automation_enabled===automationBefore.automation_enabled&&JSON.stringify(report.automation.orders)===JSON.stringify(automationBefore.orders);
 if(!report.passed)process.exitCode=1;
}catch(error){report.error=error.message;process.exitCode=1;}
finally{
 for(const p of pending.values())clearTimeout(p.timer);
 if(alive()){forced=true;child.kill();await exited.catch(()=>{});}report.forced=forced;
 await writeFile(join(directory,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({directory,passed:report.passed,error:report.error,exit:report.exit,forced:report.forced,date:report.finalDate,paused:report.paused,controlEvidence:report.controlEvidence},null,2));
}
