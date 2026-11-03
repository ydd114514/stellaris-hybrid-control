import {COUNTRY_AI_P1_BRIDGE_VERSION,COUNTRY_AI_EDICT_APPROVAL_FEATURE} from './native-country-ai.mjs';
import {spawn} from 'node:child_process';
import {readFile, stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {callWindowsBridge} from './driver.mjs';
import {NativePipe} from './native-pipe.mjs';
import {assertGameStartPolicy} from './game-start-policy.mjs';
import {assertBridgeCapabilities, BRIDGE_VERSION, SURVEY_BRIDGE_VERSION,MONTHLY_BRIDGE_VERSION,MONTHLY_QUOTE_BRIDGE_VERSION,UPGRADE_PATH_BRIDGE_VERSION,TRADE_BUDGET_BRIDGE_VERSION,CLAIM_BUDGET_BRIDGE_VERSION} from './bridge-capabilities.mjs';
import {loadHybridSettings} from './hybrid-settings.mjs';

const gamePath = 'D:/SteamLibrary/steamapps/common/Stellaris/stellaris.exe';
const python = 'C:/Program Files/Python315/python.exe';
export function nativeBridgePath({nativeCountryAI=false,hybridSurvey=false,monthlyTrade=true,monthlyQuotes=monthlyTrade,upgradePaths=monthlyQuotes,tradeBudget=upgradePaths,claimBudget=tradeBudget}={}) {
  return fileURLToPath(new URL(`../.local/native-bridge/runtime/${nativeCountryAI?COUNTRY_AI_P1_BRIDGE_VERSION:claimBudget?CLAIM_BUDGET_BRIDGE_VERSION:tradeBudget?TRADE_BUDGET_BRIDGE_VERSION:upgradePaths?UPGRADE_PATH_BRIDGE_VERSION:monthlyQuotes?MONTHLY_QUOTE_BRIDGE_VERSION:monthlyTrade?MONTHLY_BRIDGE_VERSION:hybridSurvey?SURVEY_BRIDGE_VERSION:BRIDGE_VERSION}/stellaris_bridge.dll`, import.meta.url));
}
export function compatibleLoadedBridgePaths({nativeCountryAI=false,hybridSurvey=false,monthlyTrade=true,monthlyQuotes=monthlyTrade,upgradePaths=monthlyQuotes,tradeBudget=upgradePaths,claimBudget=tradeBudget}={}) {
  // Lower capability modes may reuse any reviewed, already loaded superset.
  // Keep both quote generations explicit; monthlyQuotes now defaults to the
  // corrected upgrade bridge and would otherwise silently omit 0.6.10.
  if(nativeCountryAI)return [];
  if(claimBudget)return [];
  return monthlyTrade||monthlyQuotes||upgradePaths||tradeBudget?[]:[nativeBridgePath({claimBudget:true}),nativeBridgePath({tradeBudget:true,claimBudget:false}),nativeBridgePath({upgradePaths:true,tradeBudget:false}),nativeBridgePath({monthlyQuotes:true,upgradePaths:false}),nativeBridgePath({monthlyTrade:true,monthlyQuotes:false}),...hybridSurvey?[]:[nativeBridgePath({hybridSurvey:true,monthlyTrade:false})]];
}
const loader = fileURLToPath(new URL('../native/research/load_native_bridge.py', import.meta.url));

const log = value => process.stdout.write(JSON.stringify(value) + '\n');
export async function currentGame() {
  const result = await callWindowsBridge({command: 'doctor', gamePath}, {pythonPath: python});
  if (result.windows.length > 1) throw new Error('检测到多个群星实例，无法确定测试局');
  return result.windows[0];
}
async function run(file, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(file, args, {windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], ...options});
    let output = ''; child.stdout.setEncoding('utf8'); child.stdout.on('data', data => output += data); child.stderr.resume();
    const timer = setTimeout(() => {child.kill(); reject(new Error('启动辅助步骤超时'));}, 15000);
    child.on('error', error => {clearTimeout(timer); reject(error);});
    child.on('close', code => {clearTimeout(timer); code === 0 ? resolveRun(output.trim()) : reject(new Error(`启动辅助步骤失败：${code}`));});
    child.stdin.end(options.input || '');
  });
}
export async function ensureNativeGame({nativeCountryAI,hybridSurvey,monthlyTrade=true,monthlyQuotes=monthlyTrade,upgradePaths=monthlyQuotes,tradeBudget=upgradePaths,claimBudget=process.env.CYBERFISH_CLAIM_BUDGET_BRIDGE==='0'?false:tradeBudget,directory=process.env.CYBERFISH_NATIVE_DIRECTORY||'.local/native-bridge'}={}) {
  if(hybridSurvey===undefined||nativeCountryAI===undefined){const settings=await loadHybridSettings();
    nativeCountryAI??=settings.nativeCountryAI===true;hybridSurvey??=!nativeCountryAI&&settings.survey;
  }
  const dllPath=nativeBridgePath({nativeCountryAI,claimBudget,hybridSurvey,monthlyTrade,monthlyQuotes,upgradePaths,tradeBudget});
  // Refuse a second launcher before connecting to the single-connection native pipe.
  try {
    const old = JSON.parse(await readFile(resolve(directory,'controller.lock'), 'utf8'));
    try {process.kill(old.pid, 0); throw new Error('大肥鱼已在控制游戏，不能重复启动');} catch (error) {if (error.code !== 'ESRCH') throw error;}
  } catch (error) {if (error.code !== 'ENOENT') throw error;}
  if (!(await stat(dllPath)).isFile()) throw new Error('缺少已验证的原生桥组件');
  let game = await currentGame();
  assertGameStartPolicy({hasGame:!!game});
  for (let attempt = 0; attempt < 8; attempt++) {
    const result = JSON.parse(await run(python, [loader], {input: JSON.stringify({pid: game.pid, gamePath, dllPath,compatibleDllPaths:compatibleLoadedBridgePaths({nativeCountryAI,claimBudget,hybridSurvey,monthlyTrade,monthlyQuotes,upgradePaths,tradeBudget})})}));
    if (result.ok) {log({stage: 'bridge_loaded', pid: game.pid, status: result.status}); break;}
    if (result.error === 'different_bridge_already_loaded_restart_required') assertGameStartPolicy({hasGame:true,requiresRestart:true});
    // Toolhelp module enumeration can briefly precede process initialization.
    // This is a pre-injection read failure, so only that specific case retries.
    if(result.error==='module_snapshot_failed' && attempt<7) {await delay(750);continue;}
    throw new Error(`原生桥加载失败：${result.error}`);
  }
  for (let attempt = 0; attempt < 60; attempt++) {
    const pipe = new NativePipe();
    let ping;
    try {
      ping = await pipe.request('ping');
      assertBridgeCapabilities(ping,{nativeCountryAI,claimBudget,hybridSurvey,upgradePaths,tradeBudget});
      if(nativeCountryAI&&(ping.bridge_version!==COUNTRY_AI_P1_BRIDGE_VERSION||!ping.features.includes(COUNTRY_AI_EDICT_APPROVAL_FEATURE)))
        throw Error('当前桥无法拦截原生 AI 自行开法令，拒绝启用国家 AI');
      const status = await pipe.request('get_status');
      if (status.in_game && status.date?.formatted && status.outliner?.sectors_summary?.capital_system) {
        log({stage: 'game_ready', pid: game.pid, date: status.date.formatted});
        return {pid: game.pid, date: status.date.formatted};
      }
    } catch(error) {if(ping)throw error;}
    finally {pipe.close();}
    if (attempt % 10 === 0) log({stage: 'waiting_for_test_save'});
    await delay(2000);
  }
  throw new Error('群星测试存档未能完成加载');
}
