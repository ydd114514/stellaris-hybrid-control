// One explicitly armed, bounded acceptance through the existing DSH supervisor.
// Preparing / --status never connects to the game or to a model provider.
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,appendFile,rename} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {NativePipe} from '../src/native-pipe.mjs';
import {createLiveModelBudget} from '../src/live-model-budget.mjs';
import {writeStopRequest} from '../src/cooperative-stop.mjs';
import {confirmedCountryAIHandoff} from '../src/country-ai-handoff.mjs';
import {executionStatus} from '../src/execution-status.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const nativeDirectory=join(root,'.local/native-bridge');
const currentFile=join(root,'.local/ai-mods-unified-current.json');
const minutes=8,maxRequests=12;
const readJson=async file=>{try{return JSON.parse(await readFile(file,'utf8'));}catch{return null;}};
const print=value=>process.stdout.write(JSON.stringify(value)+'\n');

if(process.argv.includes('--status')){
 const current=await readJson(currentFile);
 const summary=current?.directory?await readJson(join(current.directory,'summary.json')):null;
 if(!summary)throw Error('还没有已执行的统一验收；默认命令只准备，不启动。');
 print(summary);
}else if(!process.argv.includes('--execute')){
 print({stage:'prepared',execute:false,minutes,maxRequests,nativeDirectory,realModelCalls:0,
  next:'用户手动重启并载入2200年蜂巢存档、保持暂停，AI中控启动场控后，显式加 --execute。',
  monitor:'node scripts/accept-ai-mods-unified.mjs --status',
  stop:'更新 stellaris-player/.local/STOP，运行器将合作停止并确认暂停与归还。'});
}else{
 await execute();
}

async function execute(){
 const started=Date.now(),deadlineAt=started+minutes*60000;
 const directory=join(root,'.local',`ai-mods-unified-${started}`);
 await mkdir(directory,{recursive:true});
 const summary={stage:'preflight',started,deadlineAt,minutes,maxRequests,directory,nativeDirectory,
  requests:0,completed:0,failed:0,gameplayOutcomeComplete:false};
 let child,proxy,timer,deadline,stopping=false,stopWork,exitPromise,checking=false,saves=Promise.resolve();
 let ownedSession,firstState,signalStop;
 const persist=()=>{
  const value=JSON.stringify({...summary,updatedAt:Date.now()},null,2)+'\n';
  return saves=saves.catch(()=>{}).then(async()=>{
   const file=join(directory,'summary.json');await writeFile(file+'.tmp',value);await rename(file+'.tmp',file);
  });
 };
 const owned=cp=>cp&&Number.isFinite(cp.started)&&cp.started>=started&&
  typeof cp.sessionId==='string'&&typeof cp.controllerRunId==='string';
 const stop=reason=>{
  // Seal synchronously: onLimit must not let a thirteenth upstream request out.
  proxy?.seal();
  if(stopping)return stopWork;
  stopping=true;summary.stage='stopping';summary.stopReason=reason;
  stopWork=(async()=>{
   const cp=await readJson(join(nativeDirectory,'latest-session.json'));
   if(owned(cp))try{await writeStopRequest(nativeDirectory,{runId:cp.controllerRunId,reason});}catch{summary.scopedStopWriteFailed=true;}
   // The existing play-native-dsh supervisor consumes this stop marker, asks
   // NativeGame.stop to reclaim, then independently verifies the handoff.
   await writeFile(join(root,'.local/STOP'),`ai_mods_unified: ${reason}\n`);
   await persist();
  })().catch(async()=>{summary.stopWriteFailed=true;await persist();});
  return stopWork;
 };
 const requestCounts=()=>{
  if(!proxy)return;
  Object.assign(summary,{requests:proxy.report.forwardedRequests,completed:proxy.report.completed,failed:proxy.report.failed});
 };
 const poll=async()=>{
  if(checking)return;checking=true;
  try{
   requestCounts();
   const cp=await readJson(join(nativeDirectory,'latest-session.json'));
   if(owned(cp)){
    if(ownedSession&&ownedSession!==cp.sessionId){await stop('控制器会话发生变化，停止本轮验收');return;}
    ownedSession=cp.sessionId;firstState??=compactState(cp.state);
    const runtime=executionStatus(cp);
    summary.sessionId=cp.sessionId;summary.controllerRunId=cp.controllerRunId;
    summary.checkpoint=join(nativeDirectory,'latest-session.json');
    summary.events=join(nativeDirectory,`session-${cp.sessionId}.jsonl`);
    summary.date=runtime.date;summary.paused=runtime.paused;summary.executionKnown=runtime.known;
    summary.countryAI=compactControl(cp.countryAIControl??cp.state?.countryAIControl);
    summary.strategyContract=cp.strategyContract??null;
    summary.advice=compactAdvice(cp.state?.adviceExecution);
    summary.resources={start:firstState.resources,current:compactState(cp.state).resources};
    if(!stopping)summary.stage=cp.stopped?'controller_stopped':'running';
    if(cp.stopped&&!stopping)await stop('控制器已结束，核对最终归还');
   }
   summary.remainingSeconds=Math.max(0,Math.ceil((deadlineAt-Date.now())/1000));
   if(proxy?.report.requests>=maxRequests&&!stopping)await stop('本轮12次模型请求上限已到');
   await persist();
  }finally{checking=false;}
 };
 try{
  // No bridge injection, game launch, save load, pause change, or focus action
  // occurs here. The user must already have restarted, loaded and paused.
  await assertNoController();
  summary.preflight=await readPreflight();
  const source=(await readFile(join(root,'plugins/stellaris-dsh/cordis.patch.yml'),'utf8')).replaceAll('\r','');
  for(const id of ['tool-bash','tool-pwsh','tool-jobs','tool-fs','tool-fs-search','tool-working-directory','tool-skill','tool-subagent-control','tool-subagent-list-agents','tool-subagent','tool-subagent-fork','tool-workflow','tool-goal','tool-todo','tool-web']){
   if(!source.includes(`- id: ${id}\n  disabled: true`))throw Error('DSH工具范围改变，拒绝启动额外工具。');
  }
  if(source.split('    thinking: disabled').length!==2||/\bbaseURL\s*:/.test(source))throw Error('模型补丁锚点改变，拒绝绕过请求上限。');
  if(Date.now()>=deadlineAt)throw Error('启动检查已经超过本轮截止时间。');
  proxy=await createLiveModelBudget({directory,maxRequests,onLimit:()=>void stop('本轮12次模型请求上限已到')});
  const patch=source.replace('    thinking: disabled',`    baseURL: '${proxy.baseURL}'\n    retryPolicy:\n      mode: normal\n      maxRetries: 0\n    thinking: disabled`);
  const patchFile=join(directory,'bounded.patch.yml');await writeFile(patchFile,patch);
  const env={...process.env,CYBERFISH_DSH_PATCH:patchFile,CYBERFISH_DSH_HOME:join(directory,'dsh-home'),
   CYBERFISH_NATIVE_DIRECTORY:nativeDirectory,CYBERFISH_NATIVE_COUNTRY_AI:'1',CYBERFISH_HYBRID_SURVEY:'0',
   CYBERFISH_SURVEY_PILOT:'0',CYBERFISH_COLONY_UPGRADE_PILOT:'0',CYBERFISH_MONTHLY_LIFECYCLE_PILOT:'0',CYBERFISH_LOCAL_WAIT_PILOT:'0',
   CYBERFISH_NATIVE_PRESENTATION:'0',CYBERFISH_START_PAUSED:'1',CYBERFISH_MAX_GAME_SPEED:'3',
   CYBERFISH_REQUIRE_RUNNING_GAME:'1',CYBERFISH_STOP_BASELINE:String(started),CYBERFISH_LIVE_BRIEF:acceptanceBrief()};
  // play-native-dsh loads the existing credential helper and puts the key only
  // in the provider's authentication headers; no credential enters this patch.
  delete env.DEEPSEEK_API_KEY;delete env.ELECTRON_RUN_AS_NODE;
  const remainingMinutes=(deadlineAt-Date.now())/60000;
  if(remainingMinutes<=0)throw Error('本轮截止时间已到，未启动模型。');
  child=spawn(process.execPath,[join(root,'scripts/play-native-dsh.mjs'),String(remainingMinutes)],
   {cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  // Preserve the existing supervisor logs; never print model request bodies.
  child.stdout.on('data',b=>void appendFile(join(directory,'supervisor.jsonl'),b).catch(()=>{}));
  child.stderr.on('data',b=>void appendFile(join(directory,'supervisor.stderr.log'),b).catch(()=>{}));
  exitPromise=new Promise((done,fail)=>{child.once('error',fail);child.once('exit',(code,signal)=>done({code,signal}));});
  void exitPromise.catch(()=>{});
  summary.supervisorPid=child.pid;summary.stage='starting';
  await writeFile(currentFile,JSON.stringify({directory,started},null,2));await persist();
  signalStop=()=>void stop('用户或宿主要求停止');
  process.on('SIGINT',signalStop);process.on('SIGTERM',signalStop);
  deadline=setTimeout(()=>void stop('本轮8分钟截止时间已到'),Math.max(0,deadlineAt-Date.now()));
  timer=setInterval(()=>void poll().catch(()=>{summary.monitorReadFailed=true;}),2000);
  print({stage:'started',directory,minutes,maxRequests,summary:join(directory,'summary.json'),
   monitor:'node scripts/accept-ai-mods-unified.mjs --status'});
  const result=await exitPromise;
  summary.exitCode=result.code;summary.exitSignal=result.signal;
 }catch(error){
  // No raw provider/request errors enter the concise public summary.
  summary.error=String(error.message).slice(0,240);process.exitCode=1;
  if(child&&child.exitCode===null&&child.signalCode===null){await stop('统一验收发生异常，合作停止');await exitPromise?.catch(()=>{});}
 }finally{
  clearTimeout(deadline);clearInterval(timer);
  if(signalStop){process.off('SIGINT',signalStop);process.off('SIGTERM',signalStop);}
  await stopWork;
  // The reused supervisor performs NativeGame cooperative stop and independent
  // supervisorCleanup. Confirm its real receipt below; never kill its tree.
  await proxy?.close();requestCounts();
  const cp=await readJson(join(nativeDirectory,'latest-session.json'));
  if(owned(cp)){
   summary.sessionId=cp.sessionId;summary.checkpoint=join(nativeDirectory,'latest-session.json');
   summary.events=join(nativeDirectory,`session-${cp.sessionId}.jsonl`);
   summary.advice=compactAdvice(cp.state?.adviceExecution);
   summary.finalState=compactState(cp.state);
   summary.resources={start:firstState?.resources,current:summary.finalState.resources};
   summary.cleanup={paused:cp.cleanup?.paused===true||cp.cleanup?.pauseConfirmed===true,
    handoffConfirmed:confirmedCountryAIHandoff(cp.cleanup?.countryAI),countryAI:compactControl(cp.cleanup?.countryAI),
    error:cp.cleanup?.error??cp.cleanup?.bindingError??null};
   summary.returned=cp.stopped===true&&summary.cleanup.paused&&summary.cleanup.handoffConfirmed;
   summary.countryAI=compactControl(cp.countryAIControl??cp.state?.countryAIControl);
   summary.date=cp.cleanup?.date??cp.state?.date;summary.paused=summary.cleanup.paused;
  }else summary.returned=child?false:null;
  summary.ended=Date.now();summary.remainingSeconds=0;
  summary.stage=summary.returned?'finished':child?'handoff_unconfirmed':'not_started';
  summary.modServiceAttribution='本轮只记录原生行为与资源趋势；Mod服务须以现有游戏日志或实际存档字段确认，不能由命令计数推断。';
  summary.gameplayOutcomeComplete=false;
  await persist();
  print({stage:summary.stage,directory,requests:summary.requests,returned:summary.returned,error:summary.error});
  if(child&&(summary.exitCode!==0||!summary.returned))process.exitCode=1;
 }
}

async function assertNoController(){
 const lock=await readJson(join(nativeDirectory,'controller.lock'));
 if(!lock)return;
 if(!Number.isSafeInteger(lock.pid)||lock.pid<=0)throw Error('控制器锁身份未知，拒绝另启控制器。');
 try{process.kill(lock.pid,0);}catch(error){if(error.code==='ESRCH')return;throw Error('无法核对现有控制器，拒绝另启。');}
 throw Error('游戏控制器仍在运行；本轮不覆盖现有控制权。');
}

async function readPreflight(){
 const pipe=new NativePipe({beforeWrite:method=>{
  if(!['get_status','get_galaxy_overview','get_government','get_country_ai_state'].includes(method))throw Error('启动核对只允许只读接口。');
 }});
 try{
  const status=await pipe.request('get_status'),world=await pipe.request('get_galaxy_overview');
  const government=await pipe.request('get_government'),native=await pipe.request('get_country_ai_state');
  const player=world.player,authority=government.authority??government.authority_key;
  if(status.in_game!==true||status.is_paused!==true||!/^2200\.\d{2}\.\d{2}$/.test(status.date?.formatted??''))throw Error('需要用户手动载入2200年存档并保持暂停；不会自动读档。');
  if(authority!=='auth_hive_mind')throw Error('当前政体不是本轮指定蜂巢帝国，未开始验收。');
  if(native.success!==true||native.single_local_human_guard!==true||native.world_generation_tracking!==true||
   !Number.isSafeInteger(player?.country_id)||native.precondition?.country_id!==player.country_id||
   native.global_flags?.human_ai!==false||native.global_flags?.force_human_ai!==false)throw Error('当前本国身份或原生AI关闭状态未确认，未开始验收。');
  return {date:status.date.formatted,paused:true,countryId:player.country_id,capitalSystemId:player.capital_system_id,
   authority,worldGeneration:native.precondition.world_generation};
 }finally{pipe.close();}
}

function compactControl(c){return c?{owner:c.owner,phase:c.phase,nativePhase:c.nativePhase,paused:c.paused,
 ordinaryOrdersBlocked:c.ordinaryOrdersBlocked,actualFlags:c.actualFlags,reservedPolicy:c.reservedPolicy,
 commandCounts:c.commandCounts,coverageFaults:c.coverageFaults,confirmed:c.confirmed}:null;}
function compactAdvice(a){return {gameSessionId:a?.gameSessionId??null,tasks:(a?.tasks??[]).map(t=>({id:t.id,source:t.source,
 suggestionId:t.suggestionId,status:t.status,reason:t.reason,evidence:t.evidence,date:t.date}))};}
function compactState(s={}){
 const resources={};for(const key of ['unity','energy','minerals','food','alloys','physics_research','society_research','engineering_research']){
  const r=s.resources?.[key];if(r)resources[key]={stockpile:r.stockpile_known===false?null:r.stockpile,
   net:r.net_known===false?null:r.net,netKnown:r.net_known!==false};
 }
 return {date:s.date,paused:s.paused,player:s.player,resources,research:s.research,
  colonyCount:Array.isArray(s.colonies)?s.colonies.length:null,strategyExecution:s.strategyExecution};
}

function acceptanceBrief(){return `本轮是一次合并实机验收，最多8分钟且本runner的DeepSeek请求合计最多12次。先observe与country_ai_control status，核对当前2200年、auth_hive_mind蜂巢、本国country_id与首都、暂停和本次gameSessionId；不符合就停止，不自行读档。只使用现有群星接口，禁止桌面键鼠、开游戏、重启、载档、控制台、窗口展示与镜头定位。presentation关闭，速度最多3，开始保持暂停供核对。
核对后提交strategy_contract：economyFocus=unity_traditions、expansionStance=consolidate、militaryStance=peaceful、oneOffActions=[]；不设固定600月产、年份或帝国规模硬上限。本人常驻要求优先，按实际资源风险自主巩固已有殖民地、提高凝聚力净产与传统推进。国家AI使用full_with_reserved，maxWallSeconds不越过本轮剩余授权时间；正常原生经营必须保持运行。需要继续时用continue或watch长窗口，不能反复takeover抢日常操作；只在中央事件、真实危机或结束时收权。
先复用observe与operationalFacts已有事实，必要时一次inspect edicts/government或有具体瓶颈的己方planet候选，不重复查同一候选。普通建设、科研、造船、岗位、扩张与舰队交给原生AI，不亲自派日常微操。本轮不宣战、不发外交提案、不为验收乱关法令或乱换议程；已有合理设置保留。只有确有经营收益、本人或被采纳建议要求、合法候选和完整回读条件时才经strategy_contract执行具体保留内政。未知结果不换requestId重发。
读取state.adviceExecution逐条核对当局任务，用strategy_contract关联真实taskIds；无法处理的用taskUpdates标记blocked并写真实原因。模型不能自报succeeded，切换方针不等于完成凝聚力增长；未产生当局任务如实报告未收到，不编造观众弹幕。持续目标需看实际净产趋势及后续结果；具体法令/议程要真实回读，能力缺口明说。AI中控的参谋与观众任务以真实当前会话为准，旧会话不重放。
观察一段正常建设队列、科研进展、原生命令计数与资源净产趋势；本国Mod服务只有日志或实际存档字段可证时才确认，不以Mod启用、方针切换或原生命令计数冒充Mod效果。无新决策就watch，不为凑验收操作。期间复用当前strategyExecution与adviceExecution回执，简述改善、受阻原因及下一步；不把几分钟趋势当作长期经营达标。收到停止、时限或请求上限必须停止新操作，由NativeGame正常cleanup暂停、关闭国家AI并回读归还本人；以真实清理结果为准。`;}
