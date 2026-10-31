/** Zero-fee interface/DOM/audio verification. No desktop control, input, visible window, or credentials. */
import {app,BrowserWindow,session} from 'electron'
import {createServer,type ServerResponse} from 'node:http'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import assert from 'node:assert/strict'
import {createStellarisSpeech} from '../apps/desktop/electron/stellaris-speech'
import {createStellarisAi} from '../apps/desktop/electron/stellaris-ai'
import {CAPTAIN_TUNED_VOICE} from '../packages/core/src/captain-tuned'
import {inspectCaptainWav,tuneCaptainWav} from '../packages/core/src/captain-audio'
import {prepareInterfaceAudio} from './captain-interface-audio'

const root=process.env.CAPTION_SYNC_ROOT!,directory=process.env.CAPTION_SYNC_OUTPUT!,source=process.env.CAPTION_SYNC_SOURCE!
if(!root||!directory||!source)throw Error('Use the explicit caption-sync interface launcher')
app.setName('CyberfishCaptionInterfaceSync')
app.setPath('userData',join(directory,'profile'));app.setPath('sessionData',join(directory,'profile'))
app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required')
app.commandLine.appendSwitch('disable-background-networking')
app.on('window-all-closed',()=>{})
const report:any={schemaVersion:1,mode:'zero-fee-caption-sync-interfaces',startedAt:new Date().toISOString(),passed:false,newModelRequests:0,newTtsRequests:0,realCredentialsRead:false,desktopControl:false,mouseKeyboardInput:false,visibleWindows:false,physicalMicrophoneCaptured:false,systemDefaultChanged:false,blockedExternalRequests:0,offlineSynthCalls:0,checks:{},timings:{},injectedFaults:[]}
const wait=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms)),sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex')
const until=async(check:()=>Promise<boolean>|boolean,ms:number,message:string)=>{const end=Date.now()+ms;while(Date.now()<end){if(await check())return;await wait(30)}throw Error(message)}
const nativeFetch=globalThis.fetch
globalThis.fetch=async(input,init)=>{const u=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'){report.blockedExternalRequests++;throw Error('Sync test forbids external requests')}return nativeFetch(input,init)}
const save=()=>writeFile(join(directory,'result.json'),JSON.stringify(report,null,2)+'\n')
let speech:ReturnType<typeof createStellarisSpeech>|undefined,ai:ReturnType<typeof createStellarisAi>|undefined,audio:Awaited<ReturnType<typeof prepareInterfaceAudio>>|undefined,observer:BrowserWindow|undefined,competitor:BrowserWindow|undefined,hostWindow:BrowserWindow|undefined
let overlayServer:ReturnType<typeof createServer>|undefined,heldResolve:((value:any)=>void)|undefined
const clients=new Set<ServerResponse>(),windowFacts:any[]=[],httpResponses:any[]=[]
let overlayState:any={caption:'不应提前显示的待播计划',history:[],audience:{messages:[]},notebook:[],game:{date:'2288.07.01',paused:true,stopped:true}}
const packet=()=>`data: ${JSON.stringify(overlayState)}\n\n`
const emitPlan=(text:string)=>{overlayState={...overlayState,caption:text,history:[{id:'fixture-plan',kind:'plan',text,date:'2288.07.01',at:Date.now()}]};for(const response of clients)response.write(packet())}
const observeScript=String.raw`(()=>{const el=document.getElementById('caption');if(!el)throw Error('Real overlay caption element missing');window.__captionSyncLog=[];let last='';const capture=()=>{const x={at:Date.now(),text:el.textContent||'',id:el.dataset.playbackId||'',status:el.dataset.playbackStatus||'',sequence:el.dataset.playbackSequence||'',sessionId:el.dataset.playbackSession||''};const signature=JSON.stringify({...x,at:0});if(signature!==last){last=signature;window.__captionSyncLog.push(x)}};new MutationObserver(capture).observe(el,{subtree:true,childList:true,characterData:true,attributes:true});capture();return true})()`
const readCaption=async(window=observer!,element='caption')=>window.webContents.executeJavaScript(`(()=>{const e=document.getElementById(${JSON.stringify(element)});return {text:e.textContent||'',id:e.dataset.playbackId||'',status:e.dataset.playbackStatus||'',sessionId:e.dataset.playbackSession||'',sequence:e.dataset.playbackSequence||''}})()`)
async function hiddenOverlay(url:string,allowedOrigins:string[],label:string,element='caption'){
 const partition=`caption-sync-${randomUUID()}`,ses=session.fromPartition(partition,{cache:false})
 const w=new BrowserWindow({show:false,focusable:false,skipTaskbar:true,width:1000,height:700,webPreferences:{partition,contextIsolation:true,sandbox:true,nodeIntegration:false,backgroundThrottling:false,autoplayPolicy:'no-user-gesture-required'}})
 const facts={label,neverShown:true,neverFocused:true};windowFacts.push(facts);w.on('show',()=>facts.neverShown=false);w.on('focus',()=>facts.neverFocused=false)
 ses.setPermissionRequestHandler((_c,_p,done)=>done(false));ses.setPermissionCheckHandler(()=>false);ses.setDisplayMediaRequestHandler((_r,done)=>done({}))
 ses.webRequest.onBeforeRequest((details,done)=>{let allowed=false;try{const u=new URL(details.url);allowed=allowedOrigins.includes(u.origin)||['data:','blob:'].includes(u.protocol)}catch{}if(!allowed)report.blockedExternalRequests++;done({cancel:!allowed})})
 ses.webRequest.onCompleted(details=>{try{const u=new URL(details.url);if(u.pathname==='/player/poll')httpResponses.push({label,path:u.pathname,status:details.statusCode,at:Date.now()})}catch{}})
 w.webContents.setWindowOpenHandler(()=>({action:'deny'}));w.webContents.on('will-navigate',(e,next)=>{if(next!==url)e.preventDefault()});w.webContents.setAudioMuted(true)
 await w.loadURL(url);await w.webContents.executeJavaScript(observeScript.replace("document.getElementById('caption')",`document.getElementById(${JSON.stringify(element)})`))
 return w
}

void app.whenReady().then(async()=>{
 try{
  await mkdir(directory,{recursive:true})
  const original=JSON.parse(await readFile(join(source,'result.json'),'utf8')),line=original.playedAudio
  assert.match(line?.sha256||'',/^[a-f0-9]{64}$/)
  const raw=await readFile(join(source,'new-tts-raw.wav')),tuned=tuneCaptainWav(raw,CAPTAIN_TUNED_VOICE.gainDb,CAPTAIN_TUNED_VOICE.fadeMilliseconds)
  assert.equal(sha(tuned),line.sha256);report.fixture={sourcePaidRun:source,raw:inspectCaptainWav(raw),served:inspectCaptainWav(tuned),text:line.text}
  let pcm:Buffer|undefined,sampleRate=0
  for(let p=12;p+8<=raw.length;){const kind=raw.toString('ascii',p,p+4),size=raw.readUInt32LE(p+4),start=p+8;if(kind==='fmt ')sampleRate=raw.readUInt32LE(start+4);if(kind==='data')pcm=raw.subarray(start,start+size);p=start+size+size%2}
  assert.ok(pcm?.length&&sampleRate===24000)
  const value=()=>({kind:'pcm' as const,data:pcm!.toString('base64'),sampleRate,words:[],characters:line.text.length,usage:{inputTokens:0,outputTokens:0}})
  const controllerRoot=resolve(root,'../stellaris-player'),publicRoot=join(controllerRoot,'public')
  overlayServer=createServer(async(req,res)=>{try{
   const u=new URL(req.url||'/','http://127.0.0.1')
   if(u.pathname==='/events'){res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive'});res.write(packet());clients.add(res);req.on('close',()=>clients.delete(res));return}
   const files:Record<string,[string,string]>={'/overlay':['commentary.html','text/html; charset=utf-8'],'/playback-caption.js':['playback-caption.js','text/javascript; charset=utf-8'],'/fatfish.svg':['fatfish.svg','image/svg+xml'],'/assets/feiyu-captain-v1.png':['assets/feiyu-captain-v1.png','image/png'],'/assets/feiyu-captain-animated-v1.gif':['assets/feiyu-captain-animated-v1.gif','image/gif']}
   const file=files[u.pathname];if(!file){res.writeHead(404).end();return}res.writeHead(200,{'Content-Type':file[1],'Cache-Control':'no-store'}).end(await readFile(join(publicRoot,file[0])))
  }catch{res.writeHead(500).end()}})
  await new Promise<void>((done,fail)=>{overlayServer!.once('error',fail);overlayServer!.listen(0,'127.0.0.1',done)})
  const address=overlayServer.address();assert.ok(address&&typeof address==='object');const overlayOrigin=`http://127.0.0.1:${address.port}`
  const reserve=createServer();await new Promise<void>(done=>reserve.listen(0,'127.0.0.1',done));const hostAddress=reserve.address();assert.ok(hostAddress&&typeof hostAddress==='object');const hostPort=hostAddress.port,hostOrigin=`http://127.0.0.1:${hostPort}`;await new Promise<void>(done=>reserve.close(()=>done()))
  const codec={available:()=>true,encrypt:(s:string)=>Buffer.from(s).toString('base64'),decrypt:(s:string)=>Buffer.from(s,'base64').toString()}
  let hold=true
  speech=createStellarisSpeech({directory:join(directory,'services'),getProject:async()=>undefined,secrets:codec,port:0,tunedSamplesDirectory:join(root,'assets/captain-tuned'),playbackOrigins:[overlayOrigin,hostOrigin],synthesize:async options=>{report.offlineSynthCalls++;options.onRequest?.();return hold?new Promise(done=>heldResolve=done):value()}})
  await speech.action({type:'save-key',key:'offline-sync-fixture-not-a-real-key'});await speech.action({type:'use-tuned-voice'})
  const started=await speech.action({type:'start'});assert.equal(started.ok,true);assert.ok(started.view.playerUrl)
  const speechOrigin=new URL(started.view.playerUrl).origin
  audio=await prepareInterfaceAudio({playerUrl:started.view.playerUrl,outputDirectory:directory,record:true})
  await audio.window.webContents.executeJavaScript(String.raw`(()=>{window.__syncAudios=[];const Original=window.Audio;function Wrapped(...args){const audio=new Original(...args);window.__syncAudios.push(audio);const play=audio.play.bind(audio);audio.play=async()=>{if(!window.__syncGateOpen)await new Promise(done=>window.__syncGateRelease=done);return play()};return audio}Wrapped.prototype=Original.prototype;Object.setPrototypeOf(Wrapped,Original);window.Audio=Wrapped;window.__syncGateOpen=false;return true})()`)
  observer=await hiddenOverlay(`${overlayOrigin}/overlay?speechOrigin=${encodeURIComponent(speechOrigin)}`,[overlayOrigin,speechOrigin],'readonly-overlay')
  competitor=await hiddenOverlay(`${overlayOrigin}/overlay?voice=1&speechOrigin=${encodeURIComponent(speechOrigin)}`,[overlayOrigin,speechOrigin],'competing-iframe-overlay')
  ai=createStellarisAi({dataDirectory:join(directory,'ai-fixture'),getProject:async()=>undefined,secrets:codec,basic:true,overlayPort:hostPort,playbackOrigin:speechOrigin,fetch:async()=>{report.unexpectedModelRequests=(report.unexpectedModelRequests||0)+1;throw Error('No text-model request is permitted in caption synchronization replay')}})
  await ai.action({type:'save-key',id:'deepseek',key:'offline-host-caption-fixture'});await ai.action({type:'save-director',director:{...ai.view().director,idleCommentSeconds:0}});assert.equal((await ai.action({type:'start-chat'})).ok,true)
  hostWindow=await hiddenOverlay(ai.view().overlayUrl!,[hostOrigin,speechOrigin],'standalone-host-overlay','lines')
  await until(async()=>(await readCaption()).status==='idle',5000,'Overlay did not receive authoritative idle playback snapshot')
  assert.equal((await readCaption()).text,'');assert.equal((await readCaption(hostWindow,'lines')).text,'');report.checks.initialPlanHidden=true
  const firstId='sync-natural-'+randomUUID(),enqueuedAt=Date.now()
  assert.equal(speech.say({id:firstId,text:line.text,kind:'host',at:enqueuedAt}),true)
  await until(()=>!!heldResolve,5000,'Offline generating phase not reached')
  await wait(300);emitPlan('生成中也不能提前抢占播报字幕');await wait(150)
  assert.equal((await readCaption()).text,'');assert.equal((await readCaption(hostWindow,'lines')).text,'');assert.equal((await speech.view()).current?.phase,'generating');report.checks.generatingHidden=true
  hold=false;heldResolve!(value())
  await until(async()=>(await speech!.view()).current?.phase==='ready',5000,'Offline ready phase not reached')
  await wait(300);assert.equal((await readCaption()).text,'');assert.equal((await readCaption(hostWindow,'lines')).text,'');report.checks.readyHidden=true
  const served=await fetch(speechOrigin+'/audio/'+firstId);const bytes=Buffer.from(await served.arrayBuffer());assert.equal(sha(bytes),line.sha256);await writeFile(join(directory,'served-reply.wav'),bytes)
  await audio.window.webContents.executeJavaScript('window.__syncGateOpen=true;window.__syncGateRelease?.();true')
  await until(async()=>(await readCaption()).id===firstId&&(await readCaption()).text===line.text,5000,'Actual playing did not show matching caption')
  await until(async()=>(await readCaption(hostWindow!,'lines')).id===firstId&&(await readCaption(hostWindow!,'lines')).text===line.text,3000,'Standalone host caption did not follow actual playing')
  await until(async()=>(await readCaption(competitor!)).id===firstId,3000,'Competing iframe overlay did not receive the same active playback caption')
  emitPlan('新行动计划不能覆盖正在播放的语音');await wait(200);assert.equal((await readCaption()).text,line.text);report.checks.planCannotOverwritePlaying=true
  await until(async()=>httpResponses.some(x=>x.label==='competing-iframe-overlay'&&x.status===409),5000,'Competing iframe was not denied the existing output lease')
  report.checks.singlePlaybackLease=true
  await audio.window.webContents.executeJavaScript('window.__syncAudios[0].pause();true')
  await until(async()=>(await readCaption()).text===''&&(await readCaption(hostWindow!,'lines')).text==='',3000,'Natural pause did not clear caption');report.checks.pauseClears=true
  await audio.window.webContents.executeJavaScript('window.__syncAudios[0].play();true')
  await until(async()=>(await readCaption()).id===firstId&&(await readCaption()).text===line.text,3000,'Natural resume did not restore the matching caption');report.checks.resumeRestores=true
  await until(async()=>{const m=await audio!.metrics();return m.feedback.some(x=>x.id===firstId&&x.kind==='ended')&&!((await speech!.view()).current)},22000,'Natural ended/service clear not received')
  await until(async()=>(await readCaption()).text===''&&(await readCaption(hostWindow!,'lines')).text==='',3000,'Natural end did not clear caption');report.checks.naturalEndClears=true
  const firstMedia=(await audio.metrics()).media,log:any[]=await observer.webContents.executeJavaScript('window.__captionSyncLog')
  const playingAt=firstMedia.find(x=>x.kind==='playing')?.at,endedAt=firstMedia.find(x=>x.kind==='ended')?.at
  const shown=log.find(x=>x.id===firstId&&x.text===line.text),cleared=log.find(x=>x.at>=(endedAt||0)-2&&x.text==='')
  assert.ok(playingAt&&endedAt&&shown&&cleared);assert.ok(shown.at>=playingAt-2,'Caption led actual media playing');assert.ok(shown.at-playingAt<250,'Caption start lag exceeded local interface threshold');assert.ok(cleared.at-endedAt<250,'Caption end clear lag exceeded local interface threshold')
  report.timings={enqueueToActualPlayingMs:playingAt-enqueuedAt,playingToCaptionMs:shown.at-playingAt,endedToCaptionClearMs:cleared.at-endedAt,thresholdMs:250,note:'Local interface/DOM timing from one replay; not a guarantee of OBS or viewer latency.'};report.checks.captionTiming=true
  const hostLog:any[]=await hostWindow.webContents.executeJavaScript('window.__captionSyncLog'),hostShown=hostLog.find(x=>x.id===firstId&&x.text===line.text),hostCleared=hostLog.find(x=>x.at>=endedAt-2&&x.text==='')
  assert.ok(hostShown&&hostCleared&&hostShown.at>=playingAt-2&&hostShown.at-playingAt<250&&hostCleared.at-endedAt<250);report.timings.playingToHostCaptionMs=hostShown.at-playingAt;report.timings.endedToHostCaptionClearMs=hostCleared.at-endedAt;report.checks.standaloneHostFollowsPlaying=true
  // Real media plus explicitly labelled stale-callback fault injection, never a manufactured success receipt.
  const secondId='sync-stop-'+randomUUID(),secondEnqueuedAt=Date.now();assert.equal(speech.say({id:secondId,text:line.text,kind:'host',at:secondEnqueuedAt}),true)
  await until(async()=>(await readCaption()).id===secondId,5000,'Second real playback caption absent')
  const secondPlayingAt=(await audio.metrics()).media.filter(x=>x.kind==='playing').at(-1)?.at
  report.timings.ungatedQueueToPlayingMs=secondPlayingAt?secondPlayingAt-secondEnqueuedAt:null
  report.timings.ungatedLatencyScope='Offline PCM returns immediately; measures only application queue/audio scheduling, excluding real text-model and TTS generation.'
  await audio.window.webContents.executeJavaScript('window.__syncAudios[0].onended?.(new Event("ended"));true')
  report.injectedFaults.push({kind:'stale-old-ended-callback',purpose:'Only checks that a stale callback cannot clear the new reply; never counted as natural playback completion.'})
  await wait(100);assert.equal((await readCaption()).id,secondId);report.checks.oldEndedCannotClearNew=true
  await speech.action({type:'stop'});await until(async()=>(await readCaption()).text==='',2000,'Stop did not clear caption');report.checks.stopClears=true
  await until(async()=>(await audio!.metrics()).activeAudioCount===0,3000,'Stop did not stop the actual audio')
  await speech.action({type:'start'});const thirdId='sync-error-'+randomUUID();assert.equal(speech.say({id:thirdId,text:line.text,kind:'host',at:Date.now()}),true)
  await until(async()=>(await readCaption()).id===thirdId,5000,'Error-test real playback caption absent')
  await audio.window.webContents.executeJavaScript('(()=>{const a=window.__syncAudios.at(-1);a.src="/intentional-audio-404-for-isolated-error-test";a.load();return true})()')
  report.injectedFaults.push({kind:'404-audio-source',purpose:'Produces a natural media error in the isolated test; no paid request or desktop action.'})
  await until(async()=>(await audio!.metrics()).feedback.some(x=>x.id===thirdId&&x.kind==='error'),5000,'Natural media error feedback absent')
  await until(async()=>(await readCaption()).text==='',2000,'Playback error did not clear caption');report.checks.errorClears=true
  report.captionLog=await observer.webContents.executeJavaScript('window.__captionSyncLog');report.competingCaptionLog=await competitor.webContents.executeJavaScript('window.__captionSyncLog');report.hostCaptionLog=await hostWindow.webContents.executeJavaScript('window.__captionSyncLog');report.leaseResponses=httpResponses
  // After forced mid-buffer stop/error, allow the virtual endpoint's queued
  // samples to drain before measuring its new quiet baseline.
  await wait(700)
  report.audio=await audio.finish();assert.ok(report.audio.playRmsPeak>.0005&&report.audio.baselineRms<.0002&&report.audio.stoppedRms<.0002);report.checks.realVirtualAudioSignal=true
  report.windowFacts=windowFacts;assert.ok(windowFacts.every(x=>x.neverShown&&x.neverFocused)&&report.audio.neverShown&&report.audio.neverFocused);report.checks.noDesktopInterference=true
  report.passed=true;await save()
 }catch(error){report.passed=false;report.error=error instanceof Error?error.message:String(error);await save().catch(()=>{})}
 finally{
  try{if(audio)report.audio=await audio.finish()}catch{}
  await audio?.dispose().then(()=>report.audioDisposed=true).catch((e:Error)=>{report.cleanupError=e.message;report.passed=false})
  for(const w of [observer,competitor,hostWindow])if(w&&!w.isDestroyed())w.destroy()
  await ai?.dispose().then(()=>report.aiDisposed=true).catch((e:Error)=>{report.cleanupError=e.message;report.passed=false})
  await speech?.dispose().then(()=>report.speechDisposed=true).catch((e:Error)=>{report.cleanupError=e.message;report.passed=false})
  for(const c of clients)c.end();if(overlayServer)await new Promise<void>(done=>{overlayServer!.close(()=>done());overlayServer!.closeAllConnections()})
  report.finishedAt=new Date().toISOString();await save();console.log(JSON.stringify({passed:report.passed,timings:report.timings,checks:report.checks,newModelRequests:0,newTtsRequests:0,offlineSynthCalls:report.offlineSynthCalls,error:report.error}));app.exit(report.passed?0:1)
 }
})
