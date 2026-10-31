/** Explicit real-service rehearsal: APIs + hidden audio renderer only. No desktop input or visible windows. */
import {app,safeStorage} from 'electron'
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs'
import {readFile,writeFile,mkdir,rm,stat,utimes} from 'node:fs/promises'
import {join,resolve,sep} from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {createStellarisAi} from '../apps/desktop/electron/stellaris-ai'
import {createStellarisSpeech,pcmWav} from '../apps/desktop/electron/stellaris-speech'
import {createStellarisBroadcast} from '../apps/desktop/electron/stellaris-broadcast'
import {createBilibiliRoom} from '../apps/desktop/electron/bilibili-room'
import {createBlackboard} from '../packages/core/src/ai-blackboard'
import {synthesizeQwen} from '../packages/core/src/voice'
import {inspectCaptainWav} from '../packages/core/src/captain-audio'
import {CAPTAIN_TUNED_VOICE} from '../packages/core/src/captain-tuned'
import {acquireRehearsalAudioLease} from './rehearsal-audio-lease'
import {prepareInterfaceAudio} from './captain-interface-audio'
import type {LiveEvent} from '../packages/shared/src/index'

const arg=(name:string)=>process.argv.find(x=>x.startsWith(`--${name}=`))?.slice(name.length+3)||''
if(!process.argv.includes('--run-real')){console.log('仅在 --run-real 下执行一次受控真实接口联调。');app.exit(0)}
const project=resolve(arg('project')),output=resolve(arg('run-dir')),allowed=join(project,'.local/live-api-20261029')
if(!arg('project')||!arg('run-dir')||!output.startsWith(allowed+sep)||!/^run-/.test(output.slice(allowed.length+1)))throw Error('独立联调目录无效。')
const profile=join(output,'profile'),data=join(output,'services'),game=join(output,'isolated-game')
const sourceProfile=join(app.getPath('documents'),'大肥鱼 DSH/.local/dsh-desktop')
for(const dir of [profile,join(profile,'session'),join(profile,'logs'),join(profile,'crashes'),data])mkdirSync(dir,{recursive:true,mode:0o700})
app.setName('群星控制器大肥鱼')
app.setPath('userData',profile);app.setPath('sessionData',join(profile,'session'));app.setPath('crashDumps',join(profile,'crashes'));app.setAppLogsPath(join(profile,'logs'))
app.commandLine.appendSwitch('disable-background-networking')
app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required')
// Keep the interface-only main alive until durable cleanup/reporting is complete.
app.on('window-all-closed',()=>{})
// Copy only this app's encrypted OS key state, never its login/cookie database.
try{const local=JSON.parse(readFileSync(join(sourceProfile,'Local State'),'utf8'));if(local.os_crypt)writeFileSync(join(profile,'session','Local State'),JSON.stringify({os_crypt:local.os_crypt}),{mode:0o600})}catch{/* DPAPI safeStorage may not require a Local State entry. */}

const delay=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms)),sha=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex')
const hard=new AbortController(),deadline=setTimeout(()=>hard.abort(),180000)
const keys:string[]=[],calls:any[]=[],platformRequests:any[]=[],published:any[]=[],sourceBefore:Record<string,string>={}
const counts={model:0,tts:0},report:any={schemaVersion:1,date:'2026-10-29',timezone:'Asia/Shanghai',startedAt:new Date().toISOString(),limits:{modelRequests:1,ttsRequests:1,automaticRetries:0},desktopControl:false,visibleWindows:false,mouseKeyboardInput:false,defaultAudioDevicesChanged:false,physicalMicrophoneCaptured:false,publicBroadcast:false,platformChatSent:false,sourceProfileModified:false,passed:false}
let ai:ReturnType<typeof createStellarisAi>|undefined,speech:ReturnType<typeof createStellarisSpeech>|undefined,broadcast:ReturnType<typeof createStellarisBroadcast>|undefined,room:ReturnType<typeof createBilibiliRoom>|undefined,audio:Awaited<ReturnType<typeof prepareInterfaceAudio>>|undefined,lease:ReturnType<typeof acquireRehearsalAudioLease>|undefined
const sanitize=(x:unknown)=>{let s=String(x instanceof Error?x.message:x);for(const k of keys)if(k)s=s.split(k).join('[密钥隐藏]');return s.replace(/Bearer\s+\S+/gi,'Bearer [隐藏]').replace(/https?:\/\/\S+/gi,'[地址省略]').replace(/\bsk-[A-Za-z0-9_-]{6,}\b/g,'[密钥隐藏]').slice(0,700)}
function save(){let text=JSON.stringify({...report,counts,calls,platformRequests,published,sourceFileBaseline:sourceBefore},null,2)+'\n';for(const key of keys)if(key)text=text.split(key).join('[密钥隐藏]');writeFileSync(join(output,'result.json'),text,{mode:0o600})}
function debit(kind:'model'|'tts'){
 if(hard.signal.aborted||counts[kind]>=1)throw Error('已达到本轮接口调用上限，禁止自动重试。')
 counts[kind]++;save()
}
const usageNumbers=(x:any):any=>{if(!x||typeof x!=='object')return null;const out:any={};for(const k of ['input_tokens','output_tokens','prompt_tokens','completion_tokens','total_tokens','characters','cache_read_input_tokens','cache_creation_input_tokens'])if(typeof x[k]==='number')out[k]=x[k];for(const k of ['prompt_tokens_details','completion_tokens_details'])if(x[k]&&typeof x[k]==='object')out[k]=Object.fromEntries(Object.entries(x[k]).filter(([,v])=>typeof v==='number'));return Object.keys(out).length?out:null}
async function until(test:()=>Promise<boolean>|boolean,ms:number,label:string){const end=Date.now()+ms;while(Date.now()<end){hard.signal.throwIfAborted();if(await test())return;await delay(150)}throw Error(label)}
async function main(){
 if(existsSync(join(output,'paid-run-guard.json')))throw Error('此运行目录已使用，禁止重新发起不确定的收费调用。')
 writeFileSync(join(output,'paid-run-guard.json'),JSON.stringify({pid:process.pid,at:Date.now()}),{flag:'wx',mode:0o600})
 for(const f of ['ai-hub.json','ai-keys.enc.json','captain-speech.json','captain-speech-key.enc.json','bilibili-room.json','Local State'])try{sourceBefore[f]=sha(await readFile(join(sourceProfile,f)))}catch{}
 if(!safeStorage.isEncryptionAvailable())throw Error('当前用户的系统安全存储不可用；没有发起收费请求。')
 const saved=JSON.parse(await readFile(join(sourceProfile,'ai-hub.json'),'utf8')),host=saved.agents?.find((a:any)=>a.role==='host'&&a.enabled)
 const provider=saved.providers?.find((p:any)=>p.id===host?.providerId&&p.enabled)
 if(!host?.model||!provider)throw Error('原项目没有就绪的场控模型。')
 const keyRecord=JSON.parse(await readFile(join(sourceProfile,'ai-keys.enc.json'),'utf8')),voiceKeyRecord=JSON.parse(await readFile(join(sourceProfile,'captain-speech-key.enc.json'),'utf8'))
 const modelKey=safeStorage.decryptString(Buffer.from(keyRecord[provider.id],'base64')),ttsKey=safeStorage.decryptString(Buffer.from(voiceKeyRecord.key,'base64'))
 if(!modelKey.trim()||!ttsKey.trim())throw Error('无法读取本项目已保存的加密凭据。')
 keys.push(modelKey,ttsKey)
 report.models={host:host.model,hostProviderId:provider.id,hostProtocol:provider.kind,voice:CAPTAIN_TUNED_VOICE.voice,tts:CAPTAIN_TUNED_VOICE.model}
 const codec={available:()=>safeStorage.isEncryptionAvailable(),encrypt:(s:string)=>safeStorage.encryptString(s).toString('base64'),decrypt:(s:string)=>safeStorage.decryptString(Buffer.from(s,'base64'))}
 const isolatedConfig={providers:[provider],agents:[{...host,id:'host',role:'host',enabled:true,maxTokens:Math.min(1200,Math.max(128,host.maxTokens||600))}],director:{...saved.director,idleCommentSeconds:0,replyIntervalSeconds:3,batchSize:1,hostNote:'这是一轮明确授权的接口联调，只回答收到的唯一弹幕，语气自然简短。只输出一条replies，正文30至60字；不要创建queries、toStrategist或承诺下一轮；没有实时游戏状态就坦诚描述打算，不编造正在操作。'},blackboard:createBlackboard()}
 await writeFile(join(data,'ai-hub.json'),JSON.stringify(isolatedConfig),{mode:0o600});await writeFile(join(data,'ai-keys.enc.json'),JSON.stringify({[provider.id]:keyRecord[provider.id]}),{mode:0o600})
 await mkdir(join(game,'.local/native-bridge'),{recursive:true})
 const suppliedCheckpoint=arg('checkpoint'),checkpointRoot=resolve(project,'../stellaris-player/.local')
 if(suppliedCheckpoint&&!resolve(project,suppliedCheckpoint).startsWith(checkpointRoot+sep))throw Error('测试快照必须位于本项目控制器独立资料目录。')
 const sourceGame=suppliedCheckpoint?resolve(project,suppliedCheckpoint):resolve(project,'../stellaris-player/.local/native-bridge/latest-session.json')
 try{const info=await stat(sourceGame),snapshot=JSON.parse(await readFile(sourceGame,'utf8'));snapshot.stopped=true;snapshot.observedAt=info.mtimeMs;await writeFile(join(game,'.local/native-bridge/latest-session.json'),JSON.stringify(snapshot));await utimes(join(game,'.local/native-bridge/latest-session.json'),info.atime,info.mtime);report.gameContext={mode:'historical-stopped-copy',originalObservedAt:info.mtimeMs,gameDate:snapshot.state?.date}}catch{report.gameContext={mode:'missing'}}
 lease=acquireRehearsalAudioLease(project,{durationMs:180000})
 speech=createStellarisSpeech({directory:data,getProject:async()=>game,secrets:codec,tunedSamplesDirectory:join(project,'assets/captain-tuned'),port:0,synthesize:async options=>{
  const row:any={kind:'tts',model:options.config.model,voice:options.config.voice,at:Date.now(),status:'started'};calls.push(row)
  try{
   const result=await synthesizeQwen({...options,signal:AbortSignal.any([options.signal||hard.signal,hard.signal]),onRequest:()=>{debit('tts');options.onRequest?.()},fetch:async(url,init)=>{
    const r=await fetch(url,{...init,redirect:'error'});row.httpStatus=r.status;return r
   }})
   row.status='completed';row.finishedAt=Date.now();row.usage=result.usage??null;row.characters=result.characters;row.charactersReported=result.charactersReported===true
   if(result.kind==='pcm'){const b=pcmWav(result.data||'',result.sampleRate);row.rawAudio=inspectCaptainWav(b);await writeFile(join(output,'new-tts-raw.wav'),b,{mode:0o600})}
   save();return result
  }catch(e:any){row.status='failed';row.finishedAt=Date.now();row.error=sanitize(e);row.usage=e?.usage??null;row.charactersReported=typeof e?.chargedCharacters==='number';if(row.charactersReported)row.characters=e.chargedCharacters;save();throw e}
 }})
 await speech.action({type:'save-key',key:ttsKey});const adopted=await speech.action({type:'use-tuned-voice'});if(!adopted.ok)throw Error('最后一版音色校验未通过。')
 await speech.action({type:'save-config',config:{narrateGame:false,replyAudience:true,volume:.8}})
 const started=await speech.action({type:'start'});if(!started.ok||!started.view.playerUrl)throw Error(started.message)
 console.log('独立语音接口就绪，正在检查虚拟音频通路；没有显示窗口或提交收费请求。')
 audio=await prepareInterfaceAudio({playerUrl:started.view.playerUrl,outputDirectory:output,record:true})
 report.audioPreflight=await audio.metrics();save()
 ai=createStellarisAi({dataDirectory:data,getProject:async()=>game,secrets:codec,overlayPort:0,tickMs:200,onSpoken:lines=>{
  for(const line of lines){const text=line.to?`${line.to}，${line.text}`:line.text;const queued=speech!.say({...line,text,kind:'host'});published.push({id:line.id,to:line.to,text:line.text,at:line.at,queued})}save()
 },fetch:async(url,init)=>{
  debit('model');const row:any={kind:'model',model:host.model,providerId:provider.id,at:Date.now(),status:'started'};calls.push(row);save()
  try{const r=await fetch(url,{...init,signal:AbortSignal.any([init.signal||hard.signal,hard.signal]),redirect:'error'});row.httpStatus=r.status;const body=await r.json();row.usage=usageNumbers(body?.usage||body?.usageMetadata);row.status=r.ok?'completed':'failed';row.finishedAt=Date.now();save();return {ok:r.ok,status:r.status,headers:r.headers,json:async()=>body}}
  catch(e){row.status='failed';row.error=sanitize(e);row.finishedAt=Date.now();row.usage=null;save();throw e}
 }})
 broadcast=createStellarisBroadcast({port:0,getProject:async()=>game,healthy:async()=>true,onAudienceEvent:event=>{ai!.feed(event)}})
 let selected:LiveEvent|undefined,roomId=0
 try{roomId=JSON.parse(await readFile(join(sourceProfile,'bilibili-room.json'),'utf8')).roomId}catch{}
 if(Number.isSafeInteger(roomId)&&roomId>0){
  const requested=new Set<string>()
  room=createBilibiliRoom({cookies:async()=>'',onEvent:event=>{if(!selected&&event.kind==='chat'&&event.text&&!/^\s*(点歌|切歌|下一首|播放)/.test(event.text))selected=event},fetch:async(input,init)=>{
   const u=new URL(String(input)),route=u.origin+u.pathname
   if(!['api.bilibili.com','api.live.bilibili.com'].includes(u.hostname)||requested.has(route))throw Error('本轮平台只读请求不自动重试。')
   requested.add(route);const row:any={host:u.hostname,path:u.pathname,at:Date.now()};platformRequests.push(row)
   try{const r=await fetch(input,{...init,signal:AbortSignal.any([init?.signal||hard.signal,hard.signal]),redirect:'error'});row.httpStatus=r.status;try{const body=await r.clone().json();row.serviceCode=typeof body.code==='number'?body.code:undefined;if(u.pathname.includes('room_init'))row.liveStatus=body.data?.live_status}catch{}save();return r}catch(e){row.failed=true;save();throw e}
  }})
  console.log('正在通过只读接口等待一条真实B站弹幕；不发送平台消息。')
  const roomStart=await room.start(String(roomId));report.platform={roomId,startAccepted:roomStart.ok,anonymous:true,cookiesRead:false}
  const end=Date.now()+25000
  while(!selected&&Date.now()<end&&!hard.signal.aborted){await delay(250);const state=room.view();if(state.status==='retrying'&&platformRequests.length)break}
  report.platform={...report.platform,...room.view(),realMessageReceived:!!selected};await room.dispose();room=undefined
 }else report.platform={configured:false,realMessageReceived:false}
 if(selected)report.input={source:'received-live-bilibili',eventIdSha256:sha(selected.id),receivedAt:Date.now(),text:selected.text}
 else{selected={id:'interface-test-'+randomUUID(),platform:'bilibili',kind:'chat',user:{id:'local-interface-test',name:'接口测试员'},text:arg('test-message')||'舰长你好，今天先稳后勤还是急着扩张？用两句话说说你的打算。',at:Date.now()};report.input={source:'controlled-local-injection',platformEvent:false,reason:'本轮只读平台接口未取得新弹幕',eventIdSha256:sha(selected.id),text:selected.text}}
 report.actualPlatformExchange=report.input.source==='received-live-bilibili';report.scope=report.actualPlatformExchange?'live-platform-input+real-model+real-tts+virtual-loopback':'controlled-local-input+real-model+real-tts+virtual-loopback'
 if(!(await ai.action({type:'start-chat'})).ok)throw Error('独立场控接口未启动。')
 if(!(await broadcast.operation('start')).ok)throw Error('独立弹幕输入桥未启动。')
 const connection=JSON.parse(broadcast.connectionConfig()!)
 if(report.input.source==='received-live-bilibili')await broadcast.receivePlatform(selected)
 else{for(let i=0;i<2;i++){const response=await fetch(connection.endpoint,{method:'POST',headers:connection.headers,body:JSON.stringify(selected)});if(response.status!==202)throw Error('本地认证弹幕输入未接受。')}}
 console.log('唯一问题已进入真实场控；文本模型与TTS各限一次。')
 await until(async()=>{const health=ai!.view().status.health?.host;if(health?.consecutiveFailures)throw Error('场控真实请求失败：'+sanitize(health.message));return published.length>0},100000,'没有取得可公开播放的模型回复。')
 // Stop the independent text ticker after its first public reply; speech continues.
 await ai.action({type:'stop'})
 const expectedId=published[0]?.id
 if(!expectedId||!published[0].queued)throw Error('公开回复未进入实际语音队列。')
 let downloaded=false
 await until(async()=>{
  const state=await speech!.view()
  if(state.current?.id===expectedId&&state.current.phase==='playing')report.serverObservedPlaying=true
  if(!downloaded&&state.current?.id===expectedId&&(state.current.phase==='ready'||state.current.phase==='playing')){
   const origin=new URL(started.view.playerUrl!).origin,response=await fetch(origin+'/audio/'+state.current.id);if(response.ok){const b=Buffer.from(await response.arrayBuffer());const info=inspectCaptainWav(b);await writeFile(join(output,'new-reply-played.wav'),b,{mode:0o600});report.playedAudio={...info,text:state.current.text,id:state.current.id};downloaded=true;save()}
  }
  if(state.usage.failed)throw Error('真实千问合成失败，未自动重试。')
  const metrics:any=await audio!.metrics();report.audio=metrics
  if(metrics.feedback?.some((x:any)=>x.id===expectedId&&x.kind==='error'))throw Error('实际播放器报告播放失败。')
  return metrics.feedback?.some((x:any)=>x.id===expectedId&&x.kind==='ended')===true&&!state.current
 },60000,'未取得实际播放器的结束回执。')
 await delay(650)
 report.audio=await audio.finish()
 report.speech=await speech.view();report.ai=ai.view().status
 const feedback=report.audio.feedback||[],rms=report.audio.playRmsPeak??report.audio.peakRms??0
 report.checks={realModelReply:counts.model===1&&published.length===1&&calls.some(x=>x.kind==='model'&&x.status==='completed'&&x.httpStatus===200),realTts:counts.tts===1&&calls.some(x=>x.kind==='tts'&&x.status==='completed'),freshWavSaved:downloaded,actualPlayerStarted:feedback.some((x:any)=>x.id===expectedId&&x.kind==='started')&&report.serverObservedPlaying===true,actualPlayerEnded:feedback.some((x:any)=>x.id===expectedId&&x.kind==='ended')&&!report.speech.current,noPlayerError:!feedback.some((x:any)=>x.kind==='error'),virtualAudioSignal:rms>.0005,neverShown:report.audio.neverShown===true&&report.audio.isVisible===false,neverFocused:report.audio.neverFocused===true&&report.audio.isFocused===false,sourceProfileUnchanged:false}
 if(Object.entries(report.checks).some(([k,v])=>k!=='sourceProfileUnchanged'&&!v))throw Error('部分真实接口或音频检查未通过。')
 report.passed=true
 save()
 console.log('受控真实接口链路完成：真实公开回复、新配音与虚拟音频播放回执已保存。')
}

process.on('SIGINT',()=>hard.abort());process.on('SIGTERM',()=>hard.abort())
void app.whenReady().then(main).catch(e=>{report.error=sanitize(e);report.passed=false;console.error('接口联调未通过：'+report.error)}).finally(async()=>{
 hard.abort();clearTimeout(deadline)
 try{if(audio)report.audio=await audio.finish()}catch(e){report.audioCleanupError=sanitize(e)}
 const cleanup=await Promise.allSettled([Promise.resolve(room?.dispose()),Promise.resolve(ai?.dispose()),Promise.resolve(speech?.dispose()),Promise.resolve(broadcast?.dispose()),Promise.resolve(audio?.dispose())]);lease?.release()
 report.cleanup=Object.fromEntries(['room','ai','speech','broadcast','audio'].map((name,i)=>[name,cleanup[i].status]));if(cleanup.some(x=>x.status==='rejected'))report.passed=false
 const after:Record<string,string>={};for(const f of Object.keys(sourceBefore))try{after[f]=sha(await readFile(join(sourceProfile,f)))}catch{}
 const unchanged=Object.keys(sourceBefore).every(f=>sourceBefore[f]===after[f]);report.sourceProfileModified=!unchanged;report.sourceFiles=Object.keys(sourceBefore).map(file=>({file,beforeSha256:sourceBefore[file],afterSha256:after[file],unchanged:sourceBefore[file]===after[file]}))
 if(report.checks)report.checks.sourceProfileUnchanged=unchanged
 if(!unchanged)report.passed=false
 // Public report must never contain a lease UUID, authorization header, or secret.
 if(report.speech){delete report.speech.playerUrl;delete report.speech.auditionsUrl}
 report.finishedAt=new Date().toISOString();save();keys.length=0
 for(const dir of [profile,data]){if(!resolve(dir).startsWith(output+sep))throw Error('独立资料清理路径无效。');await rm(dir,{recursive:true,force:true}).catch(()=>{})}
 app.exit(report.passed?0:1)
})
