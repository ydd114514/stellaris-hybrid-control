import {cleanupNativeCountryAI,assertNativeCountryScope} from './native-country-ai-cleanup.mjs';
import {rpcEvidenceCategory} from './control-evidence.mjs';
import {readFile,writeFile,rename} from 'node:fs/promises';
import {resolve,dirname,basename} from 'node:path';
import {surveyEnableUnconfirmed} from './survey-delegation.mjs';
import {MonthlyTradeExecution} from './monthly-trade-execution.mjs';
import {cleanupRecoveredMonthlyRecords,monthlyRecoveryCandidates} from './monthly-trade-recovery.mjs';
import {surveyGameDay} from './survey-idle-policy.mjs';

// Runs only after the controlled child has exited. Never resumes gameplay.
export async function supervisorCleanup({directory,started,rpc,identity,boundIdentity,connectionEpoch,release,runId}){
 const result={paused:false,survey:[],scope:'checkpoint_session_delegations',worldLineageVerified:false};
 let checkpoint,checkpointOwned=false;
 try{
  checkpoint=JSON.parse(await readFile(resolve(directory,'latest-session.json'),'utf8'));
  if(!Number.isFinite(checkpoint.started)||checkpoint.started<started||typeof checkpoint.sessionId!=='string')throw Error('控制器记录不属于本轮');
  if(runId!==undefined&&checkpoint.controllerRunId!==runId)throw Error('控制器运行代次不匹配');
  checkpointOwned=true;
  if(!checkpoint.taskStateFile)throw Error('缺少持久任务路径，无法核对旧会话清理范围');
  const file=resolve(checkpoint.taskStateFile);
  if(dirname(file)!==resolve(directory)||!/^gestalt-[a-f0-9]{24}\.json$/.test(basename(file)))throw Error('持久任务路径超出本控制目录');
  const state=JSON.parse(await readFile(file,'utf8'));
  const nativeControl=checkpoint.countryAIControl??checkpoint.state?.countryAIControl;
  const nativeMode=nativeControl?.enabled===true;
  const nativeScope=nativeControl?.worldScope;
  // Identity inspection briefly opens the single-instance pipe itself.
  // Validate the recorded process before any mutation, including pause.
  // Release any idle connection before the independent identity inspection.
  await release?.();
  const current=await identity();
  if(!checkpoint.binding||current.pid!==checkpoint.binding.pid||current.creationTime!==checkpoint.binding.creationTime)throw Error('游戏进程绑定改变');
  const world=await rpc('get_galaxy_overview');
  const status=await rpc('get_status');
  const player=checkpoint.state?.player;
  let observedDay=surveyGameDay(checkpoint.state?.date);
  const assertWorld=(s,w)=>{
   const day=surveyGameDay(s.date?.formatted);
   if(!player||s.in_game!==true||w.player?.country_id!==player.country_id||w.player?.capital_system_id!==player.capital_system_id||observedDay===null||day===null||day<observedDay)throw Error('当前帝国或日期与控制记录不符');
   observedDay=day;
  };
  assertWorld(status,world);
  const identityComponents=[current.pid,current.creationTime,player.country_id,player.capital_system_id];
  if(Number.isSafeInteger(checkpoint.state?.nativeWorldGeneration))identityComponents.push(checkpoint.state.nativeWorldGeneration);
  const expected=JSON.stringify(identityComponents);
  if(state.version!==1||state.identity!==expected)throw Error('持久任务身份不匹配');
  const request=rpc;
  const verifyProcess=async()=>{
   let actual;
   if(boundIdentity)actual=await boundIdentity(current);
   else {await release?.();actual=await identity();}
   if(actual.pid!==current.pid||actual.creationTime!==current.creationTime)throw Error('清理前游戏进程绑定改变');
   try{const lock=JSON.parse(await readFile(resolve(directory,'controller.lock'),'utf8'));
    if(lock.sessionId!==checkpoint.sessionId)throw Error('已有其他控制器取得会话锁，不清理其游戏');
   }catch(error){if(error.code!=='ENOENT')throw error;}
  };
  rpc=async(method,params={})=>{
   const write=rpcEvidenceCategory(method,params)!=='read';
    let context;
   if(write){
    if(!(method==='set_paused'&&params.paused===true||method==='set_survey_automation'&&params.enabled===false||method==='set_monthly_trade'&&params.cancel===true||nativeMode&&method==='country_ai_lease'&&params.action==='stop'))throw Error('监督器只允许暂停和已授权收权，不创建游戏任务');
   }
   if(write||['get_fleet_automation','get_market'].includes(method)){
    const s=await request('get_status'),epoch=connectionEpoch?.();
    await verifyProcess();
    const w=await request('get_galaxy_overview');assertWorld(s,w);
    if(epoch!==undefined&&epoch!==connectionEpoch())throw Error('监督器核对期间桥连接更换');
    if(method!=='set_paused'&&s.is_paused!==true)throw Error('监督器收权前未确认暂停');
    if(nativeMode){
     const native=await request('get_country_ai_state');assertNativeCountryScope(native,nativeScope);
     result.worldLineageVerified=true;
     params={...params,_expected_world_generation:nativeScope.world_generation,_expected_game_pid:current.pid,_expected_game_creation:current.creationTime};
    }
    context={supervisorCleanup:true,connectionEpoch:epoch};
   }
   return request(method,params,context);
  };
  await rpc('set_paused',{paused:true});
  const paused=await rpc('get_status');assertWorld(paused,await rpc('get_galaxy_overview'));
  result.paused=paused.is_paused===true;result.date=paused.date?.formatted;
  if(!result.paused)throw Error('监督器未能确认暂停，不继续清理');
  result.bindingConfirmed=true;
  if(nativeMode){
   try{result.countryAI=await cleanupNativeCountryAI({rpc,expectedScope:nativeScope,expectedGeneration:nativeControl.generation});}
   catch(error){result.countryAI={confirmed:false,owner:'unconfirmed',ordinaryOrdersBlocked:true,error:error.message};throw error;}
  }
  const records=Object.values(state.surveyControl?.records||{}).filter(r=>r.sessionId===checkpoint.sessionId&&r.owner!=='manual');
  if(records.length>64)throw Error('待核对科研船超出上限');
  const save=async()=>{await writeFile(file+'.tmp',JSON.stringify(state,null,2));await rename(file+'.tmp',file);};
  const monthly=new MonthlyTradeExecution({store:()=>state.monthlyTrades??=[],save,rpc,sessionId:checkpoint.sessionId,snapshot:async()=>{
   const s=await rpc('get_status'),w=await rpc('get_galaxy_overview');
   assertWorld(s,w);if(s.is_paused!==true)throw Error('月度清理的暂停、日期或帝国身份已变化');
   return {status:s,market:await rpc('get_market'),countryId:player.country_id,scope:{sessionId:checkpoint.sessionId,pid:current.pid,creationTime:current.creationTime,gameDate:s.date.formatted}};
  }});
  result.monthlyTrade=await monthly.cleanup();
  result.monthlyTrade.recovered=await cleanupRecoveredMonthlyRecords({records:state.monthlyTrades||[],sessionId:checkpoint.sessionId,save,rpc,snapshot:monthly.snapshot});
  if(!result.monthlyTrade.recovered.confirmed)result.monthlyTrade.confirmed=false;
  for(const r of [...(state.colonyRoutines||[]),...(state.colonyUpgradeRoutines||[])])if(r.sessionId===checkpoint.sessionId&&['active','waiting','blocked','paused'].includes(r.status)){
   r.status='stopped';r.reason='监督器停止本地派发，已排队施工保留';
   for(const a of r.actions||[]){const task=state.tasks?.find(t=>t.id===a.taskId);if(task&&!state.actions?.some(row=>row.taskId===task.id)&&['ready','waiting'].includes(task.status))task.status='cancelled';}
  }
  await save();result.colonyControl={mode:'local_housing_scheduler',stopped:true,queuedWorkCancelled:false};
  for(const r of records){
   if(!Number.isSafeInteger(r.fleetId)||r.fleetId<0||r.fleetId>=0xffffffff)throw Error('持久记录的科研船ID无效');
   let observed;
   try{
    r.enableUnconfirmed=surveyEnableUnconfirmed(r);r.owner='unknown';r.pending=true;r.desired=false;await save();
    observed=await rpc('get_fleet_automation',{fleet_id:r.fleetId});
    if(observed?.known===true&&observed.automation_enabled===true){
     r.enableUnconfirmed=false;
     await rpc('set_survey_automation',{fleet_id:r.fleetId,enabled:false,execute:true});
     observed=await rpc('get_fleet_automation',{fleet_id:r.fleetId});
    }
    const confirmed=observed?.known===true&&observed.order_chain_complete===true&&observed.automation_enabled===false&&!r.enableUnconfirmed;
    r.owner=confirmed?'manual':'unknown';r.pending=!confirmed;r.observation=observed;
    result.survey.push({fleetId:r.fleetId,confirmed});
   }catch(error){r.owner='unknown';r.pending=true;r.error=error.message;result.survey.push({fleetId:r.fleetId,confirmed:false,error:error.message});}
   await save();
  }
  result.surveyStatus=result.survey.every(r=>r.confirmed)?'confirmed':'unknown';
  await verifyProcess();const final=await rpc('get_status'),finalEpoch=connectionEpoch?.();assertWorld(final,await rpc('get_galaxy_overview'));await verifyProcess();if(finalEpoch!==undefined&&finalEpoch!==connectionEpoch())throw Error('监督器最终回读期间桥连接更换');result.paused=final.is_paused===true;result.date=final.date?.formatted;
  if(nativeMode)result.countryAI=await cleanupNativeCountryAI({rpc,expectedScope:nativeScope,expectedGeneration:undefined,attempts:1});
  const checkpointFile=resolve(directory,'latest-session.json');
  const latest=JSON.parse(await readFile(checkpointFile,'utf8'));
  if(latest.sessionId===checkpoint.sessionId&&latest.controllerRunId===checkpoint.controllerRunId){
   latest.stopped=true;latest.stopReason='监督器退出清理';latest.cleanup={...result,checkpointUpdated:true};
   latest.runtimeStatus={sessionId:checkpoint.sessionId,observedAt:Date.now(),paused:result.paused,date:result.date??null};
   if(nativeMode)latest.countryAIControl={...nativeControl,...result.countryAI,worldScope:nativeScope};
   latest.state={...latest.state,...(nativeMode?{countryAIControl:{enabled:true,...result.countryAI}}:{}),paused:result.paused,surveyControl:state.surveyControl,monthlyControl:{...monthly.view(),recovery:monthlyRecoveryCandidates(state.monthlyTrades||[],checkpoint.sessionId)},
    colonyControl:{...latest.state?.colonyControl,mode:'local_housing_scheduler',nativeAutomation:false,records:(state.colonyRoutines||[]).slice(-8),queuedWorkCancelled:false},
    colonyUpgradeControl:{...latest.state?.colonyUpgradeControl,mode:'local_building_upgrade_scheduler',nativeAutomation:false,records:(state.colonyUpgradeRoutines||[]).slice(-8),queuedWorkCancelled:false}};
   await writeFile(checkpointFile+'.supervisor.tmp',JSON.stringify(latest,null,2));
   await rename(checkpointFile+'.supervisor.tmp',checkpointFile);result.checkpointUpdated=true;
  }else result.checkpointUpdated=false;
 }catch(error){
  result.error=error.message;result.surveyStatus='unknown';result.bindingConfirmed=false;result.worldLineageVerified=false;result.paused=false;result.pauseStateUnknown=true;if(result.monthlyTrade)result.monthlyTrade.confirmed=false;
  if(checkpointOwned)try{
   const file=resolve(directory,'latest-session.json'),latest=JSON.parse(await readFile(file,'utf8'));
   if(latest.sessionId===checkpoint.sessionId&&latest.controllerRunId===checkpoint.controllerRunId&&latest.started===checkpoint.started){
    latest.stopped=true;latest.stopReason='监督器清理未确认';latest.cleanup={...result,checkpointUpdated:true};
    latest.runtimeStatus={sessionId:checkpoint.sessionId,observedAt:Date.now(),paused:null,date:null,scopeUnknown:true};
    await writeFile(file+'.supervisor.tmp',JSON.stringify(latest,null,2));await rename(file+'.supervisor.tmp',file);result.checkpointUpdated=true;
   }else result.checkpointUpdated=false;
  }catch(updateError){result.checkpointError=updateError.message;}
 }
 return result;
}
