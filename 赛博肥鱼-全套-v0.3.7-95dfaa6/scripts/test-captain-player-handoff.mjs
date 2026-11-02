// Real player scripts in headless Chromium. Isolated PCM fixture; no user data or providers.
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import {createServer} from 'node:http'
import {join,resolve,dirname,basename} from 'node:path'
import {pathToFileURL} from 'node:url'
import {build} from 'esbuild'
import {chromium,expect} from '@playwright/test'

const root=process.cwd(),parent=resolve('.local/test-data')
await mkdir(parent,{recursive:true})
const directory=await mkdtemp(join(parent,'captain-handoff-'))
let browser,service,overlayServer,calls=0
try{
 const publicRoot=resolve('../stellaris-player/public')
 overlayServer=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://127.0.0.1').pathname
  if(path==='/events'){res.writeHead(200,{'Content-Type':'text/event-stream'});res.write(': offline fixture\n\n');return}
  const file=path==='/'||path==='/overlay'?'commentary.html':['/playback-caption.js','/control-status.mjs'].includes(path)?path.slice(1):undefined
  if(!file){res.writeHead(404).end();return}
  try{const content=await readFile(join(publicRoot,file));res.writeHead(200,{'Content-Type':file.endsWith('.html')?'text/html; charset=utf-8':'text/javascript; charset=utf-8'}).end(content)}catch{res.writeHead(500).end()}
 })
 await new Promise(done=>overlayServer.listen(0,'127.0.0.1',done))
 const overlayOrigin='http://127.0.0.1:'+overlayServer.address().port
 const bundle=join(directory,'service.mjs')
 await build({stdin:{contents:"export {createStellarisSpeech,pcmWav} from './apps/desktop/electron/stellaris-speech';export {CAPTAIN_VOICE,CAPTAIN_SAMPLE_TEXT,CAPTAIN_VOICE_PRESETS} from './packages/core/src/stellaris-voice-presets';export {inspectCaptainWav} from './packages/core/src/captain-audio'",resolveDir:root,loader:'ts'},outfile:bundle,bundle:true,platform:'node',format:'esm',target:'node22',logLevel:'silent'})
 const {createStellarisSpeech,pcmWav,CAPTAIN_VOICE,CAPTAIN_SAMPLE_TEXT,CAPTAIN_VOICE_PRESETS,inspectCaptainWav}=await import(pathToFileURL(bundle).href)
 const pcm=Buffer.alloc(24000*2*3)
 for(let i=0;i<pcm.length/2;i++)pcm.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*440/24000)*1000),i*2)
 const wav=pcmWav(pcm.toString('base64'),24000),samples=join(directory,'samples')
 await mkdir(samples)
 await writeFile(join(samples,'20.wav'),wav)
 await writeFile(join(samples,'manifest.json'),JSON.stringify({voice:CAPTAIN_VOICE.voice,model:CAPTAIN_VOICE.model,rate:1,text:CAPTAIN_SAMPLE_TEXT,samples:[{id:'20',status:'ready',instruction:CAPTAIN_VOICE_PRESETS[19].instruction,sha256:inspectCaptainWav(wav).sha256}]}))
 service=createStellarisSpeech({directory:join(directory,'data'),getProject:async()=>undefined,samplesDirectory:samples,port:0,playbackOrigins:[overlayOrigin],secrets:{available:()=>true,encrypt:s=>s,decrypt:s=>s},synthesize:async options=>{calls++;options.onRequest?.();return{kind:'pcm',data:pcm.toString('base64'),sampleRate:24000,characters:4,words:[],usage:{inputTokens:0,outputTokens:0}}}})
 await service.action({type:'save-key',key:'offline-fixture-only'})
 await service.action({type:'save-config',config:{presetId:'20'}})
 const started=await service.action({type:'start'})
 assert.equal(started.ok,true,started.message)
 const speechOrigin=new URL(started.view.playerUrl).origin
 browser=await chromium.launch({channel:'msedge',headless:true,args:['--autoplay-policy=no-user-gesture-required','--mute-audio']})
 const context=await browser.newContext()
 await context.route('**/*',route=>{const u=new URL(route.request().url());return [speechOrigin,overlayOrigin].includes(u.origin)?route.continue():route.abort()})
 await context.addInitScript(()=>{
  const NativeAudio=window.Audio
  window.__captainAudios=[]
  window.Audio=function(...args){const audio=new NativeAudio(...args);window.__captainAudios.push(audio);return audio}
  window.Audio.prototype=NativeAudio.prototype
 })
 const monitor=await context.newPage()
 await monitor.goto(speechOrigin+'/player?monitor=1')
 await expect.poll(async()=>(await service.view()).playback.playerConnected).toBe(true)
 service.say({id:'offline-handoff',kind:'host',text:'离线语音接管检查。',at:Date.now()})
 await expect.poll(()=>service.readPlayback().status).toBe('playing')
 await expect.poll(()=>monitor.evaluate(()=>window.__captainAudios.some(a=>!a.paused))).toBe(true)
 const broadcast=await context.newPage()
 await broadcast.goto(overlayOrigin+'/overlay?voice=1&speechOrigin='+encodeURIComponent(speechOrigin))
 await expect.poll(()=>Promise.resolve(broadcast.frames().some(f=>f.url().startsWith(speechOrigin+'/player')))).toBe(true)
 const frame=broadcast.frames().find(f=>f.url().startsWith(speechOrigin+'/player'))
 await expect.poll(()=>frame.evaluate(()=>window.__captainAudios.some(a=>!a.paused))).toBe(true)
 await expect.poll(()=>monitor.evaluate(()=>window.__captainAudios.every(a=>a.paused&&a.getAttribute('src')===null))).toBe(true)
 await expect.poll(()=>service.readPlayback().status).toBe('playing')
 assert.equal(service.readPlayback().id,'offline-handoff')
 assert.equal((await service.view()).playback.playerRole,'broadcast')
 assert.equal(calls,1,'接管不得重复请求合成')
 await expect.poll(()=>service.readPlayback().status,{timeout:8000}).toBe('idle')
 assert.equal((await service.view()).usage.completed,1)
 assert.equal((await service.view()).usage.requests,1)
 // Preview listening must remain a monitor, so it cannot displace the broadcast.
 const preview=await context.newPage()
 await preview.goto(overlayOrigin+'/?speechOrigin='+encodeURIComponent(speechOrigin))
 await preview.getByRole('button',{name:'试听直播语音',exact:true}).click()
 await expect.poll(()=>Promise.resolve(preview.frames().some(f=>f.url()===speechOrigin+'/player?monitor=1'))).toBe(true)
 await expect.poll(()=>preview.frames().find(f=>f.url().includes('/player?monitor=1')).locator('#status').textContent()).toContain('直播')
 assert.equal(calls,1)
 console.log('无窗口语音回归通过：本机试听先播，直播网页接管同一音频并完整结束；本机与预览不抢回播放；合成仅1次，无真实API和用户配置。')
}finally{
 await browser?.close()
 await service?.dispose()
 if(overlayServer)await new Promise(done=>{overlayServer.close(done);overlayServer.closeAllConnections()})
 assert.equal(dirname(directory),parent);assert.ok(basename(directory).startsWith('captain-handoff-'))
 await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100})
}
