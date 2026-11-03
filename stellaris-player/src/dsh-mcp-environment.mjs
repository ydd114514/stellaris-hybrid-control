import {nativeCountryAIBrief} from './native-country-ai-brief.mjs';
import {surveyWatchWindow} from './survey-watch-window.mjs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const FAST_STRATEGY_MODEL_NOTICE='使用快速模型';
const FAST_STRATEGY_MODEL='deepseek-flash';
const DEEPSEEK_ORIGIN='https://api.deepseek.com';
const modelId=value=>typeof value==='string'&&/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(value);

// Same authenticated model listing as DSH's DeepSeek account discovery.
// A custom route (including a live-test budget proxy) owns its own credentials.
export async function discoverNativeStrategyModel({apiKey,baseURL=DEEPSEEK_ORIGIN,fetcher=fetch}={}){
 if(!apiKey)return undefined;
 try{
  const origin=new URL(baseURL).origin;
  if(origin!==DEEPSEEK_ORIGIN)return undefined;
  const response=await fetcher(origin+'/models',{method:'GET',headers:{Authorization:'Bearer '+apiKey},redirect:'error',signal:AbortSignal.timeout(4000)});
  if(!response.ok)return undefined;
  const {data}=await response.json();
  if(!Array.isArray(data))return undefined;
  const ranked=data.flatMap(entry=>{
   const id=entry?.id;
   if(!modelId(id)||id===FAST_STRATEGY_MODEL||entry.supports_reasoning===false||
      (entry.api_capabilities&&!entry.api_capabilities.anthropic_messages)||
      (Number.isFinite(entry.max_output_tokens)&&entry.max_output_tokens<8192))return [];
   const rank=/(?:^|[-_.])pro(?:$|[-_.])/i.test(id)?3:
    /(?:^|[-_.])reason(?:er|ing)(?:$|[-_.])/i.test(id)?2:entry.supports_reasoning===true?1:0;
   return rank?[{id,rank}]:[];
  });
  return ranked.sort((a,b)=>b.rank-a.rank||b.id.localeCompare(a.id,'en',{numeric:true}))[0]?.id;
 }catch{return undefined;}
}

// Deliver run metadata explicitly instead of depending on a client's environment
// inheritance policy. The installed DSH client currently merges a scrubbed parent
// environment; other SDK transports can inherit only a smaller allowlist.
export function nativeMcpEnvironmentPatch({directory,runId,minutes,hybridSurvey,nativeCountryAI=false,strategyModel,modelRelayBaseURL,presentOrders=true,startPaused=false,surveyPilot=false,colonyUpgradePilot=false,monthlyLifecyclePilot=false,localWaitPilot=false,maximumGameSpeed=5,surveyWatchSeconds=60,stopBaseline=Date.now()}) {
 if(typeof directory!=='string'||!directory||typeof runId!=='string'||!/^[a-zA-Z0-9-]{1,100}$/.test(runId)||!Number.isFinite(minutes)||minutes<=0||minutes>60||typeof hybridSurvey!=='boolean')throw Error('DSH原生会话配置无效');
 if(!Number.isInteger(maximumGameSpeed)||maximumGameSpeed<1||maximumGameSpeed>5)throw Error('DSH游戏速度上限需要1..5整数');
 surveyWatchWindow(surveyWatchSeconds);
 if(!Number.isSafeInteger(stopBaseline)||stopBaseline<=0)throw Error('DSH停止时间基线无效');
 if([nativeCountryAI,surveyPilot,colonyUpgradePilot,monthlyLifecyclePilot,localWaitPilot].some(x=>typeof x!=='boolean'))throw Error('DSH功能开关必须是明确布尔值');
 // Cordis replaces a patched config wholesale; preserve every transport field.
 const patch=[{id:'cyberfish-stellaris-mcp',config:{serverName:'stellaris',transport:'stdio',command:'C:\\Program Files\\nodejs\\node.exe',args:[fileURLToPath(new URL('./native-mcp.mjs',import.meta.url))],cwd:fileURLToPath(new URL('..',import.meta.url)),toolCallTimeoutMs:nativeCountryAI?930000:120000,failOnStartupError:true,env:{DEEPSEEK_API_KEY:'',
  CYBERFISH_NATIVE_DIRECTORY:resolve(directory),CYBERFISH_CONTROLLER_RUN:runId,
  CYBERFISH_NATIVE_COUNTRY_AI:nativeCountryAI?'1':'0',
  CYBERFISH_MAX_GAME_SPEED:String(maximumGameSpeed),CYBERFISH_SURVEY_WATCH_SECONDS:String(surveyWatchSeconds),CYBERFISH_TEST_MINUTES:String(minutes),CYBERFISH_HYBRID_SURVEY:!nativeCountryAI&&hybridSurvey?'1':'0',
  CYBERFISH_COLONY_UPGRADE_PILOT:!nativeCountryAI&&!surveyPilot&&colonyUpgradePilot?'1':'0',CYBERFISH_MONTHLY_LIFECYCLE_PILOT:!nativeCountryAI&&!surveyPilot&&monthlyLifecyclePilot?'1':'0',CYBERFISH_LOCAL_WAIT_PILOT:!nativeCountryAI&&!surveyPilot&&localWaitPilot?'1':'0',
  CYBERFISH_NATIVE_PRESENTATION:presentOrders?'1':'0',CYBERFISH_START_PAUSED:nativeCountryAI||startPaused?'1':'0',CYBERFISH_SURVEY_PILOT:!nativeCountryAI&&surveyPilot?'1':'0',CYBERFISH_STOP_BASELINE:String(stopBaseline)}}}];
 if(nativeCountryAI){
  const model=modelId(strategyModel)?strategyModel:FAST_STRATEGY_MODEL;
  const modelNotice=model===FAST_STRATEGY_MODEL?FAST_STRATEGY_MODEL_NOTICE+'。':'';
  patch.push(
   {id:'agent-default-model',config:{provider:'deepseek-official',model,reasoningEffort:'high'}},
   {id:'llm-deepseek',config:{thinking:'enabled',maxTokens:8192,...(modelRelayBaseURL?{baseURL:modelRelayBaseURL}:{})}},
   {id:'system-prompt',config:{personaPrefix:'你是正在玩《群星》的大肥鱼。'+modelNotice+'只使用群星 MCP 工具，不使用文件、终端、网页、子代理、控制台或桌面输入。'+nativeCountryAIBrief(minutes)}});
 }
 return patch;
}
