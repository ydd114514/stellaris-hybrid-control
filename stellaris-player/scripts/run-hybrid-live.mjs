import {createHash} from 'node:crypto';
import {nativeBridgePath} from '../src/native-bootstrap.mjs';
import {surveyWatchWindow} from '../src/survey-watch-window.mjs';
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,appendFile,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {longRunProfile,assessLongRun,liveRunFeatureEnvironment} from '../src/long-run-evidence.mjs';
import {analyzeControlEvidence} from '../src/control-evidence.mjs';
import {createLiveModelBudget} from '../src/live-model-budget.mjs';
// A bounded technical pilot. It is not the matched-save performance benchmark.
const conquestRun=process.argv.includes('--conquest');
const execute=process.argv.includes('--execute'),longRun=process.argv.includes('--long-run'),normalHybrid=longRun||conquestRun||process.argv.includes('--normal');
const mode=process.env.CYBERFISH_PILOT_MODE||'hybrid';if(!['baseline','hybrid'].includes(mode))throw Error('试验模式仅支持baseline/hybrid');
const minutes=Number(process.env.CYBERFISH_PILOT_MINUTES||(longRun?30:conquestRun?20:10)),maxRequests=Number(process.env.CYBERFISH_PILOT_REQUESTS||(longRun||conquestRun?200:40));
if(process.env.CYBERFISH_SURVEY_REUSE_STATE!==undefined&&!['0','1'].includes(process.env.CYBERFISH_SURVEY_REUSE_STATE))throw Error('状态复用试验配置必须为0或1');
const surveyWatchSeconds=surveyWatchWindow(Number(process.env.CYBERFISH_SURVEY_WATCH_SECONDS??60)),reuseState=process.env.CYBERFISH_SURVEY_REUSE_STATE==='1';
const longProfile=longRun?longRunProfile({minutes,maxRequests}):null;
const featureEnvironment=liveRunFeatureEnvironment({longRun:normalHybrid});
if(conquestRun&&(longRun||mode!=='hybrid'))throw Error('征服验收使用独立普通混合模式，不与长测或人工基线混用');
if(longRun&&mode!=='hybrid')throw Error('连续长测仅支持hybrid模式');
if(!longRun&&(!Number.isFinite(minutes)||minutes<=0||minutes>20))throw Error('试点时长需要0..20分钟');
const started=Date.now(),directory=resolve('.local/hybrid-control',`dsh-live-${started}`),nativeDirectory=join(directory,'native');
await mkdir(nativeDirectory,{recursive:true});
let stopping=false,stopReason,timer,child,deadline;
const stop=async reason=>{if(stopping)return;stopping=true;stopReason=reason;proxy.seal();await writeFile(resolve('.local/STOP'),`hybrid_live: ${reason}`);};
const proxy=await createLiveModelBudget({directory,maxRequests,onLimit:()=>void stop('model_request_limit')});
try {
 let patch=await readFile('plugins/stellaris-dsh/cordis.patch.yml','utf8');
 patch=patch.replace('    thinking: disabled',`    baseURL: '${proxy.baseURL}'\n    retryPolicy:\n      mode: normal\n      maxRetries: 0\n    thinking: disabled`);
 const shared='先observe核对当前日期、会话、中央事件、科研与储备；处理当前中央事件后正常set_speed(speed=2)，本轮不再加速。不要发动战争、扩军、市场交易、殖民地自动化或新建设；保留已有施工、科研、经济和舰队。不能使用控制台或改资源。禁止窗口展示与镜头定位。科研空缺和中央事件由你处理。结束以控制器真实停止为准，不把提交、待命或技术试点说成效率提升。';
 let brief=mode==='hybrid'?'本轮唯一主任务是原生自动调查混合控制技术试点。'+shared+'inspect survey_control和expansion可同轮查询；确认有科学官且空闲的科研船、已探索且可达的调查目标后delegate。未探索候选先由你选安全方向正常航行，实际抵达且订单清空后再核对委派，不暗中开启explore。让原生AI选后续调查目标，不用手动survey替代，也不覆盖原生订单。本地只因科研/传统/议程暂停时会保留原生控制，不必重新委派。无新决策且原生确有子任务时watch 60秒；没工作时最多20秒并诊断，不重复空等。unknown先reconcile，旧会话先recover。':'本轮唯一主任务是单科研船人工调查基线。'+shared+'调查自动化关闭，不能delegate。inspect expansion(purpose=unsurveyed,fleet_id=科研船)查实际合法目标和路线；空闲时用正常survey调查一个安全目标，不覆盖执行中的订单，等完成后再选下一处。调查、科研与当前生产持续推进，有事处理，无事watch 20秒；不要反复查询不变的候选。';
 if(normalHybrid)brief=(longRun?'本轮是正常混合经营连续长测，':'本轮是正常混合经营定向验证，')+'须保持同一控制器会话，不能将停止重启后的时长拼接。正常科研、建设、生产、扩张与现有战役仍依真实战略和预算执行；调查按当前会话控制模式执行；混合模式优先委派原生，需要改变调查方向时先正常收权，确认后调整目标再委派。仅据真实结果说明多项工作同期推进与主动干预，不为凑验收虚构动作。禁止控制台、改资源、桌面输入和窗口定位。速度最多2，不能加速压缩测试。预算住房、预算升级、月度库存/期限条件和可信施工等待已交付，可按真实需求与预算使用；原生整星球AI仍不开放，不为凑测试强行建设或交易。';
 if(normalHybrid&&mode==='baseline')brief+='本轮为相同经营权限的人工调查基线：调查自动化保持关闭，不能delegate；空闲科研船由你依据真实候选正常survey，不覆盖有效订单。其他建设、生产、决策和本地等待能力与混合组相同。';
 if(conquestRun)brief+='本轮主要验收主动选敌、具体备战、真实战斗/占领、议和后的实际领土收益、战后恢复与下一目标评估。先检查strategy.conquest并推进campaign；资源富余时不要长期只做内政。不能靠运行时长或posted冒称战果，也不为凑验收攻击无收益目标；未知敌情、预算、路线和合法条件先核对。已有战役先持续推进，若测试条件不足给出具体缺口。';
 if(mode==='hybrid')brief=brief.replace('watch 60秒','watch '+surveyWatchSeconds+'秒');
 if(reuseState)brief+='先读返回的decisionReview，原生工作与事件数量已在本次回读确认时不要再补查同一事实；它不是绕过实时安全检查的授权。优先复用刚返回state中的控制权、科研、内阁和事件信息，只有缺字段、局势变化或unknown时才补查。已确认native且有真实子任务时直接watch，不重复inspect/reconcile；交接未知仍须核对。启动议程只使用state.council.active_agenda且agenda_ready为true；可选议程不等于当前议程，拒绝后不要同参数重试。首次接触的选择与关闭说明按实际phase和新事件状态区分，不把合法后续步骤跳过。';
 const originalPatch=patch;
 if(!normalHybrid)patch=patch.replace(/    personaPrefix: \|-[\s\S]*?(?=\r?\n- id: tool-bash)/,'    personaPrefix: |-\n      你是大肥鱼，使用当前正常群星MCP工具验证单船混合调查。\n      '+brief+'\n      使用最新snapshotId和真实候选下单；posted不代表完成，未知结果不重发。按surveyControl确认控制者，原生工作不能用手动订单覆盖。apply_orders说明用简短第一人称中文，不讲内部编号。\n      本轮运行器只允许科研选择、事件选择、正常航行、回避姿态、速度不超过2、传统与议程，不允许新的建设、市场、殖民或战争。已有施工保留；其他增长诊断与经营建议留待普通模式。只能根据实际原生子任务与结果报告进展，工具明确结束才收尾。');
 if(!normalHybrid&&patch===originalPatch)throw Error('未定位专用试验persona；拒绝带通用经营目标启动');
 if(mode==='baseline')patch=patch.replace('本轮运行器只允许科研选择','本轮人工基线另允许正常survey；本轮运行器只允许科研选择');
 let sourceFiles,sourceHashes;
 const hashes=async files=>Object.fromEntries(await Promise.all(files.map(async f=>[f,createHash('sha256').update(await readFile(f)).digest('hex')])));
 if(conquestRun){sourceFiles=[...(await readdir('src')).filter(f=>f.endsWith('.mjs')).map(f=>'src/'+f),...(await readdir('scripts')).filter(f=>f.endsWith('.mjs')).map(f=>'scripts/'+f),'plugins/stellaris-dsh/cordis.patch.yml','plugins/stellaris-dsh/game-compaction.mjs','native/research/load_native_bridge.py',nativeBridgePath()].sort();sourceHashes=await hashes(sourceFiles);await writeFile(join(directory,'source-start.json'),JSON.stringify({at:new Date().toISOString(),hashes:sourceHashes},null,2));}
 const patchFile=join(directory,'bounded.patch.yml');await writeFile(patchFile,patch);
 await writeFile(join(directory,'manifest.json'),JSON.stringify({started,minutes,maxRequests,mode,nativeDirectory,execute,surveyWatchSeconds,reuseState,conquestRun,scope:conquestRun?'normal hybrid proactive conquest; gameplay outcomes required, duration is only a ceiling':longRun?'normal hybrid continuous run; not overall acceptance':normalHybrid?'bounded normal hybrid verification; not long-run or matched benchmark':'DSH technical survey pilot; no matched benchmark',longProfile,featureEnvironment},null,2));
 if(!execute){console.log(JSON.stringify({stage:'prepared',directory,patchFile,realModelCalls:0}));}
 else {
  const env={...process.env,...featureEnvironment,CYBERFISH_DSH_PATCH:patchFile,CYBERFISH_DSH_HOME:join(directory,'dsh-home'),CYBERFISH_NATIVE_DIRECTORY:nativeDirectory,CYBERFISH_HYBRID_SURVEY:mode==='hybrid'?'1':'0',CYBERFISH_SURVEY_PILOT:normalHybrid?'0':'1',CYBERFISH_SURVEY_WATCH_SECONDS:String(surveyWatchSeconds),CYBERFISH_NATIVE_PRESENTATION:'0',CYBERFISH_START_PAUSED:'1',CYBERFISH_MAX_GAME_SPEED:'2',CYBERFISH_STOP_BASELINE:String(started),CYBERFISH_LIVE_BRIEF:brief};
  delete env.DEEPSEEK_API_KEY;delete env.ELECTRON_RUN_AS_NODE;
  child=spawn(process.execPath,['scripts/play-native-dsh.mjs',String(minutes)],{cwd:process.cwd(),env,windowsHide:true,stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',b=>{process.stdout.write(b);void appendFile(join(directory,'supervisor.jsonl'),b);});
  child.stderr.on('data',b=>void appendFile(join(directory,'supervisor.stderr.log'),b));
  let longDeadlineArmed=false;const sessionIds=new Set();
  timer=setInterval(async()=>{try{const c=JSON.parse(await readFile(join(nativeDirectory,'latest-session.json'),'utf8'));await writeFile(join(directory,'latest-evidence.json'),JSON.stringify(c,null,2));
   if(longRun&&c.sessionId){sessionIds.add(c.sessionId);if(!longDeadlineArmed&&Number.isFinite(c.started)&&c.started>=started&&c.ends-c.started===minutes*60000){longDeadlineArmed=true;clearTimeout(deadline);deadline=setTimeout(()=>void stop('long_run_deadline'),Math.max(0,c.ends-Date.now()));deadline.unref();}}
  }catch{}},2000);timer.unref();
  deadline=setTimeout(()=>void stop(longRun?'controller_start_timeout':conquestRun?'conquest_deadline':normalHybrid?'normal_hybrid_deadline':'pilot_deadline'),longRun?90000:minutes*60000);deadline.unref();
  process.once('SIGINT',()=>void stop('operator_stop'));process.once('SIGTERM',()=>void stop('operator_stop'));
  console.log(JSON.stringify({stage:'pilot_started',directory,minutes,maxRequests}));
  const code=await new Promise((done,fail)=>{child.once('exit',done);child.once('error',fail);});
  clearTimeout(deadline);clearInterval(timer);await proxy.close();
  try{const external=JSON.parse(await readFile(join(directory,'operator-stop.json'),'utf8'));stopReason??=external.reason;}catch{}
  await writeFile(join(directory,'report.json'),JSON.stringify({started,ended:Date.now(),minutes,maxRequests,stopReason,exitCode:code,model:proxy.report,performanceComparison:false},null,2));
  if(conquestRun){
   try{const end=await hashes(sourceFiles),changed=sourceFiles.filter(f=>sourceHashes[f]!==end[f]);await writeFile(join(directory,'source-verification.json'),JSON.stringify({files:sourceFiles.length,unchanged:changed.length===0,changed},null,2));}
   catch(error){await writeFile(join(directory,'source-verification.json'),JSON.stringify({unchanged:false,error:error.message}));}
   const assessment=spawn(process.execPath,['scripts/assess-conquest-run.mjs',directory],{windowsHide:true,stdio:['ignore','ignore','pipe'],env:{...process.env,DEEPSEEK_API_KEY:''}});
   let error='';assessment.stderr.on('data',b=>error+=b);await new Promise(done=>{assessment.once('error',e=>{error=e.message;done();});assessment.once('exit',done);});if(error)await writeFile(join(directory,'conquest-assessment-error.log'),error);
  }
  if(longRun){
   const report=JSON.parse(await readFile(join(directory,'report.json'),'utf8'));let checkpoint,controlEvidence,nativeStopRequestedAt,nativeStoppedAt;
   try{checkpoint=JSON.parse(await readFile(join(nativeDirectory,'latest-session.json'),'utf8'));const events=(await readFile(join(nativeDirectory,`session-${checkpoint.sessionId}.jsonl`),'utf8')).trim().split('\n').map(JSON.parse);controlEvidence=analyzeControlEvidence(events);nativeStopRequestedAt=Date.parse(events.find(r=>r.type==='stop_requested')?.at);nativeStoppedAt=Date.parse(events.findLast(r=>r.type==='stop')?.at);}catch{}
   for(const name of await readdir(nativeDirectory)){const match=/^session-(.+)\.jsonl$/.exec(name);if(match)sessionIds.add(match[1]);}
   const assessment=assessLongRun({profile:longProfile,report,checkpoint,controlEvidence,nativeStopRequestedAt,nativeStoppedAt,sessionIds:[...sessionIds]});await writeFile(join(directory,'long-run-evidence.json'),JSON.stringify(assessment,null,2));
  }
  console.log(JSON.stringify({stage:'pilot_finished',directory,stopReason,exitCode:code,requests:proxy.report.forwardedRequests,usage:proxy.report.usage}));
 }
}finally{clearInterval(timer);clearTimeout(deadline);await proxy.close();}
