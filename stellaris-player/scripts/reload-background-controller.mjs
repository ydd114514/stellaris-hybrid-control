// One explicit maintenance handoff, never a game restart or save load.
import {readFile,writeFile,rename,stat} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {confirmedCountryAIHandoff} from '../src/country-ai-handoff.mjs';
import {currentGame} from '../src/native-bootstrap.mjs';
import {inspectNativeProcess} from '../src/native-process.mjs';

const root=fileURLToPath(new URL('..',import.meta.url)),native=join(root,'.local/native-bridge');
const settingsFile=join(root,'.local/background-economy/settings.json'),stopFile=join(root,'.local/STOP');
const read=async f=>{try{return JSON.parse(await readFile(f,'utf8'));}catch{return null;}};
const alive=pid=>{try{process.kill(pid,0);return Number.isSafeInteger(pid)&&pid>0;}catch{return false;}};
const paused=cleanup=>cleanup?.pauseStateUnknown!==true&&(cleanup?.pauseConfirmed===true||cleanup?.paused===true);
if(!process.argv.includes('--execute'))throw Error('必须显式 --execute 才安全续接当前后台控制器');
const maintenanceFile=join(root,'.local/background-economy/maintenance.json');
if(process.argv.includes('--resume')){
 const saved=await read(maintenanceFile);if(!saved?.marker||!saved.cp||!saved.settings)throw Error('没有本次维护交接记录，未重新授权');
 const current=await read(join(native,'latest-session.json'));
 if(current?.sessionId!==saved.cp.sessionId||!current.stopped||!current.cleanup?.bindingConfirmed||!paused(current.cleanup)||!confirmedCountryAIHandoff(current.cleanup?.countryAI))throw Error('本次维护归还已变化，不续接');
 await resume(saved);process.exit(0);
}
const cp=await read(join(native,'latest-session.json')),settings=await read(settingsFile),desktop=await read(join(root,'.local/desktop-controller.json'));
if(!cp||cp.stopped||!settings?.armed||desktop?.source!=='cyberfish-desktop'||!alive(desktop.pid)||!alive(cp.binding?.pid))throw Error('当前没有可续接的已授权正常控制会话');
const game=await currentGame();if(game?.pid!==cp.binding.pid)throw Error('当前游戏身份已变化，未停止或启动控制器');
let stopAt=0;try{stopAt=(await stat(stopFile)).mtimeMs;}catch{}
if(stopAt>=settings.requestedAt||(await read(join(native,'latest-session.json')))?.sessionId!==cp.sessionId)throw Error('已有新的停止意图或控制会话变化，不覆盖');
const marker=`internal_controller_reload:${randomUUID()}\n`;
const maintenance={cp:{sessionId:cp.sessionId,binding:cp.binding},settings,marker};
await writeFile(maintenanceFile,JSON.stringify(maintenance,null,2)+'\n');
await writeFile(stopFile,marker);
console.log(JSON.stringify({stage:'cooperative_handoff',oldSession:cp.sessionId,gamePid:game.pid}));
let handed;
for(let n=0;n<100;n++){
 const current=await read(join(native,'latest-session.json'));
 if(current?.sessionId!==cp.sessionId)throw Error('交接期间控制会话变化，未另行重新授权');
 if(current.stopped&&current.cleanup?.bindingConfirmed===true&&paused(current.cleanup)&&confirmedCountryAIHandoff(current.cleanup?.countryAI)&&!alive(desktop.pid)){handed=current;break;}
 await delay(500);
}
if(!handed)throw Error('安全归还或旧控制器退出尚未确认，保持停止，未自动续接');
await writeFile(maintenanceFile,JSON.stringify(maintenance,null,2)+'\n');
if(process.argv.includes('--pause')){console.log(JSON.stringify({stage:'maintenance_paused',gamePid:game.pid,date:handed.state?.date,pauseConfirmed:true,handoffConfirmed:true}));process.exit(0);}
await resume(maintenance);

async function resume({cp,settings,marker}){
if(await readFile(stopFile,'utf8')!==marker)throw Error('停止标记被用户或其它操作更新，保留停止意图，不续接');
const currentSettings=await read(settingsFile);
if(currentSettings?.requestedAt!==settings.requestedAt)throw Error('后台授权已由其它操作改变，不覆盖');
const stillGame=await currentGame();if(stillGame?.pid!==cp.binding.pid)throw Error('原游戏已退出或变化，不自动恢复');
await inspectNativeProcess({op:'bound_identity',pid:cp.binding.pid,creationTime:cp.binding.creationTime});
// This only resumes our own exact maintenance marker; it never clears STOP.
// A later user stop remains newer than this authorization and cancels launch.
const temporary=settingsFile+'.reload.tmp';
await writeFile(temporary,JSON.stringify({...settings,armed:true,requestedAt:Date.now(),attemptedGamePid:null,maintenanceResumeOf:cp.sessionId},null,2)+'\n');
await rename(temporary,settingsFile);
console.log(JSON.stringify({stage:'handoff_confirmed_waiting_resume',gamePid:cp.binding.pid,gameRestarted:false}));
for(let n=0;n<100;n++){
 const next=await read(join(native,'latest-session.json'));
 const auth=await read(settingsFile);if(!auth?.armed)throw Error('续接等待期间已停止授权，保持停止');
 if(next?.sessionId!==cp.sessionId&&!next?.stopped&&next?.binding?.pid===cp.binding.pid&&next?.binding?.creationTime===cp.binding.creationTime&&next?.countryAIControl?.owner==='native'&&next.runtimeStatus?.paused===false){
  console.log(JSON.stringify({stage:'resumed',sessionId:next.sessionId,gamePid:cp.binding.pid,date:next.state?.date,userPolicy:next.state?.userEconomicPolicy,contract:next.strategyContract}));return;
 }
 await delay(500);
}
console.log(JSON.stringify({stage:'resume_pending',message:'后台已重新授权，尚在正常启动；读取后台状态，不追加另一启动'}));
}
