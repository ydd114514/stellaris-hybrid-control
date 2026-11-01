import {loadHybridSettings} from '../src/hybrid-settings.mjs';
import {controllerRoundComplete,countryAIHandoffUnconfirmed} from '../src/controller-round.mjs';
import {spawn} from 'node:child_process';
import {readFile, stat, mkdir, writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {ensureCommentary} from '../src/commentary-launch.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
process.chdir(root);
try {const {url}=await ensureCommentary();console.log('实时字幕与解说：'+url);} catch(error) {console.log(error.message+'；游戏控制继续。');}
const started = Number(process.env.CYBERFISH_STOP_BASELINE) || Date.now();
let stopping = false, child;
async function stopRequested() {
  try {return stopping || (await stat('.local/STOP')).mtimeMs >= started;} catch {return stopping;}
}
async function requestStop() {
  if (stopping) return; stopping = true;
  await mkdir('.local', {recursive: true});
  await writeFile('.local/STOP', new Date().toISOString());
}
process.on('SIGINT', () => void requestStop()); process.on('SIGTERM', () => void requestStop());
const nativeCountryAI=(await loadHybridSettings()).nativeCountryAI===true;
let previous = '', failures = 0;
const statusTimer = setInterval(async () => {
  try {
    const data = JSON.parse(await readFile('.local/native-bridge/latest-session.json', 'utf8'));
    if (data.started < started || !data.state) return;
    const state = data.state, colonies = state.colonies?.reduce((sum, sector) => sum + sector.colonies_count, 0);
    const line = `${state.date}｜星系 ${state.player.owned_systems}｜殖民地 ${colonies}｜科研船 ${state.civilian.science_ships_count}｜本轮指令 ${data.metrics.orders}（已回读 ${data.metrics.verified}）`;
    if (line !== previous) {console.log(line); previous = line;}
  } catch {}
}, 5000);
try {
  while (!await stopRequested()) {
    console.log('大肥鱼开始一轮原生控制；使用当前游戏数据和正常引擎命令。');
    child = spawn(process.execPath, ['scripts/play-native-dsh.mjs', '60'], {cwd: root, windowsHide: true, stdio: 'inherit'});
    const code = await new Promise((resolve, reject) => {child.on('error', reject); child.on('exit', resolve);});
    if (await stopRequested()) break;
    if(code===78){console.log('模型工具定义不合法，已停止；修复后由用户重新启动，不自动重试。');process.exitCode=78;break;}
    const checkpoint=JSON.parse(await readFile('.local/native-bridge/latest-session.json','utf8').catch(()=> 'null'));
    if(checkpoint?.state?.terminal) {console.log(checkpoint.state.terminal.message);break;}
    // A completed DSH response after failed startup is not a successful run.
    // Back off even on exit 0; the next supervisor checks the picture locally.
    if(nativeCountryAI&&countryAIHandoffUnconfirmed(checkpoint)){console.log('国家 AI 交接尚未确认，保持封口并停止自动重启；请先核对原生暂停和关闭结果。');break;}
    if (code === 0 && controllerRoundComplete(checkpoint,{nativeCountryAI})) {failures = 0; continue;}
    failures++;
    console.log(`本轮遇到错误，游戏已尝试暂停；${Math.min(60, failures * 10)} 秒后重新检查并恢复。`);
    for (let second = 0; second < Math.min(60, failures * 10) && !await stopRequested(); second++) await delay(1000);
  }
} finally {clearInterval(statusTimer);}
console.log('大肥鱼控制已结束。暂停结果见 .local/native-bridge/dsh 中的 cleanup.json。');
