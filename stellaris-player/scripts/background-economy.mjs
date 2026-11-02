// Persistent local gameplay observation. No UI, game launch, reload or direct RPC.
import {spawn} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {readFile,writeFile,mkdir,rename,stat,open,unlink,appendFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {currentGame} from '../src/native-bootstrap.mjs';
import {backgroundEconomyStatus,mayStartBackgroundController} from '../src/background-economy.mjs';

const root=fileURLToPath(new URL('..',import.meta.url)),directory=join(root,'.local/background-economy');
const nativeDirectory=join(root,'.local/native-bridge'),settingsFile=join(directory,'settings.json'),statusFile=join(directory,'status.json');
const lockFile=join(directory,'monitor.lock'),stopFile=join(root,'.local/STOP');
const readJson=async file=>{try{return JSON.parse(await readFile(file,'utf8'));}catch{return null;}};
const alive=pid=>{if(!Number.isSafeInteger(pid)||pid<=0)return false;try{process.kill(pid,0);return true;}catch(error){return error.code==='EPERM';}};
const atomic=async(file,data)=>{const temporary=file+'.'+process.pid+'.tmp';await writeFile(temporary,JSON.stringify(data,null,2)+'\n');await rename(temporary,file);};
await mkdir(directory,{recursive:true});
const mode=process.argv[2];
if(mode==='--status'){
 const status=await readJson(statusFile),lock=await readJson(lockFile);
 console.log(JSON.stringify({...status,monitorActive:alive(lock?.pid)},null,2));
}else if(mode==='--arm'){
 await atomic(settingsFile,{version:1,armed:true,requestedAt:Date.now(),attemptedGamePid:null});
 console.log('后台经营监测已授权；等待你正常打开群星并载入存档，不自动启动游戏。');
}else if(mode==='--disarm'){
 const settings=await readJson(settingsFile);
 await atomic(settingsFile,{...settings,version:1,armed:false,disarmedAt:Date.now()});
 await writeFile(stopFile,'user_stop: background economy\n');
 console.log('已关闭自动启动并请求当前控制器合作停止；后台只读监测保留。');
}else if(mode==='--run'){
 await run();
}else throw Error('使用 --arm、--run、--status 或 --disarm');

async function run(){
 process.chdir(root);
 let lock;
 try{lock=await open(lockFile,'wx');}catch(error){
  if(error.code!=='EEXIST')throw error;
  const previous=await readJson(lockFile);
  if(alive(previous?.pid))throw Error('后台经营监测已经运行，不重复启动');
  await unlink(lockFile);lock=await open(lockFile,'wx');
 }
 const startedAt=Date.now();await lock.writeFile(JSON.stringify({pid:process.pid,startedAt}));await lock.close();
 let timer,working=false,quitting=false,managed,lastSample='',lastPhase='',lastProbeAt=0,game;
 const shutdown=()=>{quitting=true;clearInterval(timer);};
 process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
 async function poll(){
  if(working||quitting)return;working=true;
  try{
   let settings=await readJson(settingsFile)??{armed:false};
   let stopAt=0;try{stopAt=(await stat(stopFile)).mtimeMs;}catch{}
   if(settings.armed&&stopAt>=settings.requestedAt){settings={...settings,armed:false,disarmedAt:Date.now(),reason:'已收到停止指令'};await atomic(settingsFile,settings);}
   const [cp,controllerLock,desktop]=await Promise.all([
    readJson(join(nativeDirectory,'latest-session.json')),readJson(join(nativeDirectory,'controller.lock')),readJson(join(root,'.local/desktop-controller.json'))]);
   const controllerActive=!!managed||alive(controllerLock?.pid)||desktop?.source==='cyberfish-desktop'&&!desktop.stoppedAt&&alive(desktop.pid);
   if(managed&&settings.armed&&Number.isSafeInteger(settings.attemptedGamePid)&&!alive(settings.attemptedGamePid)){
    settings={...settings,armed:false,disarmedAt:Date.now(),reason:'本轮游戏进程已退出'};
    await atomic(settingsFile,settings);await writeFile(stopFile,'game_closed: background economy\n');
   }
   let probeError;
   if(!controllerActive&&settings.armed&&Date.now()-lastProbeAt>=15000){
    lastProbeAt=Date.now();
    try{game=await currentGame();}catch{game=undefined;probeError='无法确定唯一群星进程，未自动启动控制';}
   }
   if(mayStartBackgroundController({settings,gamePid:game?.pid,controllerActive,stopAt})){
    // Persist the single attempt before spawning. The existing supervisor waits
    // for a loaded world and rendering; it never opens/restarts the game.
    settings={...settings,attemptedGamePid:game.pid,attemptedAt:Date.now()};await atomic(settingsFile,settings);
    const launchAt=Date.now(),out=createWriteStream(join(directory,'controller.stdout.log'),{flags:'a'}),err=createWriteStream(join(directory,'controller.stderr.log'),{flags:'a'});
    const env={...process.env,CYBERFISH_REQUIRE_RUNNING_GAME:'1',CYBERFISH_NATIVE_COUNTRY_AI:'1',CYBERFISH_HYBRID_SURVEY:'0',
     CYBERFISH_STOP_BASELINE:String(launchAt),CYBERFISH_MAX_GAME_SPEED:'3',
     CYBERFISH_LIVE_BRIEF:'当前为用户正常游玩并后台监测，不是验收试验。本人要求持续提高凝聚力净产和传统推进，先经营已有殖民地，再按人口岗位、维护和防务判断扩张收益；没有固定600、年份或规模上限。原生AI负责日常操作，参谋必须服从本人重点并依据实际瓶颈调整。不要自行停止来要求用户重启或另换存档。'};
    delete env.DEEPSEEK_API_KEY;delete env.ELECTRON_RUN_AS_NODE;
    const child=spawn(process.execPath,[join(root,'scripts/autoplay-native.mjs')],{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    managed=child;child.stdout.pipe(out);child.stderr.pipe(err);
    child.once('error',()=>void markEnded(child,'控制器启动失败'));
    child.once('exit',code=>void markEnded(child,`控制器已结束（${code??'信号'}）`));
    await atomic(join(root,'.local/desktop-controller.json'),{pid:child.pid,started:launchAt,source:'cyberfish-desktop',backgroundEconomy:true,requireRunningGame:true});
    await appendFile(join(directory,'events.jsonl'),JSON.stringify({at:launchAt,event:'controller_started',gamePid:game.pid,pid:child.pid})+'\n');
   }
   const result=backgroundEconomyStatus(cp,{controllerActive:controllerActive||!!managed});
   const status={...result,monitorPid:process.pid,monitorStartedAt:startedAt,armed:settings.armed===true,
    autoStart:settings.armed?'已授权，等待正常游戏进程或当前控制器':'已关闭自动启动',gamePid:game?.pid??null,
    message:probeError??(result.live?'后台读取当前经营数据':managed?'控制器已启动，等待存档及新数据':settings.armed?'后台监测运行中，等待正常打开群星':'只读监测运行中，自动启动已关闭')};
   await atomic(statusFile,status);
   const sampleKey=result.live?`${result.sessionId}:${result.sourceObservedAt}`:'';
   if(sampleKey&&sampleKey!==lastSample){
    lastSample=sampleKey;const history=join(directory,'samples.jsonl');
    try{if((await stat(history)).size>10*1024*1024)await rename(history,join(directory,'samples.previous.jsonl'));}catch(error){if(error.code!=='ENOENT')throw error;}
    await appendFile(history,JSON.stringify(result)+'\n');
   }
   const phase=JSON.stringify([status.phase,status.armed,status.alerts]);
   if(phase!==lastPhase){lastPhase=phase;await atomic(join(directory,'attention.json'),{at:Date.now(),phase:status.phase,armed:status.armed,alerts:status.alerts,message:status.message});}
  }catch(error){await atomic(statusFile,{version:1,monitorPid:process.pid,observedAt:Date.now(),live:false,phase:'monitor_error',message:String(error.message).slice(0,180)}).catch(()=>{});}
  finally{working=false;if(quitting)await release();}
 }
 async function markEnded(child,message){
  if(managed===child)managed=undefined;
  const desktop=await readJson(join(root,'.local/desktop-controller.json'));
  if(desktop?.pid===child.pid)await atomic(join(root,'.local/desktop-controller.json'),{...desktop,stoppedAt:Date.now()});
  await appendFile(join(directory,'events.jsonl'),JSON.stringify({at:Date.now(),event:'controller_ended',message})+'\n');
 }
 async function release(){const current=await readJson(lockFile);if(current?.pid===process.pid)await unlink(lockFile).catch(()=>{});}
 await poll();timer=setInterval(()=>void poll(),15000);
 process.once('beforeExit',()=>void release());
}
