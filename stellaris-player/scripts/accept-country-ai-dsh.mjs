import {assessCountryAIModelLinkage,countryAIModelAcceptanceReady} from '../src/country-ai-model-evidence.mjs';
// Real, bounded model integration through the existing DSH entry. No desktop use.
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,appendFile,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {createLiveModelBudget} from '../src/live-model-budget.mjs';
import {confirmedCountryAIHandoff} from '../src/country-ai-handoff.mjs';
const minutes=2,maxRequests=10,started=Date.now();
const directory=resolve('.local',`country-ai-dsh-acceptance-${started}`),nativeDirectory=join(directory,'native');
await mkdir(nativeDirectory,{recursive:true});
const report={started,minutes,maxRequests,coreGoalComplete:false,passed:false,scope:'real_DSH_strategic_takeover_and_return',nativeDirectory};
report.egress={provider:'DeepSeek',endpoint:'https://api.deepseek.com/anthropic/v1/messages',
 content:['游戏局内状态','群星工具定义和回读','本轮战略测试指令','精简运行摘要','必要的 DSH 系统与项目提示'],
 authentication:'configured_key_in_authentication_headers_only',audit:'request_counts_status_model_usage_without_bodies_or_keys',
 fileTerminalWebSubagentTools:'disabled',realExternalCallsRequireUserAuthorization:true};
const auditedPatch=(await readFile('plugins/stellaris-dsh/cordis.patch.yml','utf8')).replaceAll(String.fromCharCode(13),'');
 for(const id of ['tool-bash','tool-pwsh','tool-jobs','tool-fs','tool-fs-search','tool-working-directory','tool-skill','tool-subagent-control','tool-subagent-list-agents','tool-subagent','tool-subagent-fork','tool-workflow','tool-goal','tool-todo','tool-web']){
  if(!auditedPatch.includes(`- id: ${id}\n  disabled: true`))throw Error('DSH 工具范围改变，拒绝开启未审阅的出站联调');
 }
 if(auditedPatch.split('    thinking: disabled').length!==2)throw Error('DSH 服务配置锚点改变，拒绝绕过请求额度');
report.toolScopeVerified=true;report.configAnchorVerified=true;
if(!process.argv.includes('--execute')){
 await writeFile(join(directory,'report.json'),JSON.stringify({...report,prepared:true,realModelCalls:0},null,2));
 console.log(JSON.stringify({directory,prepared:true,realModelCalls:0}));process.exit(0);
}
let proxy,child,deadline,evidenceTimer,checking=false,stopping=false;
const stop=async reason=>{if(stopping)return;stopping=true;report.stopReason=reason;proxy?.seal();await writeFile('.local/STOP',`country_ai_dsh: ${reason}`);};
const hashes=async()=>{
 const files=[...(await readdir('src')).filter(f=>f.endsWith('.mjs')).map(f=>'src/'+f),'scripts/play-native-dsh.mjs'];
 return Object.fromEntries(await Promise.all(files.map(async f=>[f,createHash('sha256').update(await readFile(f)).digest('hex')])));
};
try{
 report.sourceBefore=await hashes();
 proxy=await createLiveModelBudget({directory,maxRequests,onLimit:()=>void stop('request_limit')});
 let patch=auditedPatch;
 patch=patch.replace('    thinking: disabled',`    baseURL: '${proxy.baseURL}'\n    retryPolicy:\n      mode: normal\n      maxRetries: 0\n    thinking: disabled`);
 const patchFile=join(directory,'bounded.patch.yml');await writeFile(patchFile,patch);
 const brief='本轮仅做真实模型战略接管联调。先观察当前帝国和 country_ai_control status；delegate 后 watch 2秒，再 takeover 并确认回读。依据当前经济和威胁，在物理科研的合法候选中选择一项不同于当前、具有战略理由的科技，以 apply_orders strategicResearchOverride=true 和单项 select_research 干预，写清 explanation，回读生效后 resume 交还。若没有值得切换的合法候选，明确报告证据不足，不为验收胡乱切换。交还后 watch 60秒持续监督到本轮结束。不得取消科研或旧施工，不做例行科研、调查、交易、建设、军事和战役派单；这些不用于凑验收。禁止桌面输入、窗口展示与镜头定位。';
 const env={...process.env,CYBERFISH_NATIVE_COUNTRY_AI:'1',CYBERFISH_HYBRID_SURVEY:'0',
  CYBERFISH_COLONY_UPGRADE_PILOT:'0',CYBERFISH_MONTHLY_LIFECYCLE_PILOT:'0',CYBERFISH_LOCAL_WAIT_PILOT:'0',CYBERFISH_SURVEY_PILOT:'0',
  CYBERFISH_NATIVE_PRESENTATION:'0',CYBERFISH_START_PAUSED:'1',CYBERFISH_MAX_GAME_SPEED:'2',CYBERFISH_STOP_BASELINE:String(started),
  CYBERFISH_DSH_HOME:join(directory,'dsh-home'),CYBERFISH_DSH_PATCH:patchFile,CYBERFISH_NATIVE_DIRECTORY:nativeDirectory,CYBERFISH_LIVE_BRIEF:brief};
 delete env.DEEPSEEK_API_KEY;delete env.ELECTRON_RUN_AS_NODE;
 child=spawn(process.execPath,['scripts/play-native-dsh.mjs',String(minutes)],{cwd:process.cwd(),env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',b=>void appendFile(join(directory,'supervisor.jsonl'),b));
 child.stderr.on('data',b=>void appendFile(join(directory,'supervisor.stderr.log'),b));
 deadline=setTimeout(()=>void stop('bounded_deadline'),minutes*60000);
 console.log(JSON.stringify({stage:'started',directory,minutes,maxRequests}));
 evidenceTimer=setInterval(async()=>{
  if(checking||stopping)return;checking=true;
  try{
   const cp=JSON.parse(await readFile(join(nativeDirectory,'latest-session.json'),'utf8'));
   const lock=JSON.parse(await readFile(join(nativeDirectory,'controller.lock'),'utf8'));
   if(cp.stopped||cp.started<started||lock.sessionId!==cp.sessionId)return;
   const events=(await readFile(join(nativeDirectory,`session-${cp.sessionId}.jsonl`),'utf8')).trim().split(String.fromCharCode(10)).map(JSON.parse);
   if(countryAIModelAcceptanceReady(cp,events))
    await stop('acceptance_evidence_complete');
  }catch{/* A partially written checkpoint is retried; it is never a success. */}
  finally{checking=false;}
 },500);

 report.exitCode=await new Promise((done,fail)=>{child.once('error',fail);child.once('exit',done);});
 clearTimeout(deadline);clearInterval(evidenceTimer);await proxy.close();report.model=proxy.report;
 report.sourceAfter=await hashes();report.sourcesUnchanged=JSON.stringify(report.sourceBefore)===JSON.stringify(report.sourceAfter);
 const checkpoint=JSON.parse(await readFile(join(nativeDirectory,'latest-session.json'),'utf8'));
 const events=(await readFile(join(nativeDirectory,`session-${checkpoint.sessionId}.jsonl`),'utf8')).trim().split('\n').map(JSON.parse);
 report.assessment={...assessCountryAIModelLinkage(checkpoint,events),cleanup:checkpoint.cleanup,countryAIControl:checkpoint.countryAIControl};
 report.passed=report.exitCode===0&&report.sourcesUnchanged&&proxy.report.forwardedRequests>0&&
  report.assessment.linkageVerified&&confirmedCountryAIHandoff(checkpoint.cleanup?.countryAI);
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{
 clearTimeout(deadline);clearInterval(evidenceTimer);await proxy?.close();report.ended=Date.now();
 await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({directory,passed:report.passed,coreGoalComplete:false,requests:report.model?.forwardedRequests,error:report.error}));
 if(!report.passed)process.exitCode=1;
}
