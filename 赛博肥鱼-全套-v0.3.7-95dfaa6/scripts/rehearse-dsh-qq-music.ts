// Manual --run-real only: actual QQ session snapshot, authenticated local chat,
// real media decoding in a muted isolated player. Never alters source account.
import {app,BrowserWindow,ipcMain,protocol} from 'electron'
import {mkdtemp,writeFile,rm,realpath} from 'node:fs/promises'
import {join,resolve,dirname,basename} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {createQQVault} from '../apps/desktop/electron/qq-vault'
import {createQQMusic} from '../apps/desktop/electron/qq-music'
import {createStellarisMusic} from '../apps/desktop/electron/stellaris-music'
import {createStellarisBroadcast} from '../apps/desktop/electron/stellaris-broadcast'
protocol.registerSchemesAsPrivileged([{scheme:'shop-qqmusic',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true,corsEnabled:true}}])
const reportFile=resolve('.local/artifacts/qq-music-real-rehearsal.json')
const root=process.argv.includes('--run-real')?mkdtempSync(join(tmpdir(),'cyberfish-real-qq-')):''
const accountDirectory=join(process.env.USERPROFILE||'C:/Users/YDD','Documents','大肥鱼 DSH','.local/dsh-desktop')
if(root){
 const profile=join(root,'profile');mkdirSync(profile)
 // safeStorage on Windows uses a profile key protected by DPAPI. Reuse only
 // this app's encrypted os_crypt envelope in an ephemeral, same-user profile;
 // never clone browser cookies or write the owner's Local State/vault.
 const local=JSON.parse(readFileSync(join(accountDirectory,'Local State'),'utf8'))
 writeFileSync(join(profile,'Local State'),JSON.stringify({os_crypt:local.os_crypt}))
 app.setName('大肥鱼 DSH');app.setPath('userData',profile)
}
if(!process.argv.includes('--run-real')){console.log('计划模式：--run-real 才读取本桌面已保存QQ授权，运行静音本地演练。');app.quit()}
else void app.whenReady().then(async()=>{
 let music:ReturnType<typeof createStellarisMusic>|undefined,bridge:ReturnType<typeof createStellarisBroadcast>|undefined,window:BrowserWindow|undefined
 let report:Record<string,unknown>={passed:false,streaming:false,gameStarted:false,mutedPlayer:true,sourceVaultWrites:0,deepseekCalls:0},timer:ReturnType<typeof setTimeout>|undefined
 const calls={search:0,details:0,play:0,lyrics:0,blockedAccountWrites:0};let audioBytes=0
 const pause=(ms:number)=>new Promise(done=>setTimeout(done,ms))
 const checkpoint=async(stage:string,extra:Record<string,unknown>={})=>{report={...report,stage,...extra};await writeFile(reportFile,JSON.stringify({...report,audioBytes,requests:calls},null,2))}
 try{
  await checkpoint('loading_readonly_account')
  // Same application's Windows DPAPI vault, copied only into memory.
  const vault=createQQVault(accountDirectory)
  await checkpoint('decrypting_same_app_snapshot')
  const secret=vault.secret
  let snapshot=vault.get();if(!snapshot)throw new Error('需要用户先扫码登录')
  await checkpoint('account_snapshot_loaded')
  const previous=process.env.LOG_LEVEL;process.env.LOG_LEVEL='silent'
  let provider:typeof import('@yakult-green-tea/qq-music-api/serverless')
  try{provider=await import('@yakult-green-tea/qq-music-api/serverless')}finally{if(previous===undefined)delete process.env.LOG_LEVEL;else process.env.LOG_LEVEL=previous}
  music=createStellarisMusic({directory:root,provider:async isAllowed=>createQQMusic({vault:{get:()=>snapshot,set:value=>{snapshot=value}},isAllowed,request:request=>{
   const url=new URL(request.url);let kind:'search'|'details'|'play'|'lyrics'|undefined
   if(request.method==='GET'&&url.pathname==='/search')kind='search'
   if(request.method==='GET'&&url.pathname.startsWith('/getSongInfo/'))kind='details'
   if(request.method==='GET'&&url.pathname.startsWith('/getMusicPlay/'))kind='play'
   if(request.method==='GET'&&url.pathname==='/getLyric')kind='lyrics'
   if(!kind){calls.blockedAccountWrites++;return Promise.resolve(new Response('{}',{status:403}))}
   calls[kind]++;return provider.handleRequest(request,{QQ_SESSION_SECRET:secret})
  }})})
  const service=music
  protocol.handle('shop-qqmusic',async request=>{
   const response=await service.stream(request)
   if(!response.body)return response
   const reader=response.body.getReader()
   return new Response(new ReadableStream({async pull(c){const next=await reader.read();if(next.done)c.close();else{audioBytes+=next.value.byteLength;c.enqueue(next.value)}},cancel(){return reader.cancel()}}),{status:response.status,headers:response.headers})
  })
  ipcMain.handle('dsh:music-view',()=>service.view());ipcMain.handle('dsh:music-feedback',(_,g,k)=>service.feedback(g,k))
  window=new BrowserWindow({width:650,height:230,title:'大肥鱼 · 静音QQ点歌演练',webPreferences:{preload:resolve('dist/dsh/electron/preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,autoplayPolicy:'no-user-gesture-required'}})
  window.on('page-title-updated',event=>event.preventDefault())
  window.webContents.setAudioMuted(true);await window.loadFile(resolve('dist/dsh/renderer/music-player.html'))
  const started=await service.action('start');if(!started.ok)throw new Error('QQ授权不可用')
  await checkpoint('isolated_player_started')
  bridge=createStellarisBroadcast({port:0,getProject:async()=>root,healthy:async()=>true,onAudienceEvent:event=>service.event(event)})
  await bridge.operation('start');const config=JSON.parse(bridge.connectionConfig()!)
  const id='local-music-rehearsal-'+randomUUID(),event={id,platform:'bilibili',kind:'chat',user:{id:'local-rehearsal-u1',name:'本地模拟观众'},text:'点歌 晴天 周杰伦',at:Date.now()}
  const post=()=>fetch(config.endpoint,{method:'POST',headers:config.headers,body:JSON.stringify(event)})
  if((await post()).status!==202||(await post()).status!==202)throw new Error('本地消息未接受')
  await checkpoint('authenticated_request_delivered')
  const end=Date.now()+65000
  let state=await service.view()
  let last='';while(Date.now()<end){state=await service.view();const track=state.state.tracks.find(x=>x.id===state.state.current?.trackId)
   const status=JSON.stringify([state.state.status,track?.title,state.state.lastMessage,state.state.searches.length]);if(last!==status){last=status;await checkpoint('waiting_for_real_playback',{status:state.state.status,currentTitle:track?.title,message:state.state.lastMessage,searches:state.state.searches.length})}
   if(state.state.current?.eventId===`bilibili:${id}`&&state.state.current.startedAt&&track){report={...report,requestId:id,title:track.title,artist:track.artist,trackId:track.id,generation:state.state.current.generationId,playingAcknowledged:true};break}
   await pause(500)
  }
  if(!report.playingAcknowledged)throw new Error('陌生歌曲未取得实际播放回执')
  await pause(3000)
  const generation=state.state.current!.generationId
  await service.action('stop');service.feedback(generation,'ended');service.feedback(generation,'started')
  await pause(900)
  const final=await service.view(),rows=(await import('node:fs/promises')).readFile
  const messages=(await rows(join(root,'.local/commentary/audience.jsonl'),'utf8')).trim().split('\n').length
  report={...report,passed:!final.enabled&&!final.state.current&&audioBytes>0&&messages===1,sourceVaultWrites:0,audioBytes,duplicateMessagesWritten:messages,stopped:!final.enabled,lateCallbacksIgnored:!final.state.current,requests:calls,localInputStopped:true}
 }catch{report={...report,passed:false,reason:'QQ静音实测未完成，请查看非敏感播放状态或检查账号与网络',audioBytes,requests:calls}}
 finally{
  clearTimeout(timer);await bridge?.dispose();await music?.dispose();window?.destroy();protocol.unhandle('shop-qqmusic')
  await writeFile(reportFile,JSON.stringify(report,null,2))
  const p=await realpath(root);if(dirname(p)===await realpath(tmpdir())&&basename(p).startsWith('cyberfish-real-qq-'))await rm(p,{recursive:true,force:true})
  app.quit()
 }
})
