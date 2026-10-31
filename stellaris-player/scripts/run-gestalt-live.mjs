import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,appendFile,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createLiveModelBudget} from '../src/live-model-budget.mjs';
const minutes=Number(process.argv[2]||10),maxRequests=Number(process.argv[3]||60);
if(!Number.isFinite(minutes)||minutes<=0||minutes>20)throw Error('单轮实机时长需要0..20分钟');
const started=Date.now(),directory=resolve('.local/gestalt-live',String(started));await mkdir(directory,{recursive:true});
let stopReason,stopping=false,lastSignature='',timer,child;
const stop=async reason=>{if(stopping)return;stopping=true;stopReason=reason;await writeFile(resolve('.local/STOP'),'gestalt_live: '+reason);};
const proxy=await createLiveModelBudget({directory,maxRequests,onLimit:()=>void stop('本轮模型请求额度已到')});
try{
 let patch=await readFile('plugins/stellaris-dsh/cordis.patch.yml','utf8');
 patch=patch.replace('    thinking: disabled',`    baseURL: '${proxy.baseURL}'\n    retryPolicy:\n      mode: normal\n      maxRetries: 0\n    thinking: disabled`);
 patch=patch.replace('    personaPrefix: |-','    personaPrefix: |-\n      本轮最高优先的游戏任务是验证蜂巢首战闭环：选敌、备战、宣战、登陆、议和和恢复。不要转去日常扩张或刷科研。preparationTasks只用真实任务id或空数组；minShips是本支主力撤退底线，须低于实际舰船数并留损失空间，不能把全帝国30艘填给单支10艘的舰队。先用inspect targets定位已知普通外国殖民星系，planets只能从known_colonies取planet_id，绝不使用恒星id。若原prepare目标星球错误，可campaign start只传新planets修订，保留其他配置。，比较当前attack_options和route后自己选一个目标。已经准备了资源、30艘军舰和8支陆军；请正常登舰、维护可增援编制、启动campaign并持续watch/advance。未知信息补查，失败明确报告，禁止用口头计划代替战役工具。');
 const patchFile=join(directory,'bounded.patch.yml');await writeFile(patchFile,patch);
 const brief='本轮是用户明确授权的独立蜂巢首战功能实机测试。资源、通讯调查、30艘护卫舰及8支驻军已用控制台准备；不得将它们冒充自然发展成果。你没有控制台工具，战争步骤必须使用正常原生命令。优先验证首战，不做无关科技、内阁或远方扩张。先inspect contacts/map/war_fleets/armies，比较有合法战争目标且可达的普通外国，自己选最合适的一家。通过正常embark_all_armies形成运输舰，核对主力增援编制能补回当前军舰数量，再campaign start。没有舰队ID或星球ID就查候选，不猜。配置一颗可达敌方殖民地作为有限首战目标，准备期限留足游戏内2年，退出期限再留3年；军舰最低数与资源底线由真实情况决定。随后反复watch和campaign advance推进，不用聊天叙述替代工具调用。若campaign因情报未知受阻，检查是否应先正常移动到目标获得情报；若接口报错，明确报告原始拒绝，不无限重试。首战结束后核对实际战果、补员和经济恢复。每次简短解释当前阶段与证据。';
 let resumeBrief='';
 try{
  const saved=JSON.parse(await readFile('.local/native-bridge/latest-session.json','utf8')),c=saved.state?.gestalt?.campaign;
  if(c?.enabled)resumeBrief=`当前已有持久战役，阶段${c.phase}，敌国${c.target}，执行配置${JSON.stringify(c.execution)}。优先恢复原战役；不要重复选敌、宣战或终止它来绕过剩余工作。当前缺口${JSON.stringify(c.gaps)}。`;
  if(c?.phase==='recover'&&c.result?.success===true)resumeBrief+='目标殖民地实际归属己方且战争已结束；本轮唯一主要任务是完成战后恢复，禁止重选目标或把terminated当完成。先核对market真实报价与结算货币，用正常买卖修复energy底线；再正常reinforce_fleet补齐该主力、watch等待实际船数和回港。能源短期赤字需维持预算，不能改低已有资源底线来凑成功。只有campaign phase completed才成功。';
 }catch{}
 const env={...process.env,CYBERFISH_DSH_PATCH:patchFile,CYBERFISH_DSH_HOME:join(directory,'dsh-home'),CYBERFISH_STOP_BASELINE:String(started),CYBERFISH_REQUIRE_RUNNING_GAME:'1',CYBERFISH_LIVE_BRIEF:brief+'\n'+resumeBrief};delete env.DEEPSEEK_API_KEY;delete env.ELECTRON_RUN_AS_NODE;
 child=spawn(process.execPath,['scripts/play-native-dsh.mjs',String(minutes)],{cwd:process.cwd(),env,windowsHide:true,stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',b=>{process.stdout.write(b);void appendFile(join(directory,'supervisor.jsonl'),b);});child.stderr.on('data',b=>void appendFile(join(directory,'supervisor.stderr.log'),b));
 timer=setInterval(async()=>{
  try{const c=JSON.parse(await readFile('.local/native-bridge/latest-session.json','utf8'));if(c.started<started)return;
   const state=c.state,signature=JSON.stringify([state?.date,state?.gestalt?.campaign?.phase,state?.gestalt?.campaign?.status,c.metrics]);
   if(signature!==lastSignature){lastSignature=signature;await writeFile(join(directory,'latest-evidence.json'),JSON.stringify(c,null,2));await appendFile(join(directory,'progress.jsonl'),JSON.stringify({at:Date.now(),date:state?.date,campaign:state?.gestalt?.campaign,metrics:c.metrics})+'\n');}
   if(state?.gestalt?.campaign?.phase==='completed')await stop('首战流程完成并确认恢复');
  }catch{/* First authoritative observation is still pending. */}
 },2000);timer.unref();
 const deadline=setTimeout(()=>void stop('本轮实机时间额度已到'),minutes*60000);deadline.unref();
 process.once('SIGINT',()=>void stop('用户停止'));process.once('SIGTERM',()=>void stop('用户停止'));
 const code=await new Promise((done,fail)=>{child.once('exit',done);child.once('error',fail);});clearTimeout(deadline);
 await proxy.close();
 await writeFile(join(directory,'report.json'),JSON.stringify({started,ended:Date.now(),minutes,maxRequests,stopReason,exitCode:code,model:proxy.report,consoleConditions:'见 current/console-*.json；本轮不使用模型控制台'},null,2));
 console.log(JSON.stringify({stage:'live_round_finished',directory,stopReason,requests:proxy.report.forwardedRequests,usage:proxy.report.usage,exitCode:code}));
}finally{clearInterval(timer);await proxy.close();}
