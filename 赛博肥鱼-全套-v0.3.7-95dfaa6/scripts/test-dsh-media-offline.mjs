// Hidden, muted media integration. Isolated data, generated PCM, no providers or desktop input.
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import {createServer} from 'node:http'
import {resolve,join,dirname} from 'node:path'
import {pathToFileURL} from 'node:url'
import {createHash} from 'node:crypto'
import {build} from 'esbuild'
import {expect} from '@playwright/test'
import {spawn} from 'node:child_process'
import electronPath from 'electron'

const root=process.cwd(),parent=resolve('.local/test-data');await mkdir(parent,{recursive:true})
const directory=await mkdtemp(join(parent,'media-integration-'))
let application,service,overlayServer,calls=0
let frameLoads=0,captionSeen=false,captionCleared=false
const musicEvents=[];let childExited
let windowCheck=false
const captionOutage=process.argv.includes('--caption-outage')
const legacyOverlay=process.argv.includes('--legacy-overlay')
const expectInterruption=legacyOverlay&&process.argv.includes('--legacy-player')
const playSample=process.argv.includes('--sample-playback')
try{
 const publicRoot=resolve('../stellaris-player/public')
 overlayServer=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://127.0.0.1').pathname
  if(path==='/events'){res.writeHead(200,{'Content-Type':'text/event-stream'});res.write(': isolated test\n\n');return}
  const file=path==='/overlay'?'commentary.html':path==='/playback-caption.js'?'playback-caption.js':path==='/control-status.mjs'?'control-status.mjs':null
  if(!file){res.writeHead(404).end();return}
  try{let content=await readFile(join(publicRoot,file),'utf8');if(legacyOverlay&&file==='commentary.html')content=content.replace('</script></html>',`let legacyHeartbeat=0;
window.addEventListener('message',event=>{if(event.origin===speechOrigin&&event.source===speechFrame?.contentWindow&&event.data?.source==='cyberfish-captain-speech'&&event.data.heartbeat)legacyHeartbeat=Date.now()});
setInterval(()=>{if(speechFrame&&Date.now()-legacyHeartbeat>6000)speechFrame.src=speechOrigin+'/player?reconnect='+Date.now()},5000);
</script></html>`);res.writeHead(200,{'Content-Type':file.endsWith('.html')?'text/html; charset=utf-8':'text/javascript; charset=utf-8'});res.end(content)}catch{res.writeHead(500).end()}
 })
 await new Promise(done=>overlayServer.listen(0,'127.0.0.1',done))
 const overlayOrigin='http://127.0.0.1:'+overlayServer.address().port
 const bundle=join(directory,'service.mjs')
 const plugins=process.argv.includes('--legacy-player')||captionOutage?[{name:'legacy-no-heartbeat-client',setup(builder){builder.onLoad({filter:/captain-pages\.ts$/},async args=>{let contents=(await readFile(args.path,'utf8')).replace('const heartbeatTimer=setInterval(sendHeartbeat,1000);sendHeartbeat();','const heartbeatTimer=undefined;');if(captionOutage)contents=contents.replace(/function notify\(playback\)\{[^\n]*\}/,'function notify(){}');return {contents,loader:'ts'}})}}]:[]
 await build({stdin:{contents:`export {createStellarisSpeech,pcmWav} from './apps/desktop/electron/stellaris-speech';export {CAPTAIN_VOICE,CAPTAIN_SAMPLE_TEXT,CAPTAIN_VOICE_PRESETS} from './packages/core/src/stellaris-voice-presets'`,resolveDir:root,loader:'ts'},outfile:bundle,bundle:true,platform:'node',format:'esm',target:'node22',logLevel:'silent',plugins})
 const {createStellarisSpeech,pcmWav,CAPTAIN_VOICE,CAPTAIN_SAMPLE_TEXT,CAPTAIN_VOICE_PRESETS}=await import(pathToFileURL(bundle).href)
 const pcm=Buffer.alloc(24000*2*10)
 for(let i=0;i<pcm.length/2;i++)pcm.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*440/24000)*1000),i*2)
 const wav=pcmWav(pcm.toString('base64'),24000),samples=join(directory,'samples');await mkdir(samples)
 await writeFile(join(samples,'20.wav'),wav)
 await writeFile(join(samples,'manifest.json'),JSON.stringify({voice:CAPTAIN_VOICE.voice,model:CAPTAIN_VOICE.model,rate:1,text:CAPTAIN_SAMPLE_TEXT,samples:[{id:'20',status:'ready',instruction:CAPTAIN_VOICE_PRESETS[19].instruction,sha256:createHash('sha256').update(wav).digest('hex')}]}))
 service=createStellarisSpeech({directory:join(directory,'data'),getProject:async()=>undefined,samplesDirectory:samples,tunedSamplesDirectory:resolve('assets/captain-tuned'),port:0,playbackOrigins:[overlayOrigin],secrets:{available:()=>true,encrypt:s=>s,decrypt:s=>s},synthesize:async options=>{calls++;options.onRequest?.();return{kind:'pcm',data:pcm.toString('base64'),sampleRate:24000,characters:4,words:[],usage:{inputTokens:0,outputTokens:0}}}})
 await service.action({type:'save-key',key:'offline-fixture-only'})
 await service.action({type:'save-config',config:{presetId:'20'}})
 const started=await service.action({type:'start'});assert.equal(started.ok,true,started.message)
 const url=started.view.playerUrl,origin=new URL(url).origin
 const musicFile=join(root,'dist/dsh/renderer/music-player.html'),preload=join(root,'dist/dsh/electron/preload.cjs'),wavFile=join(directory,'fixture.wav');await writeFile(wavFile,wav)
 const harness=join(directory,'app.cjs')
 await writeFile(harness,`const {app,BrowserWindow,ipcMain,protocol,session}=require('electron');const {readFileSync}=require('node:fs');
app.setName('CyberfishIsolatedMediaTest');app.setPath('userData',${JSON.stringify(join(directory,'electron-data'))});app.commandLine.appendSwitch('mute-audio');app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
protocol.registerSchemesAsPrivileged([{scheme:'shop-qqmusic',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true,corsEnabled:true}}]);
global.mediaResult={music:[],errors:[]};let enabled=true;
app.whenReady().then(async()=>{
 session.defaultSession.webRequest.onBeforeRequest((d,done)=>{const u=new URL(d.url);done({cancel:(${captionOutage}&&u.pathname==='/playback/events')||!(['file:','shop-qqmusic:','devtools:','data:'].includes(u.protocol)||[${JSON.stringify(origin)},${JSON.stringify(overlayOrigin)}].includes(u.origin))})});
 protocol.handle('shop-qqmusic',()=>new Response(readFileSync(${JSON.stringify(wavFile)}),{headers:{'Content-Type':'audio/wav'}}));
 ipcMain.handle('dsh:music-view',()=>({enabled,volume:0,state:{status:enabled?'playing':'stopped',current:enabled?{trackId:'offline',generationId:'offline-generation',isBgm:true}:undefined,tracks:[{id:'offline',title:'离线测试',artist:'测试',source:'shop-qqmusic://track/offline'}]}}));
 ipcMain.handle('dsh:music-feedback',(_e,generation,kind)=>{global.mediaResult.music.push({generation,kind});console.log('MUSIC:'+kind);if(kind==='ended'||kind==='error')enabled=false});
 const options={show:false,focusable:false,skipTaskbar:true,webPreferences:{contextIsolation:true,sandbox:true,nodeIntegration:false,backgroundThrottling:false,autoplayPolicy:'no-user-gesture-required'}};
 const music=new BrowserWindow({...options,webPreferences:{...options.webPreferences,preload:${JSON.stringify(preload)}}}),voice=new BrowserWindow(options);global.mediaWindows=[music,voice];
 for(const w of global.mediaWindows){w.webContents.setAudioMuted(true);w.webContents.on('console-message',(_e,...args)=>{const text=args.join(' ');if(/Uncaught|Error/.test(text))global.mediaResult.errors.push(text.slice(0,300))})}
 console.log('WINDOWS:'+JSON.stringify(global.mediaWindows.map(w=>({visible:w.isVisible(),focused:w.isFocused(),focusable:w.isFocusable()}))));
 voice.webContents.on('did-frame-navigate',(_event,next)=>{if(next.startsWith(${JSON.stringify(origin+'/player')}))console.log('VOICE_FRAME_LOAD')});
 let seenCaption=false,clearedCaption=false;
 setInterval(async()=>{try{const value=await voice.webContents.executeJavaScript('({id:document.getElementById("caption")?.dataset.playbackId,text:document.getElementById("caption")?.textContent})');if(value.id&&value.text&&!seenCaption){seenCaption=true;console.log('CAPTION_ON')}if(seenCaption&&!value.text&&!clearedCaption){clearedCaption=true;console.log('CAPTION_OFF')}}catch{}},100).unref();
 await music.loadFile(${JSON.stringify(musicFile)});await voice.loadURL(${JSON.stringify(overlayOrigin+'/overlay?voice=1&speechOrigin='+encodeURIComponent(origin))});
});process.stdin.on('data',()=>{for(const w of global.mediaWindows??[])w.destroy();app.exit(0)});app.on('window-all-closed',()=>app.quit());`)
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
 application=spawn(electronPath,[harness],{env,windowsHide:true,stdio:['pipe','pipe','pipe']})
 childExited=new Promise(resolve=>application.once('exit',resolve))
 application.stdout.on('data',chunk=>{const text=String(chunk);for(const kind of ['started','ended','error'])if(text.includes('MUSIC:'+kind))musicEvents.push({generation:'offline-generation',kind});for(const line of text.split('\n')){if(line.includes('WINDOWS:'))windowCheck=!line.includes('true');if(line.includes('VOICE_FRAME_LOAD'))frameLoads++;if(line.includes('CAPTION_ON'))captionSeen=true;if(line.includes('CAPTION_OFF'))captionCleared=true}console.log(text.trim())})
 application.stderr.on('data',chunk=>{const text=String(chunk);if(/Error|error/i.test(text))console.log(text.slice(0,500))})
 await expect.poll(()=>Promise.resolve(musicEvents),{timeout:15000}).toContainEqual({generation:'offline-generation',kind:'started'})
 if(playSample){await expect.poll(async()=>(await service.view()).playback.playerConnected,{timeout:5000}).toBe(true);const result=await service.action({type:'play-sample'});assert.ok(result.ok,result.message)}
 else service.say({id:'offline-voice',text:'离线播放器验证。',kind:'host',at:Date.now()})
 await expect.poll(()=>service.readPlayback().status,{timeout:10000}).toBe('playing')
 const playingAt=performance.now()
 if(playSample)assert.ok(service.readPlayback().id.startsWith('sample:'))
 else assert.equal(service.readPlayback().text,'离线播放器验证。')
 await expect.poll(()=>service.readPlayback().status,{timeout:15000}).toBe('idle')
 const elapsed=performance.now()-playingAt
 assert.ok(expectInterruption?elapsed<8500:elapsed>=(playSample?started.view.tunedVoice.duration*1000-1500:8500),expectInterruption?'未复现旧网页每5秒重载造成的截断':'完整语音被提前中断')
 if(captionOutage)assert.equal(captionSeen,false,'断开的字幕连接不应显示未经确认的文字')
 else{await expect.poll(()=>captionCleared,{timeout:3000}).toBe(true);assert.ok(captionSeen,'直播画面未显示真实播放中的字幕')}
 if(expectInterruption)await expect.poll(()=>frameLoads,{timeout:3000}).toBeGreaterThan(1)
 else assert.equal(frameLoads,1,'语音 iframe 被看门狗反复重载')
 await expect.poll(()=>Promise.resolve(musicEvents),{timeout:10000}).toContainEqual({generation:'offline-generation',kind:'ended'})
 assert.equal(calls,playSample?0:1)
 assert.ok(windowCheck)
 console.log(playSample?'本机小样检查通过：11.36秒语音自然结束、字幕同步、未重载，模型和配音调用均为0。':expectInterruption?'已离线复现：旧网页和旧播放器组合会每5秒重载，10秒音频被截断。':captionOutage?'离线断连测试通过：字幕和心跳都断开时，10秒音频仍自然结束、播放器未重载；付费请求为0。':'离线真实播放器通过：完整10秒音频自然结束、直播字幕同步显示并清空、语音iframe未重载；窗口隐藏、不可聚焦、静音，付费请求为0。')
}finally{
 if(application){application.stdin.end('exit');await Promise.race([childExited,new Promise(resolve=>setTimeout(()=>{application.kill();resolve()},3000))])}
 await service?.dispose()
 if(overlayServer)await new Promise(done=>{overlayServer.close(done);overlayServer.closeAllConnections()})
 if(dirname(directory)!==parent)throw Error('测试清理目录无效')
 await rm(directory,{recursive:true,force:true,maxRetries:15,retryDelay:200})
}
