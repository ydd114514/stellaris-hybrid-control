// Explicit local rehearsal: real current game state + real QQ + simulated chat.
// Separate profile/files, read-only QQ snapshot, no streaming or game commands.
import {app,BrowserWindow,ipcMain,protocol} from 'electron'
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {readFile,writeFile,copyFile,mkdir,unlink} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {spawn} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import {createQQVault} from '../apps/desktop/electron/qq-vault'
import {createQQMusic} from '../apps/desktop/electron/qq-music'
import {createStellarisMusic} from '../apps/desktop/electron/stellaris-music'
import {createStellarisBroadcast} from '../apps/desktop/electron/stellaris-broadcast'
const real=process.argv.includes('--run-real'),base=process.cwd(),gameRoot=resolve('../stellaris-player')
const root=resolve('.local/live-rehearsals','full-'+Date.now()),artifacts=resolve('.local/artifacts/full-broadcast')
const reportFile=join(artifacts,'current.json'),account=join(process.env.USERPROFILE||'C:/Users/YDD','Documents/大肥鱼 DSH/.local/dsh-desktop')
if(real){
 mkdirSync(join(root,'profile'),{recursive:true});mkdirSync(artifacts,{recursive:true})
 const local=JSON.parse(readFileSync(join(account,'Local State'),'utf8'))
 writeFileSync(join(root,'profile/Local State'),JSON.stringify({os_crypt:local.os_crypt}))
 app.setName('大肥鱼 DSH');app.setPath('userData',join(root,'profile'))
}
protocol.registerSchemesAsPrivileged([{scheme:'shop-qqmusic',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true,corsEnabled:true}}])
if(!real){console.log('计划模式：--run-real 才运行180秒本地直播演练，不开播。');app.quit()}
else void app.whenReady().then(async()=>{
 let music:ReturnType<typeof createStellarisMusic>|undefined,bridge:ReturnType<typeof createStellarisBroadcast>|undefined,player:BrowserWindow|undefined,commentary:ReturnType<typeof spawn>|undefined
 let timer:ReturnType<typeof setInterval>|undefined,mirroring=false
 const began=Date.now(),counts={search:0,play:0,lyrics:0,details:0},captions=new Set<string>(),dates=new Set<string>(),played=new Set<string>(),messages:any[]=[],providerResults:any[]=[]
 const musicOnly=process.argv.includes('--music-only')
 const report:any={stage:'starting',scope:musicOnly?'music_retry_with_paused_game':'full_broadcast',streaming:false,simulatedAudience:true,sourceAccountWrites:0,musicWindowTitle:'大肥鱼 · 直播演练音乐',pid:process.pid,root,startedAt:began,requests:counts}
 const save=async()=>writeFile(reportFile,JSON.stringify({...report,requests:counts,gameDates:[...dates],captions:[...captions],played:[...played],messages,providerResults},null,2))
 const delay=(ms:number)=>new Promise(done=>setTimeout(done,ms))
 async function mirror(){
  if(mirroring)return;mirroring=true
  try{
   const native=join(gameRoot,'.local/native-bridge'),target=join(root,'.local/native-bridge');await mkdir(join(target,'dsh'),{recursive:true})
   const text=await readFile(join(native,'latest-session.json'),'utf8'),state=JSON.parse(text)
   await writeFile(join(target,'latest-session.json'),text)
   try{await copyFile(join(native,`session-${state.sessionId}.jsonl`),join(target,`session-${state.sessionId}.jsonl`))}catch{}
   try{await copyFile(join(native,'dsh/current.json'),join(target,'dsh/current.json'))}catch{}
   try{await copyFile(join(native,'controller.lock'),join(target,'controller.lock'))}catch{await unlink(join(target,'controller.lock')).catch(()=>{})}
  }catch{}finally{mirroring=false}
 }
 try{
  await save();const vault=createQQVault(account),secret=vault.secret;let snapshot=vault.get();if(!snapshot)throw new Error('QQ未登录')
  const old=process.env.LOG_LEVEL;process.env.LOG_LEVEL='silent'
  let provider:typeof import('@yakult-green-tea/qq-music-api/serverless')
  try{provider=await import('@yakult-green-tea/qq-music-api/serverless')}finally{if(old===undefined)delete process.env.LOG_LEVEL;else process.env.LOG_LEVEL=old}
  music=createStellarisMusic({directory:root,provider:async isAllowed=>createQQMusic({vault:{get:()=>snapshot,set:v=>{snapshot=v}},isAllowed,request:r=>{
   const u=new URL(r.url);let kind:keyof typeof counts|undefined
   if(r.method==='GET'&&u.pathname==='/search')kind='search'
   if(r.method==='GET'&&u.pathname.startsWith('/getMusicPlay/'))kind='play'
   if(r.method==='GET'&&u.pathname==='/getLyric')kind='lyrics'
   if(r.method==='GET'&&u.pathname.startsWith('/getSongInfo/'))kind='details'
   if(!kind)return Promise.resolve(new Response('{}',{status:403}));counts[kind]++;return provider.handleRequest(r,{QQ_SESSION_SECRET:secret}).then(async response=>{
    if(kind==='search'){let body:any={};try{body=await response.clone().json()}catch{};const row:any={kind,status:response.status};for(const key of ['code','upstreamCode','upstreamGlobalCode','upstreamSubCode','upstreamHttpStatus'])if(typeof body[key]==='number')row[key]=body[key];if(typeof body.errorKey==='string'&&/^[a-z-]{1,60}$/.test(body.errorKey))row.errorKey=body.errorKey;providerResults.push(row)}
    return response
   })
  }})})
  const service=music
  protocol.handle('shop-qqmusic',r=>service.stream(r));ipcMain.handle('dsh:music-view',()=>service.view());ipcMain.handle('dsh:music-feedback',(_,g,k)=>service.feedback(g,k))
  player=new BrowserWindow({width:610,height:180,title:report.musicWindowTitle,autoHideMenuBar:true,webPreferences:{preload:resolve('dist/dsh/electron/preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false,autoplayPolicy:'no-user-gesture-required'}})
  player.on('page-title-updated',e=>e.preventDefault());await player.loadFile(resolve('dist/dsh/renderer/music-player.html'))
  if(process.argv.includes('--muted')){player.webContents.setAudioMuted(true);report.mutedPlayer=true}
  await mirror();timer=setInterval(()=>void mirror(),1000)
  const env={...process.env,CYBERFISH_COMMENTARY_TEST_ROOT:root,CYBERFISH_COMMENTARY_PORT:'0'};delete env.DEEPSEEK_API_KEY;delete env.ELECTRON_RUN_AS_NODE
  commentary=spawn('C:/Program Files/nodejs/node.exe',[join(gameRoot,'scripts/commentary-server.mjs')],{env,windowsHide:true,stdio:'ignore'})
  let server:any
  for(let i=0;i<60&&!server;i++){try{server=JSON.parse(await readFile(join(root,'.local/commentary/server.json'),'utf8'))}catch{await delay(100)}}
  if(!server)throw new Error('字幕服务未启动')
  bridge=createStellarisBroadcast({port:0,getProject:async()=>root,healthy:async()=>true,onAudienceEvent:e=>service.event(e)})
  await bridge.operation('start');const config=JSON.parse(bridge.connectionConfig()!)
  const enabled=await service.action('start');if(!enabled.ok)throw new Error('音乐未开启')
  report.overlayUrl=server.url+'/overlay';report.stage='ready';report.readyAt=Date.now();await save()
  async function message(id:string,text:string,user='u1'){
   const payload={id:'full-rehearsal-'+id,platform:'bilibili',kind:'chat',user:{id:'rehearsal-'+user,name:'模拟观众 '+user},text,at:Date.now()}
   const r=await fetch(config.endpoint,{method:'POST',headers:config.headers,body:JSON.stringify(payload)});if(r.status!==202)throw new Error('模拟消息未接受')
  }
  const sent=new Set<string>(),until=Date.now()+(musicOnly?110000:180000)
  while(Date.now()<until){
   const seconds=(Date.now()-report.readyAt)/1000
   if(seconds>=3&&!sent.has('hello')){await message('hello','【本地演练】画面和字幕能看见吗？');await message('hello','【本地演练】画面和字幕能看见吗？');sent.add('hello')}
   if(seconds>=20&&!sent.has('song')){await message('song','点歌 晴天 周杰伦');sent.add('song')}
   if(seconds>=65&&!sent.has('talk')){await message('talk','【本地演练】肥鱼记得兼顾星球和舰队。','u2');sent.add('talk')}
   if(seconds>=90&&!sent.has('cooldown')){await message('cooldown','点歌 夜曲 周杰伦');sent.add('cooldown')}
   const v=await service.view(),track=v.state.tracks.find(t=>t.id===v.state.current?.trackId)
   report.music={status:v.state.status,title:track?.title,startedAt:v.state.current?.startedAt,message:v.state.lastMessage,queued:v.state.queue.length}
   if(messages.at(-1)?.text!==v.state.lastMessage)messages.push({seconds:Math.round(seconds),text:v.state.lastMessage,status:v.state.status,title:track?.title,searches:v.state.searches.length})
   if(track&&v.state.current?.startedAt)played.add(track.title)
   try{const s=await(await fetch(server.url+'/api/state')).json();if(s.caption)captions.add(s.caption);if(s.game?.date)dates.add(s.game.date);report.audienceCount=s.audience.messages.length;report.notebookCount=s.notebook?.length;report.voiceDisabled=s.voiceEnabled===false;report.audioAbsent=s.audio===null}catch{}
   try{const stop=await import('node:fs/promises').then(f=>f.stat(join(gameRoot,'.local/STOP')));if(stop.mtimeMs>=began){report.userStopped=true;break}}catch{}
   await save();await delay(1000)
  }
  report.stage='audio_stopping';await service.action('stop');await delay(1000)
  const final=await service.view();report.musicStopped=!final.enabled&&!final.state.current
  report.passed=played.has('晴天')&&(musicOnly||captions.size>1&&dates.size>1)&&report.audienceCount===4&&report.voiceDisabled&&report.musicStopped
  report.stage='ready_to_finish_recording';await save();await delay(10000)
 }catch{report.stage='failed';report.passed=false;report.error='本地演练中断；以最后公开状态定位，不输出账号或音源凭据';await save()}
 finally{clearInterval(timer);await bridge?.dispose();await music?.dispose();player?.destroy();commentary?.kill();protocol.unhandle('shop-qqmusic');report.stage='finished';report.finishedAt=Date.now();await save();app.quit()}
})
