import { _electron as electron, expect } from '@playwright/test'
import { build } from 'esbuild'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import electronPath from 'electron'

// Real device routing, zero-amplitude fixtures, and isolated application data only.
const root = process.cwd(), folder = await mkdtemp(join(tmpdir(),'cyber-fish-audio-v2-'))
const profile = join(folder,'live-profile'), testProfile=join(folder,'test-profile')
const artifacts=join(root,'.local','validation-v2')
await mkdir(artifacts,{recursive:true})
function defaults() {
 const data=JSON.parse(execFileSync('/usr/sbin/system_profiler',['SPAudioDataType','-json'],{encoding:'utf8'}))
 const items=data.SPAudioDataType.flatMap(group=>group._items||[])
 return {output:items.filter(x=>x.coreaudio_default_audio_output_device==='spaudio_yes').map(x=>x._name),input:items.filter(x=>x.coreaudio_default_audio_input_device==='spaudio_yes').map(x=>x._name),system:items.filter(x=>x.coreaudio_default_audio_system_device==='spaudio_yes').map(x=>x._name)}
}
const before=defaults()
const env={...process.env,CYBER_FISH_TEST_DATA_DIR:profile}
delete env.ELECTRON_RUN_AS_NODE;delete env.VITE_DEV_SERVER_URL
const packaged=process.argv.includes('--packaged')
const executablePath=packaged?(process.env.CYBER_FISH_PACKAGED_APP||join(root,'release/mac-arm64/赛博肥鱼.app/Contents/MacOS/赛博肥鱼')):electronPath
const args=packaged?[]:['.']
let application,local
async function assertTitles(instance,localTest=false){
 const expected=localTest?{console:'赛博肥鱼 · 本地测试工作台',stage:'赛博肥鱼 · 本地测试画面（不推流）'}:{console:'赛博肥鱼 · 小店后台',stage:'赛博肥鱼 · 抖音直播采集（9:16）'}
 await expect.poll(()=>instance.evaluate(({BrowserWindow})=>Object.fromEntries(BrowserWindow.getAllWindows().map(window=>[new URL(window.webContents.getURL()).searchParams.get('view'),window.getTitle()])))).toEqual(expected)
}
async function ready(instance,localTest=false){await expect.poll(()=>instance.windows().length,{timeout:20000}).toBe(2);await Promise.all(instance.windows().map(page=>page.waitForURL(/file:/)));const control=instance.windows().find(page=>new URL(page.url()).searchParams.get('view')==='console'),stage=instance.windows().find(page=>new URL(page.url()).searchParams.get('view')==='stage');await control.waitForFunction(()=>!!window.shop);await expect(stage.getByTestId('stage')).toHaveAttribute('data-loaded','true',{timeout:20000});await assertTitles(instance,localTest);return {control,stage}}
try {
 application=await electron.launch({executablePath,args,env,timeout:30000})
 const {control,stage}=await ready(application)
 const initial=await control.evaluate(async()=>{
  const state=await window.shop.getState();state.config.demo=true;state.config.voice.enabled=false;state.config.idle.enabled=false;state.config.input.enabled=false;state.config.vote.enabled=true;await window.shop.command({type:'set-config',config:state.config});return window.shop.command({type:'get-runtime-info'})
 })
 expect(initial.ok).toBe(true);expect(initial.data.dataDirectory).toBe(profile);expect(initial.data.driverInstalled).toBe(true)
 // Verify the real native titles after load and after a later renderer update.
 await Promise.all([control,stage].map(page=>page.evaluate(()=>{document.title='不应覆盖原生窗口标题'})))
 await assertTitles(application)
 const devices=await stage.evaluate(async()=>Array.from(await navigator.mediaDevices.enumerateDevices()).filter(device=>device.kind==='audiooutput').map(device=>({id:device.deviceId,label:device.label})))
 const virtual=devices.find(device=>/BlackHole.*2ch/i.test(device.label)),monitor=devices.find(device=>/Mac mini/i.test(device.label))||devices.find(device=>device.id==='default')
 expect(virtual,'BlackHole 2ch must be installed for this real device test').toBeTruthy();expect(monitor).toBeTruthy()
 const browserBundle=await build({stdin:{contents:"export {getAudioBus,MusicAudio} from './apps/stage/music-audio.ts';export {StageAudio} from './apps/stage/audio.ts';",resolveDir:root},bundle:true,write:false,platform:'browser',format:'iife',globalName:'CyberFishAudioTest',target:'es2022'})
 await stage.addScriptTag({content:browserBundle.outputFiles[0].text})
 const routing=await stage.evaluate(async({virtualId,monitorId})=>{
  const {StageAudio,getAudioBus}=window.CyberFishAudioTest,player=new StageAudio(),bus=getAudioBus()
  const config={mode:'live',streamDeviceId:virtualId,monitorEnabled:false,monitorDeviceId:monitorId,streamGain:1,monitorGain:.5,speechGain:1,musicGain:.35,ducking:.2}
  const original=AudioContext.prototype.setSinkId,calls=[]
  AudioContext.prototype.setSinkId=function(id){calls.push(id);return original.call(this,id)}
  const errors=[],status=[],amplitude=[];let ended=0
  try {
   await player.configure(config);const context=bus.audioContext
   const samples=new Uint8Array(24000*2*2)
   // Encode without spreading a large buffer into the JS argument stack.
   let binary='';for(let offset=0;offset<samples.length;offset+=16000)binary+=String.fromCharCode(...samples.subarray(offset,offset+16000))
   const complete=new Promise(resolve=>{
    void player.play({action:'listen',face:'happy',station:'counter',commandId:'zero-audio',replyId:'zero',muted:false,speaking:true,text:'无声路由验证',audio:{kind:'pcm',data:btoa(binary),sampleRate:24000}}, {progress(){},amplitude(value){amplitude.push(value)},ended(){ended++;resolve()},status(message){status.push(message)},error(message){errors.push(message)}})
   })
   await new Promise(resolve=>setTimeout(resolve,180));const beforeToggle=ended
   await player.configure({...config,monitorEnabled:true});await new Promise(resolve=>setTimeout(resolve,120));await player.configure(config)
   const sameContext=bus.audioContext===context,sinkId=context.sinkId
   await Promise.race([complete,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Zero PCM did not finish')),6000))])
   await player.configure({...config,streamDeviceId:'missing-test-device'})
   const disconnected=!bus.streamConnected,failure=bus.failure
   return {sameContext,sinkId,calls,beforeToggle,ended,errors,status,peak:Math.max(0,...amplitude),disconnected,failure}
  }finally{AudioContext.prototype.setSinkId=original;player.dispose()}
 },{virtualId:virtual.id,monitorId:monitor.id})
 expect(routing.sameContext).toBe(true);expect(routing.sinkId).toBe(virtual.id);expect(routing.calls.filter(id=>id===virtual.id)).toHaveLength(1);expect(routing.beforeToggle).toBe(0);expect(routing.ended).toBe(1);expect(routing.peak).toBe(0);expect(routing.errors).toEqual([]);expect(routing.disconnected).toBe(true);expect(routing.failure).toContain('无法连接所选直播声卡')
 // Import through the real IPC service, but replace the native chooser only in this test process.
 const wavPath=join(folder,'silent-fixture.wav'),badPath=join(folder,'unsupported.txt'),frames=24000*3,wav=Buffer.alloc(44+frames*2)
 wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(24000,24);wav.writeUInt32LE(48000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(frames*2,40)
 await writeFile(wavPath,wav);await writeFile(badPath,'not an audio file')
 await application.evaluate(({dialog},{wavPath,badPath})=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[wavPath,badPath]})},{wavPath,badPath})
 const imported=await control.evaluate(()=>window.shop.command({type:'import-music'}));expect(imported.ok).toBe(true);expect(imported.data.tracks).toHaveLength(1);expect(imported.message).toContain('1 个文件')
 const again=await control.evaluate(()=>window.shop.command({type:'import-music'}));expect(again.data.tracks[0].id).toBe(imported.data.tracks[0].id)
 const source=imported.data.tracks[0].source
 const fetched=await stage.evaluate(async source=>{const response=await fetch(source,{headers:{Range:'bytes=0-43'}});return {status:response.status,length:(await response.arrayBuffer()).byteLength}},source)
 expect(fetched.status).toBe(206);expect(fetched.length).toBe(44)
 const permission=await control.evaluate(async()=>{
  const options=[{id:'night-a',kind:'activity',title:'泡晚安茶',about:'测试投票'},{id:'night-b',kind:'activity',title:'听雨',about:'测试投票'}]
  const vote=await window.shop.command({type:'vote-open',title:'测试计划',minutes:1,options});const close=await window.shop.command({type:'vote-close'})
  const topup=await window.shop.command({type:'wallet-topup',yuan:1});const archive=await window.shop.command({type:'archive-query',userId:'test-viewer'})
  await window.shop.command({type:'start'});return {vote,close,topup,archive}
 });expect(permission.vote.ok).toBe(true);expect(permission.close.ok).toBe(true);expect(permission.topup.ok).toBe(true);expect(permission.archive.ok).toBe(true)
 await control.evaluate(async tracks=>{await window.shop.command({type:'music-set-tracks',tracks});return window.shop.command({type:'music-play',trackId:tracks[0].id})},imported.data.tracks)
 await expect.poll(async()=>control.evaluate(async()=>(await window.shop.getState()).music.status),{timeout:10000}).toBe('stopped')
 const catalog=JSON.parse(await readFile(join(profile,'media','catalog.json'),'utf8'));expect(catalog).toHaveLength(1)
 await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(window=>new URL(window.webContents.getURL()).searchParams.get('view')==='console').close())
 expect(await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(window=>new URL(window.webContents.getURL()).searchParams.get('view')==='console').isVisible())).toBe(false)
 expect((await control.evaluate(()=>window.shop.getState())).running).toBe(true)
 expect(await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(window=>new URL(window.webContents.getURL()).searchParams.get('view')==='stage').isVisible())).toBe(true)
 // A separately launched local test is isolated even while the broadcast runtime remains active.
 local=await electron.launch({executablePath,args:[...args,'--cyberfish-local-test'],env:{...env,CYBER_FISH_TEST_DATA_DIR:testProfile},timeout:30000})
 const localViews=await ready(local,true)
 const isolation=await localViews.control.evaluate(async()=>{
  const config=(await window.shop.getState()).config;config.demo=false;config.audio.mode='live';config.input.enabled=true;await window.shop.command({type:'set-config',config})
  const key=await window.shop.command({type:'save-key',provider:'deepseek',key:'invalid-test-only'}),input=await window.shop.command({type:'input-start'}),state=await window.shop.getState();return {demo:state.config.demo,audio:state.config.audio.mode,inputEnabled:state.config.input.enabled,key:key.ok,input:input.ok,info:await window.shop.command({type:'get-runtime-info'})}
 });expect(isolation).toMatchObject({demo:true,audio:'test',inputEnabled:false,key:false,input:false});expect(isolation.info.data.dataDirectory).toBe(testProfile);await assertTitles(local,true)
 await local.close();local=undefined
 expect((await control.evaluate(()=>window.shop.getState())).running).toBe(true)
 await stage.screenshot({path:join(artifacts,'audio-v2-capture.png')})
 const after=defaults();expect(after).toEqual(before)
 const report={at:new Date().toISOString(),blackholeDetected:true,defaultDevicesUnchanged:true,defaults:after,pcm:{sameContext:routing.sameContext,monitorDoesNotRestart:routing.beforeToggle===0,ended:routing.ended,zeroAmplitude:routing.peak===0,invalidSinkDisconnected:routing.disconnected},media:{imported:1,reimportDeduplicated:true,rangeResponse:fetched.status},desktopCommands:true,closeConsoleKeepsRunning:true,localTestIsolation:true,distinctStableCaptureTitles:true}
 await writeFile(join(artifacts,'audio-v2-report.json'),JSON.stringify(report,null,2))
 console.log('Audio v2 passed: BlackHole zero PCM, independent monitor, unchanged macOS defaults, local music protocol, background continuation, Claude commands and separate local-test profile.')
}finally{await local?.close().catch(()=>{});await application?.close().catch(()=>{});await rm(folder,{recursive:true,force:true})}
