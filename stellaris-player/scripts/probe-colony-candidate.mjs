import {readFile,writeFile,mkdir} from 'node:fs/promises';import {resolve,join} from 'node:path';import {createHash} from 'node:crypto';import {spawnSync} from 'node:child_process';
import {inspectNativeProcess} from '../src/native-process.mjs';import {NativePipe} from '../src/native-pipe.mjs';
import {colonyReadCandidate,admitColonyCandidate,assertColonyCandidateRead,assertColonyPipeOwner} from '../src/colony-candidate-policy.mjs';
const args=process.argv.slice(2),value=k=>args.includes(k)?args[args.indexOf(k)+1]:undefined;
const directory=resolve('.local/hybrid-control',`colony-candidate-${Date.now()}`);await mkdir(directory,{recursive:true});
const candidate=JSON.parse(await readFile(resolve('.local/native-bridge/runtime',colonyReadCandidate.version,'candidate.json'),'utf8'));
const digest=createHash('sha256').update(await readFile(candidate.path)).digest('hex');
const result={candidateVersion:candidate.version,digest,loaderInvoked:false,runtimeValidated:false,gameplayWrites:0,commandsIssued:0};let pipe;
const helper=(script,input)=>{const r=spawnSync('C:/Program Files/Python315/python.exe',[script],{input:JSON.stringify(input),encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:65536});if(r.status!==0)throw Error('原生验证辅助进程失败');const x=JSON.parse(r.stdout);if(x.ok===false)throw Error(x.error);return x;};
try{
 if(candidate.version!==colonyReadCandidate.version||digest!==colonyReadCandidate.sha256)throw Error('候选文件与固定版本不符');
 if(args.includes('--execute')){
  const pid=Number(value('--pid')),planetId=Number(value('--planet-id')??3);if(!Number.isSafeInteger(pid)||pid<=0||!Number.isSafeInteger(planetId)||planetId<0||planetId>=0xffffffff)throw Error('执行需要明确--pid和有效行星ID');
  result.identity=await inspectNativeProcess({op:'bridge_module',pid});const admission=admitColonyCandidate({candidate,digest,identity:result.identity});result.admission=admission;
  if(admission.loadRequired){result.loaderInvoked=true;result.loader=helper('native/research/load_native_bridge.py',{pid,gamePath:'D:/SteamLibrary/steamapps/common/Stellaris/stellaris.exe',dllPath:candidate.path,compatibleDllPaths:[],expectedCreationTime:result.identity.creationTime});}
  result.pipeOwner=await inspectNativeProcess({op:'identity',creationTime:result.identity.creationTime});assertColonyPipeOwner(result.pipeOwner,result.identity);
  pipe=new NativePipe({beforeWrite:assertColonyCandidateRead});const ping=await pipe.request('ping');if(ping.bridge_version!==candidate.version)throw Error('实际桥版本与候选不符');
  const status=await pipe.request('get_status'),world=await pipe.request('get_galaxy_overview');if(status.is_paused!==true)throw Error('需要手动保持暂停；验证入口不会修改暂停状态');
  const planet=await pipe.request('get_planet_details',{planet_id:planetId}),query=await pipe.request('get_colony_automation',{planet_id:planetId});result.query=query;
  if(query.known!==true||typeof query.enabled!=='boolean'||query.owner_id!==world.player?.country_id||query.colony_id!==planet.colony_id||query.queue?.known!==true||query.category_membership?.known!==true||query.settings_known!==false||query.budget_known!==false)throw Error('候选读结果不完整或边界不符');
  const rejection=await pipe.request('get_colony_automation',{planet_id:0xffffffff});result.invalidHandle=rejection;if(rejection.known!==false||rejection.enabled!==null)throw Error('无效句柄未保持未知');
  const after=await pipe.request('get_status');if(after.is_paused!==true||after.date?.formatted!==status.date?.formatted)throw Error('验证期间暂停或日期变化');
  pipe.close();pipe=undefined;
  result.finalPipeOwner=await inspectNativeProcess({op:'identity',creationTime:result.identity.creationTime});assertColonyPipeOwner(result.finalPipeOwner,result.identity);
  result.finalIdentity=await inspectNativeProcess({op:'bridge_module',pid,creationTime:result.identity.creationTime});if(admitColonyCandidate({candidate,digest,identity:result.finalIdentity,expectedIdentity:result.identity}).loadRequired)throw Error('核对结束时未找到候选模块');
  result.readRuntimeValidated=true;result.runtimeValidated=true;result.date=after.date.formatted;result.paused=true;
 }else result.preparedOnly=true;
 result.limitations='Read-only candidate smoke test; no category execution, budget, enable/disable or paid automation acceptance. Production bootstrap does not admit this candidate.';
}catch(e){result.error=e.message;process.exitCode=1;}finally{pipe?.close();await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({directory,...result},null,2));}
