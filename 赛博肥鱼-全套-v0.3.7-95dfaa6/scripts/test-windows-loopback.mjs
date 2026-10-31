import { _electron as electron, expect } from '@playwright/test'
import { build } from 'esbuild'
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'

if (process.platform !== 'win32') throw new Error('需要 Windows 和已安装的 VB-CABLE。')
const root=process.cwd(), testRoot=join(root,'.local/test-data'), artifacts=join(root,'.local/windows-live-setup')
await mkdir(testRoot,{recursive:true}); await mkdir(artifacts,{recursive:true})
const profile=await mkdtemp(join(testRoot,'cable-loopback-'))
const env={...process.env,CYBER_FISH_TEST_DATA_DIR:profile}; delete env.ELECTRON_RUN_AS_NODE; delete env.VITE_DEV_SERVER_URL
let app
try {
 app=await electron.launch({executablePath:join(root,'release/win-unpacked/赛博肥鱼.exe'),args:[],env,timeout:30000})
 await expect.poll(()=>app.windows().length,{timeout:20000}).toBe(2)
 const control=app.windows().find(p=>new URL(p.url()).searchParams.get('view')==='console')
 const stage=app.windows().find(p=>new URL(p.url()).searchParams.get('view')==='stage')
 await control.waitForFunction(()=>!!window.shop)
 await control.evaluate(async()=>{const {config}=await window.shop.getState();config.demo=true;config.voice.enabled=false;config.idle.enabled=false;config.music.bgmEnabled=false;config.input.enabled=false;await window.shop.command({type:'set-config',config});await window.shop.command({type:'pause'})})
 // Permission exists only in this temporary Electron process. The request below
 // uses the exact virtual input ID; physical microphones are never selected.
 await app.evaluate(({session})=>{
  session.defaultSession.setPermissionRequestHandler((_contents,permission,callback)=>callback(['media','speaker-selection'].includes(permission)))
  session.defaultSession.setPermissionCheckHandler((_contents,permission)=>['media','speaker-selection'].includes(permission))
 })
 const devices=await stage.evaluate(async()=>Array.from(await navigator.mediaDevices.enumerateDevices()).map(d=>({kind:d.kind,id:d.deviceId,label:d.label})))
 const output=devices.find(d=>d.kind==='audiooutput'&&!['default','communications'].includes(d.id)&&/(?:^CABLE Input|(?:扬声器|Speakers).*VB-Audio Virtual Cable)/i.test(d.label))
 const input=devices.find(d=>d.kind==='audioinput'&&!['default','communications'].includes(d.id)&&/^CABLE Output\b/i.test(d.label))
 expect(output,'VB-CABLE playback endpoint').toBeTruthy(); expect(input,'VB-CABLE recording endpoint').toBeTruthy()
 const bundle=await build({stdin:{contents:"export {getAudioBus} from './apps/stage/music-audio.ts';export {StageAudio} from './apps/stage/audio.ts';",resolveDir:root},bundle:true,write:false,format:'iife',globalName:'FishLoopback',platform:'browser',target:'es2022'})
 await stage.addScriptTag({content:bundle.outputFiles[0].text})
 const result=await stage.evaluate(async({input,output})=>{
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))
  const stream=await navigator.mediaDevices.getUserMedia({video:false,audio:{deviceId:{exact:input.id},echoCancellation:false,noiseSuppression:false,autoGainControl:false}})
  const track=stream.getAudioTracks()[0]
  if (!track || track.getSettings().deviceId!==input.id || !/^CABLE Output\b/i.test(track.label)) { stream.getTracks().forEach(t=>t.stop());throw new Error('录音端点不是指定的 VB-CABLE，已停止。') }
  const capture=new AudioContext(), source=capture.createMediaStreamSource(stream), analyser=capture.createAnalyser()
  analyser.fftSize=8192; source.connect(analyser); await capture.resume()
  const values=new Float32Array(analyser.fftSize)
  async function measure(){let sum=0;for(let n=0;n<8;n++){analyser.getFloatTimeDomainData(values);sum+=Math.sqrt(values.reduce((s,x)=>s+x*x,0)/values.length);await wait(70)}return sum/8}
  const {StageAudio,getAudioBus}=window.FishLoopback,player=new StageAudio(),bus=getAudioBus(),errors=[]
  let osc,gain
  try {
   const baseline=await measure()
   if(baseline>.0002)throw new Error('VB-CABLE 当前已有声音，测试停止以免混入其它应用。')
   await player.configure({mode:'live',streamDeviceId:output.id,monitorEnabled:false,monitorDeviceId:'',streamGain:.4,monitorGain:.5,speechGain:.8,musicGain:.18,ducking:.2})
   const context=await bus.ready();bus.setMuted(false)
   osc=context.createOscillator();osc.frequency.value=880;gain=context.createGain();gain.gain.value=.1;osc.connect(gain);bus.connect(gain,'music');osc.start()
   await wait(400);const musicRms=await measure()
   const pcm=new Uint8Array(24000*3*2),view=new DataView(pcm.buffer)
   for(let i=0;i<pcm.length/2;i++)view.setInt16(i*2,Math.round(Math.sin(2*Math.PI*440*i/24000)*.08*32767),true)
   let binary='';for(let offset=0;offset<pcm.length;offset+=16000)binary+=String.fromCharCode(...pcm.subarray(offset,offset+16000))
   let ended=0
   await player.play({action:'listen',face:'happy',station:'counter',commandId:'cable-test',replyId:'cable-test',muted:false,speaking:true,text:'本地虚拟声卡链路测试',audio:{kind:'pcm',data:btoa(binary),sampleRate:24000}},{progress(){},amplitude(){},status(){},error(message){errors.push(message)},ended(){ended++}})
   await wait(350);const speechRms=await measure()
   player.stop();osc.stop();osc.disconnect();gain.disconnect();bus.setSpeaking(false)
   await wait(400);const stoppedRms=await measure()
   await bus.configure({...bus.settings,streamDeviceId:'missing-windows-test-device'})
   return {inputLabel:track.label,outputLabel:output.label,inputDeviceExact:track.getSettings().deviceId===input.id,outputDeviceExact:context.sinkId===output.id,baseline,musicRms,speechRms,stoppedRms,monitorEnabled:bus.settings.monitorEnabled,disconnectedOnMissingDevice:!bus.streamConnected,failureMessage:bus.failure,errors,ended}
  } finally {player.dispose();bus.dispose();source.disconnect();analyser.disconnect();stream.getTracks().forEach(t=>t.stop());await capture.close()}
 },{input,output})
 expect(result.inputDeviceExact).toBe(true);expect(result.outputDeviceExact).toBe(true);expect(result.musicRms).toBeGreaterThan(.0005);expect(result.speechRms).toBeGreaterThan(result.musicRms*1.5);expect(result.stoppedRms).toBeLessThan(.0002);expect(result.errors).toEqual([]);expect(result.disconnectedOnMissingDevice).toBe(true);expect(result.monitorEnabled).toBe(false)
 await writeFile(join(artifacts,'loopback-report.json'),JSON.stringify({at:new Date().toISOString(),passed:true,paidApiCalls:0,physicalMicrophoneCaptured:false,...result},null,2))
 console.log(JSON.stringify({passed:true,...result},null,2))
} finally {await app?.close().catch(()=>{});if(!resolve(profile).startsWith(resolve(testRoot)+sep))throw new Error('Invalid cleanup path');await rm(profile,{recursive:true,force:true})}
