import {surveyWatchWindow} from '../src/survey-watch-window.mjs';
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';import {createHash} from 'node:crypto';import {join,resolve} from 'node:path';
import {NativeGame} from '../src/native-game.mjs';import {NativePipe} from '../src/native-pipe.mjs';
import {fixedSurveyCohort} from '../src/survey-benchmark-cohort.mjs';
import {normalWorkEvidence} from '../src/normal-hybrid-benchmark.mjs';
import {nativeBridgePath} from '../src/native-bootstrap.mjs';
import {analyzeControlEvidence} from '../src/control-evidence.mjs';
const args=process.argv.slice(2),value=k=>args.includes(k)?args[args.indexOf(k)+1]:undefined;
const cohortJumps=value('--cohort-jumps')===undefined?null:Number(value('--cohort-jumps'));if(cohortJumps!==null&&(!Number.isInteger(cohortJumps)||cohortJumps<1||cohortJumps>6))throw Error('统计半径需要1..6跳');
const normal=args.includes('--normal');if(normal&&cohortJumps===null)throw Error('普通经营对照需要预先声明 --cohort-jumps 1..6');
const allowInitialReclaim=args.includes('--allow-initial-reclaim');
const hybridWatchSeconds=surveyWatchWindow(Number(value('--native-watch')??60));
const mode=value('--mode');if(!['baseline','hybrid'].includes(mode))throw Error('需要 --mode baseline|hybrid');
const initial=JSON.parse(await readFile('.local/hybrid-control/benchmark-initial/manifest.json','utf8'));
const loadedSave=resolve(value('--loaded-save')||'C:/Users/YDD/Documents/Paradox Interactive/Stellaris/save games/4_-1439839595/cyberfish_hybrid_baseline_2202.07.01.sav');
const digest=createHash('sha256').update(await readFile(loadedSave)).digest('hex');if(digest!==initial.sha256)throw Error('指定初始存档哈希不符');
const directory=resolve('.local/hybrid-control',`benchmark-${mode}-${Date.now()}`);await mkdir(directory,{recursive:true});
const legacyRevisionFiles=['src/native-game.mjs','src/native-pipe.mjs','src/checkpoint-replace.mjs','src/decision-review.mjs','src/candidate-feedback.mjs','src/monthly-trade-accounting.mjs','src/monthly-trade-changes.mjs','src/monthly-trade-execution.mjs','src/monthly-trade-lifecycle.mjs','src/monthly-trade-recovery.mjs','src/shared-spending-guard.mjs','src/local-work-wait.mjs','src/colony-routine.mjs','src/colony-upgrade-routine.mjs','src/native-bootstrap.mjs','src/bridge-capabilities.mjs','src/gestalt-tasks.mjs','src/order-input-schema.mjs','src/model-view.mjs','src/game-checkpoint.mjs','src/runtime-continuation.mjs','src/dsh-host-stop.mjs','src/cooperative-stop.mjs','src/live-model-budget.mjs','src/native-mcp.mjs','src/survey-watch-window.mjs','src/dsh-mcp-environment.mjs','scripts/play-native-dsh.mjs','scripts/run-hybrid-live.mjs','scripts/run-survey-benchmark.mjs','src/survey-benchmark-cohort.mjs','src/survey-benchmark.mjs','src/control-evidence.mjs','plugins/stellaris-dsh/cordis.patch.yml','plugins/stellaris-dsh/game-compaction.mjs'];
const revisionFiles=normal?[...(await readdir('src')).filter(x=>x.endsWith('.mjs')).map(x=>'src/'+x),'scripts/play-native-dsh.mjs','scripts/run-hybrid-live.mjs','scripts/run-survey-benchmark.mjs','native/research/load_native_bridge.py','plugins/stellaris-dsh/cordis.patch.yml','plugins/stellaris-dsh/game-compaction.mjs',nativeBridgePath()].sort():legacyRevisionFiles;
async function revisionDigest(){const hash=createHash('sha256');for(const file of revisionFiles){hash.update(file);hash.update(await readFile(file));}return hash.digest('hex');}
const adapterRevision=await revisionDigest();
const spec={version:normal?3:cohortJumps===null?1:2,comparisonProtocol:normal?'normal_production_v3':'single_ship_legacy',allowInitialReclaim,coverage:cohortJumps===null?'initial_candidates_v1':'fixed_capital_radius_v2',cohortJumps,hybridWatchSeconds,nativeWatchSeconds:mode==='hybrid'?hybridWatchSeconds:normal?60:20,adapterRevision,mode,loadedSave,initialSaveSha256:digest,initialDate:initial.date,minutes:10,maxRequests:80,speed:2,model:'deepseek-flash',scope:normal?'normal_hybrid_gameplay':'single_science_ship',colonyUpgradePilot:normal,monthlyLifecyclePilot:normal,localWaitPilot:normal,worldLineageVerified:false,
 limitations:['文件哈希验证不等于证明游戏加载了该文件；需要操作者手动加载确认，并由实时会话核对日期、玩家和首都。','两组必须分别重载同一文件；随机事件及模型缓存差异需要记录，单轮结果不外推为长期效率。']};
await writeFile(join(directory,'spec.json'),JSON.stringify(spec,null,2));
if(!args.includes('--execute')){console.log(JSON.stringify({stage:'prepared_only',directory,spec,realModelCalls:0}));process.exit(0);}
// This entry never loads or restarts a world. Invoke only after the operator has
// loaded this exact file and paused; all readbacks below must still agree.
const game=new NativeGame({directory:join(directory,'preflight'),minutes:2,hybridSurvey:true,presentOrders:false});
const evidence={spec,directory};
try{
 const state=await game.start({keepPaused:true});evidence.initialState=state;
 if(state.date!==initial.date||state.player.country_id!==0||state.player.capital_system_id!==1||!state.paused||state.pendingEvents.length||state.wars.length)throw Error('实时会话不符合已暂停的初始对照档；拒绝开始付费运行');
 const ship=state.civilian.science_ships.find(x=>x.fleet_id===1);if(!Number.isSafeInteger(ship?.leader_id)||ship.leader_id<0||ship.leader_id>=0xffffffff)throw Error('初始科研船或科学官不符');
 const current=await game.rpc('get_fleet_automation',{fleet_id:1});
 if(current.known!==true||current.order_chain_complete!==true||typeof current.automation_enabled!=='boolean'||!Array.isArray(current.orders))throw Error('初始科研船控制权未知，拒绝收回');
 if(current.automation_enabled){if(!allowInitialReclaim)throw Error('原生调查正在执行；仅显式授权本轮收回时才使用 --allow-initial-reclaim');evidence.reclaimed=await game.surveyControl({operation:'recover',fleetId:1,snapshotId:game.snapshotId});}
 const off=await game.rpc('get_fleet_automation',{fleet_id:1});if(off.known!==true||off.automation_enabled!==false||off.orders.length)throw Error('两组统一收权未确认');
 evidence.speed=await game.apply({requestId:'matched-speed-two',snapshotId:game.snapshotId,orders:[{command:'set_speed',arguments:{speed:2}}]});
 const ready=await game.observe();evidence.readyState=ready;if(ready.date!==initial.date||!ready.paused||ready.speed!==2)throw Error('统一准备后初始时间/速度不符');
 let targetIds;
 if(cohortJumps===null){const candidates=await game.inspect({topic:'expansion',purpose:'unsurveyed',fleet_id:1});targetIds=(candidates.systems||[]).map(x=>x.id);}
 else{evidence.initialCohortMap=await game.rpc('get_galaxy_map',{center_system_id:ready.player.capital_system_id,jumps:cohortJumps});targetIds=fixedSurveyCohort(evidence.initialCohortMap,{centerSystemId:ready.player.capital_system_id,jumps:cohortJumps});}
 evidence.trackedSystems=[];
 for(const id of targetIds)evidence.trackedSystems.push({id,before:await game.rpc('get_system',{system_id:id})});
 evidence.preflightPassed=true;
}catch(error){evidence.error=error.message;process.exitCode=1;}
finally{await game.stop();evidence.preflightCleanup=game.cleanup;game.pipe.close();await writeFile(join(directory,'evidence.json'),JSON.stringify(evidence,null,2));}
if(!evidence.preflightPassed||evidence.preflightCleanup?.paused!==true)throw Error(evidence.error||'初始清理未确认');
let pending='',pilotDirectory;
const child=spawn(process.execPath,['scripts/run-hybrid-live.mjs',...normal?['--normal']:[],'--execute'],{windowsHide:true,stdio:['ignore','pipe','inherit'],env:{...process.env,CYBERFISH_PILOT_MODE:mode,CYBERFISH_SURVEY_WATCH_SECONDS:String(hybridWatchSeconds),CYBERFISH_SURVEY_REUSE_STATE:cohortJumps===null?'0':'1',CYBERFISH_PILOT_MINUTES:'10',CYBERFISH_PILOT_REQUESTS:'80'}});
child.stdout.on('data',b=>{process.stdout.write(b);pending+=b.toString();let end;while((end=pending.indexOf('\n'))>=0){const line=pending.slice(0,end);pending=pending.slice(end+1);try{const x=JSON.parse(line);if(x.stage==='pilot_started')pilotDirectory=x.directory;}catch{}}});
evidence.exitCode=await new Promise((done,fail)=>{child.once('exit',done);child.once('error',fail);});evidence.pilotDirectory=pilotDirectory;
if(pilotDirectory)try{const r=JSON.parse(await readFile(join(pilotDirectory,'report.json'),'utf8'));evidence.run={started:r.started,ended:r.ended,stopReason:r.stopReason,modelRequests:r.model?.forwardedRequests,usage:r.model?.usage};evidence.fullTimedBranch=r.stopReason===(normal?'normal_hybrid_deadline':'pilot_deadline')&&r.ended-r.started>=10*60000;}catch(error){evidence.runReportError=error.message;}
if(pilotDirectory&&evidence.run)try{const r=JSON.parse(await readFile(join(pilotDirectory,'report.json'),'utf8'));evidence.run.requestedModels=r.model?.requestedModels;evidence.run.serverModels=r.model?.serverModels;}catch{}
if(pilotDirectory)try{const cp=JSON.parse(await readFile(join(pilotDirectory,'native/latest-session.json'),'utf8')),journal=(await readFile(join(pilotDirectory,'native',`session-${cp.sessionId}.jsonl`),'utf8')).trim().split('\n').map(JSON.parse);evidence.run.controlEvidence=analyzeControlEvidence(journal);evidence.run.actualMode=evidence.run.controlEvidence.mode;if(normal){const ledger=JSON.parse(await readFile(join(pilotDirectory,'native',`orders-${cp.sessionId}.json`),'utf8'));evidence.normalWork=normalWorkEvidence(journal,ledger);}}catch(error){evidence.journalError=error.message;}
const pipe=new NativePipe();
try{
 evidence.finalStatus=await pipe.request('get_status');if(evidence.finalStatus.is_paused!==true)throw Error('对照结束未确认暂停');
 evidence.finalAutomation=await pipe.request('get_fleet_automation',{fleet_id:1});evidence.stopConfirmed=evidence.finalAutomation.known===true&&evidence.finalAutomation.order_chain_complete===true&&evidence.finalAutomation.automation_enabled===false;
 for(const target of evidence.trackedSystems)target.after=await pipe.request('get_system',{system_id:target.id});
 evidence.completedTrackedSystems=evidence.trackedSystems.filter(x=>x.before.surveyed===false&&x.after.surveyed===true).map(x=>x.id);
 if(normal){evidence.sourceEndRevision=await revisionDigest();evidence.sourceUnchanged=evidence.sourceEndRevision===adapterRevision;}
 evidence.workCoverage='only the identical predeclared initial cohort; no claim about untracked systems';
}catch(error){evidence.finalError=error.message;}finally{pipe.close();await writeFile(join(directory,'evidence.json'),JSON.stringify(evidence,null,2));}
console.log(JSON.stringify({stage:'benchmark_branch_finished',directory,pilotDirectory,mode,completedTrackedSystems:evidence.completedTrackedSystems,error:evidence.finalError,efficiencyCompared:false}));
