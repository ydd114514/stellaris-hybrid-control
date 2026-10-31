/** Replay only the already-created real reply. No account data or paid API is used. */
import {app} from 'electron'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {createStellarisSpeech} from '../apps/desktop/electron/stellaris-speech'
import {inspectCaptainWav,tuneCaptainWav} from '../packages/core/src/captain-audio'
import {CAPTAIN_TUNED_VOICE} from '../packages/core/src/captain-tuned'
import {prepareInterfaceAudio} from './captain-interface-audio'

const root=process.env.CAPTAIN_REPLAY_ROOT!,directory=process.env.CAPTAIN_REPLAY_OUTPUT!,source=process.env.CAPTAIN_REPLAY_SOURCE!
if(!root||!directory||!source)throw Error('Playback-only launcher parameters missing')
app.setName('CyberfishInterfaceAudioReplay')
app.setPath('userData',join(directory,'profile'));app.setPath('sessionData',join(directory,'profile'))
app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required')
// Do not let destruction of the final hidden audio window skip report finalization.
app.on('window-all-closed',()=>{})
const expected='d02cd8266786d3a0a196bb1669db802c4395dfbc0b1e681727cdeff00bc2deee'
const report:any={schemaVersion:1,mode:'playback-only-of-new-real-tts',startedAt:new Date().toISOString(),passed:false,newModelRequests:0,newTtsRequests:0,realCredentialsRead:false,sourceProfileModified:false,desktopControl:false,visibleWindows:false,mouseKeyboardInput:false,physicalMicrophoneCaptured:false,defaultAudioDevicesChanged:false,blockedExternalRequests:0,offlineSynthCalls:0,sourcePaidRun:source,expectedSha256:expected}
let speech:ReturnType<typeof createStellarisSpeech>|undefined,audio:Awaited<ReturnType<typeof prepareInterfaceAudio>>|undefined
const nativeFetch=globalThis.fetch
globalThis.fetch=async(input,init)=>{
 const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url)
 if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'){report.blockedExternalRequests++;throw Error('Playback-only mode forbids external requests')}
 return nativeFetch(input,init)
}
const wait=(ms:number)=>new Promise<void>(done=>setTimeout(done,ms))
const until=async(check:()=>Promise<boolean>,ms:number,message:string)=>{const end=Date.now()+ms;while(Date.now()<end){if(await check())return;await wait(100)}throw Error(message)}
const save=()=>writeFile(join(directory,'result.json'),JSON.stringify(report,null,2)+'\n')

void app.whenReady().then(async()=>{
 try{
  await mkdir(directory,{recursive:true})
  const original=JSON.parse(await readFile(join(source,'result.json'),'utf8')),line=original.playedAudio
  if(typeof line?.text!=='string'||typeof line?.id!=='string'||line.sha256!==expected)throw Error('Original paid reply metadata mismatch')
  const raw=await readFile(join(source,'new-tts-raw.wav')),rawInfo=inspectCaptainWav(raw)
  const tuned=tuneCaptainWav(raw,CAPTAIN_TUNED_VOICE.gainDb,CAPTAIN_TUNED_VOICE.fadeMilliseconds)
  if(createHash('sha256').update(tuned).digest('hex')!==expected)throw Error('Replayed raw file does not reproduce the real served WAV')
  let pcm:Buffer|undefined,sampleRate=0,channels=0,bits=0
  for(let p=12;p+8<=raw.length;){const kind=raw.toString('ascii',p,p+4),size=raw.readUInt32LE(p+4),start=p+8;if(start+size>raw.length)throw Error('Invalid WAV chunk');if(kind==='fmt '){channels=raw.readUInt16LE(start+2);sampleRate=raw.readUInt32LE(start+4);bits=raw.readUInt16LE(start+14)}if(kind==='data')pcm=raw.subarray(start,start+size);p=start+size+size%2}
  if(!pcm?.length||channels!==1||bits!==16||sampleRate!==24000)throw Error('Replay requires verified mono PCM16 24kHz')
  report.rawAudio=rawInfo;report.reply={id:line.id,text:line.text,duration:line.duration}
  const codec={available:()=>true,encrypt:(value:string)=>Buffer.from(value).toString('base64'),decrypt:(value:string)=>Buffer.from(value,'base64').toString()}
  speech=createStellarisSpeech({directory:join(directory,'services'),getProject:async()=>undefined,tunedSamplesDirectory:join(root,'assets/captain-tuned'),port:0,secrets:codec,synthesize:async options=>{
   report.offlineSynthCalls++;if(report.offlineSynthCalls!==1)throw Error('Replay synth called more than once')
   if(options.text!==line.text||options.config.voice!==CAPTAIN_TUNED_VOICE.voice)throw Error('Replay voice/text mismatch')
   options.onRequest?.();return {kind:'pcm',data:pcm!.toString('base64'),sampleRate,words:[],characters:line.text.length,usage:{inputTokens:0,outputTokens:0}}
  }})
  if(!(await speech.action({type:'save-key',key:'offline-replay-fixture-no-real-key'})).ok)throw Error('Offline fixture setup failed')
  if(!(await speech.action({type:'use-tuned-voice'})).ok)throw Error('Bundled voice sample not ready')
  const started=await speech.action({type:'start'});if(!started.ok||!started.view.playerUrl)throw Error('Replay speech service did not start')
  audio=await prepareInterfaceAudio({playerUrl:started.view.playerUrl,outputDirectory:directory,record:true})
  report.preflight=await audio.metrics();await save()
  if(!speech.say({id:line.id,text:line.text,kind:'host',at:Date.now()}))throw Error('Replay queue rejected the public reply')
  await speech.poll()
  await until(async()=>!!(await speech!.view()).current&&['ready','playing'].includes((await speech!.view()).current!.phase),10000,'Replay audio not ready')
  const served=await fetch(audio.origin+'/audio/'+line.id);if(!served.ok)throw Error('Replay WAV was not served')
  const servedBytes=Buffer.from(await served.arrayBuffer()),servedInfo=inspectCaptainWav(servedBytes)
  if(servedInfo.sha256!==expected)throw Error('Served replay audio SHA mismatch')
  await writeFile(join(directory,'served-reply.wav'),servedBytes);report.servedAudio=servedInfo
  let playingObserved=false
  await until(async()=>{
   const s=await speech!.view(),m=await audio!.metrics();if(s.current?.phase==='playing')playingObserved=true
   report.audio=m;report.serverPlayingObserved=playingObserved
   return m.feedback.some(x=>x.id===line.id&&x.kind==='started')&&m.feedback.some(x=>x.id===line.id&&x.kind==='ended')&&!s.current
  },30000,'Natural started/ended and cleared server current were not confirmed')
  report.beforeFinish=await audio.metrics();report.audio=await audio.finish();report.finishCompleted=true
  const m=report.audio
  if(!playingObserved||m.baselineRms>=.0002||m.playRmsPeak<=.0005||m.playSamples<1||m.stoppedRms>=.0002||!m.neverShown||!m.neverFocused||m.isVisible||m.isFocused||m.activeAudioCount!==0||!m.finished)throw Error('Replay loopback or hidden-window invariants failed')
  if(!m.media.some((x:any)=>x.kind==='playing'&&!x.muted&&x.volume>0&&x.outputExact)||!m.media.some((x:any)=>x.kind==='ended'))throw Error('Natural unmuted media playback events absent')
  report.serverCurrentCleared=true;report.passed=true;await save()
 }catch(error){report.passed=false;report.error=error instanceof Error?error.message:String(error);await save().catch(()=>{})}
 finally{
  await audio?.dispose().then(()=>{report.audioDisposed=true}).catch((e:Error)=>{report.cleanupError=e.message;report.passed=false})
  await speech?.dispose().then(()=>{report.speechDisposed=true}).catch((e:Error)=>{report.cleanupError=e.message;report.passed=false})
  report.finishedAt=new Date().toISOString();await save();console.log(JSON.stringify({passed:report.passed,newModelRequests:0,newTtsRequests:0,offlineSynthCalls:report.offlineSynthCalls,finishCompleted:report.finishCompleted,audioDisposed:report.audioDisposed,speechDisposed:report.speechDisposed,error:report.error}));app.exit(report.passed?0:1)
 }
})
