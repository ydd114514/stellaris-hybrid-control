import {rpcEvidenceCategory} from '../src/control-evidence.mjs';
import {nativeCountryAIBrief} from '../src/native-country-ai-brief.mjs';
import {surveyWatchWindow} from '../src/survey-watch-window.mjs';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createWriteStream} from 'node:fs';
import {mkdir, writeFile, stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {nativeMcpEnvironmentPatch} from '../src/dsh-mcp-environment.mjs';
import {writeStopRequest,readStopCompletion,stopControlledChild} from '../src/cooperative-stop.mjs';
import {loadDeepSeekKey} from '../src/credentials.mjs';
import {NativePipe} from '../src/native-pipe.mjs';
import {supervisorCleanup} from '../src/supervisor-cleanup.mjs';
import {inspectNativeProcess} from '../src/native-process.mjs';
import {loadHybridSettings} from '../src/hybrid-settings.mjs';
import {ensureNativeGame} from '../src/native-bootstrap.mjs';
import {waitForGamePicture} from '../src/runtime-preflight.mjs';

const minutes = Number(process.argv[2] || 10);
if(process.env.CYBERFISH_NATIVE_COUNTRY_AI!==undefined&&!['0','1'].includes(process.env.CYBERFISH_NATIVE_COUNTRY_AI))throw Error('国家 AI 模式必须为0或1');
const nativeWatchSeconds=surveyWatchWindow(Number(process.env.CYBERFISH_SURVEY_WATCH_SECONDS??60));
const hybridSettings=await loadHybridSettings();
const nativeCountryAI=hybridSettings.nativeCountryAI===true;
const nativeDirectory=resolve(process.env.CYBERFISH_NATIVE_DIRECTORY||'.local/native-bridge');
await mkdir(nativeDirectory,{recursive:true});
if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 60) throw new Error('测试时长需要 0..60 分钟');
// Closing the game must never cause a test supervisor to reopen it.
process.env.CYBERFISH_REQUIRE_RUNNING_GAME='1';
const bootstrapAt=Number(process.env.CYBERFISH_STOP_BASELINE)||Date.now();
await ensureNativeGame({nativeCountryAI,hybridSurvey:!nativeCountryAI&&hybridSettings.survey,directory:nativeDirectory});
const pictureProbe=new NativePipe();let picture,pausedForPreflight=false;
try {
  picture=await waitForGamePicture({probe:()=>pictureProbe.request('get_picture_state'),
    isStopped:async()=>{try{return (await stat('.local/STOP')).mtimeMs>=bootstrapAt;}catch{return false;}},
    onWaiting:async state=>{
      if(state.picture&&!pausedForPreflight)pausedForPreflight=(await pictureProbe.request('set_paused',{paused:true})).success===true;
      await writeFile(join(nativeDirectory,'preflight.json'),JSON.stringify({at:Date.now(),pid:process.pid,...state}));
    }});
}finally{pictureProbe.close();}
if(!picture)process.exit(0);
await writeFile(join(nativeDirectory,'preflight.json'),JSON.stringify({at:Date.now(),pid:process.pid,stage:'picture_ready',picture}));
const key = await loadDeepSeekKey();
if (!key) throw new Error('本机尚未配置 DeepSeek 密钥');
await mkdir(join(nativeDirectory,'dsh'), {recursive: true});
const prefix = join(nativeDirectory,'dsh', String(Date.now()));
const stdout = createWriteStream(prefix + '.jsonl'), stderr = createWriteStream(prefix + '.stderr.log');
const task = `自主流畅经营当前《群星》测试局 ${minutes} 分钟。先观察和核对government路线，按state.strategy确定当前最重要的1～3项目标，不需要询问用户。中央事件和防守优先；经济有瓶颈就先查岗位、舒适度、专精/特区和队列并修复，保护科研与凝聚力。多个资源接近满仓或科研增长停滞时转向产能瓶颈，长库存的小赤字不自动压过增长。新增城市区划不自动解锁特区/建筑槽，满员岗位重复设优先不能增产；以真实解锁条件和回读收益决定建设。首府升级先inspect upgrades，使用当前唯一合法候选upgrade_building，预算允许才下单；入队不等于完工，按orderTracking回读最终建筑。capabilityGaps中的其他动作报告受限并选可执行替代，不能无限承诺下轮完成。利用operationalFacts回答已有事实，未知需补查或明确受限。只有财政、后勤和影响力预算允许、目标有实际战略收益时才扩大疆域，空候选相关条件未变不反复查。防务按威胁、任务和实际战力安排，容量不是必填目标；同时核对全国舰容、在建占用和单舰队指挥上限，不绕过预算造舰。建造必须使用真实完整zone_id与合法候选，失败不盲重试。游戏保持正常可见运行，想好就操作，每轮只简短讲解目标与原因。工作已安排好就watch回读，状态变化再处理，直到工具明确返回“测试时长已到”才停止并报告已验证进展。时长剩余很短也可watch，不提前结束。`;
const controllerRunId=randomUUID(),roundStarted=Date.now();
const runtimePatch=prefix+'.environment.patch.json';
await writeFile(runtimePatch,JSON.stringify(nativeMcpEnvironmentPatch({nativeCountryAI,maximumGameSpeed:Number(process.env.CYBERFISH_MAX_GAME_SPEED??5),directory:nativeDirectory,runId:controllerRunId,minutes,hybridSurvey:hybridSettings.survey,presentOrders:process.env.CYBERFISH_NATIVE_PRESENTATION!=='0',startPaused:process.env.CYBERFISH_START_PAUSED==='1',surveyPilot:process.env.CYBERFISH_SURVEY_PILOT==='1',colonyUpgradePilot:process.env.CYBERFISH_COLONY_UPGRADE_PILOT==='1',monthlyLifecyclePilot:process.env.CYBERFISH_MONTHLY_LIFECYCLE_PILOT==='1',localWaitPilot:process.env.CYBERFISH_LOCAL_WAIT_PILOT==='1',surveyWatchSeconds:nativeWatchSeconds,stopBaseline:bootstrapAt}),null,2));
const args = ['C:/Users/YDD/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/lib/bin.js', '--profile', 'headless', '--patch', resolve(process.env.CYBERFISH_DSH_PATCH || 'plugins/stellaris-dsh/cordis.patch.yml'),'--patch',runtimePatch, '--json', '-'];
const child = spawn(process.execPath, args, {cwd: process.cwd(), env: {...process.env, CYBERFISH_NATIVE_COUNTRY_AI:nativeCountryAI?'1':'0', CYBERFISH_HYBRID_SURVEY:!nativeCountryAI&&hybridSettings.survey?'1':'0', CYBERFISH_CONTROLLER_RUN:controllerRunId,DSH_HOME: process.env.CYBERFISH_DSH_HOME || 'C:/Users/YDD/AppData/Local/Cyberfish/dsh', DEEPSEEK_API_KEY: key, CYBERFISH_TEST_MINUTES: String(minutes)}, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe', 'ipc']});
const persistentGoals=`长期工作使用 tasks 工具保存 goal、合法 orders、budget（已知候选费用）、dependencies 和 priority，再 tasks run。先查看已有任务，普通对话不重建目标。等待施工或航行时选择其他 ready 任务，全部等待才 watch；paused 时游戏日期不增长不判失败。共享预算不足不得改用 apply_orders 绕过。观察中的 gestalt 显示等待原因、承诺和在途对账；未知动作不能重发。按 strategyCards 保留主进攻目标，campaign select 需真实敌国 ID、收益理由和未来 reviewDate；已有真实战争用 bind-war 绑定。版本、帝国、DLC、模组未知时补查，不猜配方。通过 inspect war_fleets / armies / attack_options / landing / peace_options / invasion 读取己方实际运输军和当前合法条件。先区分目标：systemOnlyConfirmed=true的前哨站使用planets:[]，不要为它招陆军；只有已确认的殖民地目标才需要运输军。陆军招募尚未提供实时费用，存在共享预留或经tasks执行时受限，不能空预算反复重试。确需陆军且具备支持条件时，在己方星球 inspect armies 获取真实招募候选，recruit_planet_army 招募，等真实部队出现再 embark_all_armies 登舰，回读 war_fleets 的 embarked_armies。选择可达、有收益的首战目标后 campaign start 配置主力、运输舰、集结星系、进攻星系、占领星球、合法goalKey、备战reviewDate和退出finishDate，resourceFloors 明确最低库存。宣称先inspect claim_quote(id=目标星系)，tasks预算用返回cost；已核对无殖民地目标可直接start planets:[]，由战役执行宣称，wg_conquest须在宣称后重新核对引擎合法性。先用持久任务修复缺口；watch 和 campaign advance 持续集结、宣战、进攻、登陆、议和与战后恢复。不要把posted当完成；暂停不发新动作；路线断裂、超期和损失触发收缩。退出期限到达先比较实时战况；有优势可campaign revise延长finishDate并继续推进，不因为到期就投降。议和legal只表示可以提出，不等于AI接受；目标被反夺时先评估夺回或修订，不拿旧占领当战果。战役 completed 后才选择下一目标。有活动战役时优先核对并推进它；已安排航行或施工就watch 20秒，不为等待反复启动无关内政或重选目标。用inspect targets的known_colonies选择真实殖民地，不能选恒星。已完整确认无殖民地的敌方星系可用planets:[]，不需要transportId，不为前哨站强行招陆军；先宣称，再合法开战，实际星基控制与和平后星系所有权分别核对。主力或运输军受损时先查war_fleets和路线，可用campaign revise带reason更换确认可用的己方部队，保留战争与旧订单记录。地面战和星球控制权以invasion回读为准；议和提交不等于对方接受。`;
const delegationBrief=hybridSettings.survey?'调查分工试点已启用。你保留科研、扩张、外交和战争决定；仅对有科学官、空闲且有实时合法调查目标的己方科研船使用survey_control delegate。已委派对象不要再用apply_orders覆盖；需要改变目标先reclaim并确认manual，再按新快照下单。控制权未知先reconcile，旧会话先recover收权，不重放旧任务。没有合法目标或储备不足就保持手动，不反复尝试委派。自动执行待命不等于完成调查。已确认原生委派确有子任务且没有新决策时，优先watch 60秒；本地仍每秒检查，控制器会按实际条件缩短或唤醒，不为等待反复查同一状态。':'';
const arrivalBrief=hybridSettings.survey?'自动调查仅开放survey，未授权explore。候选intel=0不能据可手动调查就认定原生会选取；若委派因未探索被拒绝，先根据最新地图、航道和风险选择探索方向，manual状态下正常move_fleet并保持回避姿态，等实际抵达且订单清空后再核对委派。没有安全方向就报告条件不足，不反复delegate或用待命凑时长。':'';
const conquestBrief='主动进攻和持续征服属于长期目标：查看strategy.conquest，有战役持续推进战斗、占领和议和；无战役主动比较targets并保存目标、具体备战任务。条件具备就开战，不等全面均衡或满舰容。战后核对真实战果、恢复并评估下一目标；不把posted、模拟或运行时长当胜利。';
const constructionQueryBrief='星球建设决策优先inspect construction(id,sections)，一次取得己方星球现况及所选1..3类真实候选，默认建筑和区划；可选jobs/upgrades/zones，只取当前需要的范围，已有返回不重复查planet和相同候选。缺失范围单独补查，执行仍新鲜核验。';
const marketQueryBrief='已选定交易资源、方向和数量时，用inspect market的resource/action/units直接查该整笔报价，避免反复查全市场；只比较资源与瓶颈时才做全市场查询。按quote_coverage和各方向price_basis区分真实报价与未查估计，不能把单批均价外推。预览不授权花费，执行会核对新鲜报价与预算；持续盈余/缺口使用monthly_trade，不反复小额即时买卖。';
const scoped=process.env.CYBERFISH_SURVEY_PILOT==='1';
const runBrief=nativeCountryAI?nativeCountryAIBrief(minutes):
 (scoped?'本轮只验证科研船调查委派。以当前独立试验目标为准，保留已有施工与生产，不建立其他经营目标。':conquestBrief+'\n'+constructionQueryBrief+'\n'+task+'\n'+persistentGoals+'\n'+marketQueryBrief)+'\n'+delegationBrief.replace('watch 60秒','watch '+nativeWatchSeconds+'秒')+'\n'+arrivalBrief;
let modelStderr='';
child.stderr.on('data',chunk=>{modelStderr=(modelStderr+chunk.toString()).slice(-8192);});
child.stdout.pipe(stdout); child.stderr.pipe(stderr); child.stdin.end(runBrief+'\n'+(process.env.CYBERFISH_LIVE_BRIEF||''));
console.log(JSON.stringify({stage: 'started', pid: child.pid, minutes, events: prefix + '.jsonl'}));
await writeFile(join(nativeDirectory,'dsh/current.json'), JSON.stringify({pid: child.pid, minutes, events: prefix + '.jsonl', stderr: prefix + '.stderr.log'}, null, 2));
let deadline;
const started = Number(process.env.CYBERFISH_STOP_BASELINE)||Date.now();
let stopPromise;
const terminate=()=>new Promise(done=>{
  const ps = spawn('C:/Program Files/PowerShell/7/pwsh.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', `& taskkill.exe /PID ${child.pid} /T /F | Out-Null`], {windowsHide: true, stdio: 'ignore'});
  ps.once('error',()=>{child.kill();done({terminationFallback:true});});ps.once('exit',code=>{if(code!==0&&child.exitCode===null)child.kill();done({terminationExitCode:code});});
});
const cleanup=(reason='监督器请求停止')=>stopPromise??=stopControlledChild({alive:()=>child.exitCode===null&&child.signalCode===null,
 exitGraceMs:7500,
 request:async()=>{let requestedAt=Date.now();try{const stopAt=(await stat('.local/STOP')).mtimeMs;if(stopAt>=started&&stopAt<=requestedAt)requestedAt=Math.floor(stopAt);}catch{}return writeStopRequest(nativeDirectory,{runId:controllerRunId,reason,now:requestedAt});},
 completion:request=>readStopCompletion(nativeDirectory,{runId:controllerRunId,requestedAt:request.requestedAt}),requestExit:completion=>new Promise((done,fail)=>{
 if(!child.connected)return fail(Error('宿主IPC已断开'));
 child.send({type:'cyberfish-host-stop',runId:controllerRunId,sessionId:completion.sessionId},error=>error?fail(error):done());
 }),terminate});
deadline = setTimeout(()=>void cleanup('运行时间及收尾宽限已到'), minutes * 60000 + 90000);
const stopWatch = setInterval(async () => {try {if ((await stat('.local/STOP')).mtimeMs >= started)void cleanup('已收到停止指令');} catch {}}, 1000);
process.on('SIGINT',()=>void cleanup('监督器收到SIGINT'));process.on('SIGTERM',()=>void cleanup('监督器收到SIGTERM'));
const code = await new Promise((resolveExit, reject) => {child.on('error', reject); child.on('exit', resolveExit);});
clearTimeout(deadline); clearInterval(stopWatch);
const stopResult=stopPromise?await stopPromise:undefined;
if(stopResult)await writeFile(prefix+'.stop.json',JSON.stringify(stopResult,null,2));
// This supervisor pauses independently even when Windows forcibly terminates MCP.
const bridge = new NativePipe({beforeWrite:(method,params,context)=>{
 if((rpcEvidenceCategory(method,params)!=='read'||['get_fleet_automation','get_market'].includes(method))&&context?.supervisorCleanup!==true)throw Error('监督器写入缺少本轮收权核对');
 if(context?.connectionEpoch!==undefined&&context.connectionEpoch!==bridge.connectionEpoch)throw Error('监督器桥连接已变化，禁止沿用旧收权授权');
}}); let finalCleanup;
try {finalCleanup=await supervisorCleanup({directory:nativeDirectory,started:roundStarted,runId:controllerRunId,rpc:(m,p,c)=>bridge.request(m,p,c),connectionEpoch:()=>bridge.connectionEpoch,release:()=>bridge.close(),identity:()=>inspectNativeProcess({op:'identity'}),boundIdentity:binding=>inspectNativeProcess({op:'bound_identity',pid:binding.pid,creationTime:binding.creationTime})});}
catch (error) {finalCleanup = {paused: false, error: error.message};}
finally {bridge.close();}
await writeFile(prefix + '.cleanup.json', JSON.stringify(finalCleanup, null, 2));
console.log(JSON.stringify({stage: 'finished', exitCode: code, cleanup: finalCleanup, events: prefix + '.jsonl'}));
if(/INVALID_REQUEST[\s\S]*Invalid schema for function/.test(modelStderr)){
 await writeFile(join(nativeDirectory,'startup-error.json'),JSON.stringify({started:bootstrapAt,at:Date.now(),message:'模型拒绝了控制工具的参数定义，控制器已停止；请更新源码后重新启动，不会自动重试模型请求。'}));
 process.exitCode=78;
}else process.exitCode = code || 0;
