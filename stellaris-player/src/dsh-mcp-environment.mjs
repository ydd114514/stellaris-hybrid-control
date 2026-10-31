import {nativeCountryAIBrief} from './native-country-ai-brief.mjs';
import {surveyWatchWindow} from './survey-watch-window.mjs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
// Deliver run metadata explicitly instead of depending on a client's environment
// inheritance policy. The installed DSH client currently merges a scrubbed parent
// environment; other SDK transports can inherit only a smaller allowlist.
export function nativeMcpEnvironmentPatch({directory,runId,minutes,hybridSurvey,nativeCountryAI=false,presentOrders=true,startPaused=false,surveyPilot=false,colonyUpgradePilot=false,monthlyLifecyclePilot=false,localWaitPilot=false,maximumGameSpeed=5,surveyWatchSeconds=60,stopBaseline=Date.now()}) {
 if(typeof directory!=='string'||!directory||typeof runId!=='string'||!/^[a-zA-Z0-9-]{1,100}$/.test(runId)||!Number.isFinite(minutes)||minutes<=0||minutes>60||typeof hybridSurvey!=='boolean')throw Error('DSH原生会话配置无效');
 if(!Number.isInteger(maximumGameSpeed)||maximumGameSpeed<1||maximumGameSpeed>5)throw Error('DSH游戏速度上限需要1..5整数');
 surveyWatchWindow(surveyWatchSeconds);
 if(!Number.isSafeInteger(stopBaseline)||stopBaseline<=0)throw Error('DSH停止时间基线无效');
 if([nativeCountryAI,surveyPilot,colonyUpgradePilot,monthlyLifecyclePilot,localWaitPilot].some(x=>typeof x!=='boolean'))throw Error('DSH功能开关必须是明确布尔值');
 // Cordis replaces a patched config wholesale; preserve every transport field.
 const patch=[{id:'cyberfish-stellaris-mcp',config:{serverName:'stellaris',transport:'stdio',command:'C:\\Program Files\\nodejs\\node.exe',args:[fileURLToPath(new URL('./native-mcp.mjs',import.meta.url))],cwd:fileURLToPath(new URL('..',import.meta.url)),toolCallTimeoutMs:120000,failOnStartupError:true,env:{DEEPSEEK_API_KEY:'',
  CYBERFISH_NATIVE_DIRECTORY:resolve(directory),CYBERFISH_CONTROLLER_RUN:runId,
  CYBERFISH_NATIVE_COUNTRY_AI:nativeCountryAI?'1':'0',
  CYBERFISH_MAX_GAME_SPEED:String(maximumGameSpeed),CYBERFISH_SURVEY_WATCH_SECONDS:String(surveyWatchSeconds),CYBERFISH_TEST_MINUTES:String(minutes),CYBERFISH_HYBRID_SURVEY:!nativeCountryAI&&hybridSurvey?'1':'0',
  CYBERFISH_COLONY_UPGRADE_PILOT:!nativeCountryAI&&!surveyPilot&&colonyUpgradePilot?'1':'0',CYBERFISH_MONTHLY_LIFECYCLE_PILOT:!nativeCountryAI&&!surveyPilot&&monthlyLifecyclePilot?'1':'0',CYBERFISH_LOCAL_WAIT_PILOT:!nativeCountryAI&&!surveyPilot&&localWaitPilot?'1':'0',
  CYBERFISH_NATIVE_PRESENTATION:presentOrders?'1':'0',CYBERFISH_START_PAUSED:nativeCountryAI||startPaused?'1':'0',CYBERFISH_SURVEY_PILOT:!nativeCountryAI&&surveyPilot?'1':'0',CYBERFISH_STOP_BASELINE:String(stopBaseline)}}}];
 if(nativeCountryAI)patch.push({id:'system-prompt',config:{personaPrefix:'你是正在玩《群星》的大肥鱼。只使用群星 MCP 工具，不使用文件、终端、网页、子代理、控制台或桌面输入。'+nativeCountryAIBrief(minutes)}});
 return patch;
}
