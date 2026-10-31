// Research-only proof. Does not expose the result as an autonomous action tool.
import {spawn} from 'node:child_process';
import {writeFile, mkdir} from 'node:fs/promises';
import {observeSave} from '../src/save-observer.mjs';

const [savePath, rawPid] = process.argv.slice(2);
const pid = Number(rawPid);
if (!savePath || !Number.isSafeInteger(pid) || pid <= 0) throw new Error('用法: node scripts/probe-native-read.mjs 指定测试存档 PID');
const seed = await observeSave({savePath});
const fleetIds = seed.player.fleets.map(fleet => Number(fleet.id));
if (!fleetIds.length || fleetIds.some(id => !Number.isSafeInteger(id))) throw new Error('己方舰队 ID 无效');
const child = spawn('C:\\Program Files\\Python315\\python.exe', ['native/research/stellaris_memory_probe.py'], {stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true});
let output = '', errors = '';
child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
child.stdout.on('data', data => output += data);
child.stderr.on('data', data => errors += data);
const result = new Promise((resolve, reject) => {
  const timer = setTimeout(() => { child.kill(); reject(new Error('原生只读探测超时')); }, 10000);
  child.on('error', error => { clearTimeout(timer); reject(error); });
  child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(JSON.parse(output)) : reject(new Error(errors || `退出码 ${code}`)); });
});
child.stdin.end(JSON.stringify({pid, gamePath: 'D:\\SteamLibrary\\steamapps\\common\\Stellaris\\stellaris.exe', fleetIds}));
const report = {at: new Date().toISOString(), seed: {gameDate: seed.gameDate, countryId: seed.player.id, fleetIds, warning: '仅作候选 ID；未核验当前世界及实时归属'}, live: await result};
await mkdir('.local/native-bridge', {recursive: true});
await writeFile('.local/native-bridge/read-probe.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
