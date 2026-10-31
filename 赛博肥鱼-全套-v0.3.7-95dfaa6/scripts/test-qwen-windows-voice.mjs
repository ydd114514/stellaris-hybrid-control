import {_electron as electron,expect} from '@playwright/test'
import {readFile,mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises'
import {join,resolve,sep} from 'node:path'
if(!process.argv.includes('--run-real')){console.log('需 --run-real：仅生成一句千问 Cherry 配音，通过指定 VB-CABLE 录音端点验证波形；不采集实体麦克风、不推流。');process.exit(0)}
const root=process.cwd(),testRoot=join(root,'.local/test-data'),artifacts=join(root,'.local/windows-live-setup')
await mkdir(testRoot,{recursive:true});await mkdir(artifacts,{recursive:true})
const profile=await mkdtemp(join(testRoot,'qwen-voice-'))
const text=await readFile('C:/Users/YDD/Desktop/ai资讯工作流/.env','utf8')
const key=text.split(/\r?\n/).find(l=>/^\s*DASHSCOPE_API_KEY\s*=/.test(l)).replace(/^\s*DASHSCOPE_API_KEY\s*=\s*/,'').trim().replace(/^(['"])(.*)\1$/,'$2')
const env={...process.env,CYBER_FISH_TEST_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;delete env.VITE_DEV_SERVER_URL
let app
try{
 app=await electron.launch({executablePath:join(root,'release/win-unpacked/赛博肥鱼.exe'),args:[],env,timeout:30000})
 await expect.poll(()=>app.windows().length,{timeout:20000}).toBe(2)
 const control=app.windows().find(p=>new URL(p.url()).searchParams.get('view')==='console'),stage=app.windows().find(p=>new URL(p.url()).searchParams.get('view')==='stage')
 await control.waitForFunction(()=>!!window.shop)
 await app.evaluate(({session})=>{session.defaultSession.setPermissionRequestHandler((_c,p,done)=>done(['media','speaker-selection'].includes(p)));session.defaultSession.setPermissionCheckHandler((_c,p)=>['media','speaker-selection'].includes(p))})
 const devices=await stage.evaluate(async()=>Array.from(await navigator.mediaDevices.enumerateDevices()).map(d=>({id:d.deviceId,label:d.label,kind:d.kind})))
 const output=devices.find(d=>d.kind==='audiooutput'&&!['default','communications'].includes(d.id)&&/^CABLE Input\b/i.test(d.label)),input=devices.find(d=>d.kind==='audioinput'&&!['default','communications'].includes(d.id)&&/^CABLE Output\b/i.test(d.label))
 expect(output).toBeTruthy();expect(input).toBeTruthy()
 await control.evaluate(async({key,output})=>{
  const saved=await window.shop.command({type:'save-key',provider:'qwen',key});if(!saved.ok)throw new Error('千问安全存储不可用。')
  const {config}=await window.shop.getState();config.demo=false;config.idle.enabled=false;config.idle.aiChatter=false;config.idle.hourlySpeechLimit=0;config.music.bgmEnabled=false;config.input.enabled=false
  config.voice={...config.voice,enabled:true,provider:'qwen',baseUrl:'https://dashscope.aliyuncs.com',model:'qwen3-tts-flash',voice:'Cherry',instruction:'',workspaceId:''}
  config.audio={...config.audio,mode:'live',streamDeviceId:output.id,monitorEnabled:false,streamGain:.7,speechGain:1}
  await window.shop.command({type:'set-config',config})
 },{key,output})
 await stage.evaluate(async input=>{
  const stream=await navigator.mediaDevices.getUserMedia({video:false,audio:{deviceId:{exact:input.id},echoCancellation:false,noiseSuppression:false,autoGainControl:false}}),track=stream.getAudioTracks()[0]
  if(!track||track.getSettings().deviceId!==input.id||!/^CABLE Output\b/i.test(track.label)){stream.getTracks().forEach(t=>t.stop());throw new Error('拒绝非虚拟录音端点。')}
  const context=new AudioContext(),source=context.createMediaStreamSource(stream),analyser=context.createAnalyser();analyser.fftSize=2048;source.connect(analyser);await context.resume()
  const capture=window.__voiceCapture={context,source,analyser,stream,peak:0,samples:0,timer:0}
  capture.timer=setInterval(()=>{const v=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(v);const rms=Math.sqrt(v.reduce((s,x)=>s+x*x,0)/v.length);capture.peak=Math.max(capture.peak,rms);capture.samples++},50)
 },input)
 const preview=await control.evaluate(()=>window.shop.command({type:'voice-preview',text:'你好呀，肥鱼小店的本地画面和声音正在测试，现在还没有正式开播。'}))
 expect(preview.ok,preview.message).toBe(true)
 await expect.poll(async()=>control.evaluate(async()=>(await window.shop.getState()).costs.voiceApiSucceeded),{timeout:55000}).toBe(1)
 await expect.poll(async()=>control.evaluate(async()=>(await window.shop.getState()).stage.speaking),{timeout:45000}).toBe(false)
 const audio=await stage.evaluate(async()=>{const c=window.__voiceCapture;clearInterval(c.timer);c.stream.getTracks().forEach(t=>t.stop());c.source.disconnect();await c.context.close();return{peakRms:c.peak,samples:c.samples}})
 const state=await control.evaluate(async()=>{await window.shop.command({type:'pause'});const s=await window.shop.getState();return{costs:s.costs,lastError:s.lastError,running:s.running,speaking:s.stage.speaking}})
 expect(state.costs.voiceApiRequests).toBe(1);expect(state.costs.brainApiRequests).toBe(0);expect(audio.peakRms).toBeGreaterThan(.0005)
 await writeFile(join(artifacts,'qwen-real-voice-report.json'),JSON.stringify({at:new Date().toISOString(),passed:true,model:'qwen3-tts-flash',voice:'Cherry',output:output.label,input:input.label,physicalMicrophoneCaptured:false,publicBroadcast:false,...audio,...state},null,2))
 console.log(JSON.stringify({passed:true,voiceRequests:state.costs.voiceApiRequests,voiceSucceeded:state.costs.voiceApiSucceeded,inputTokens:state.costs.voiceInputTokens,outputTokens:state.costs.voiceOutputTokens,reportedCharacters:state.costs.voiceCharacters,...audio}))
}finally{await app?.close().catch(()=>{});if(!resolve(profile).startsWith(resolve(testRoot)+sep))throw new Error('Invalid test folder');await rm(profile,{recursive:true,force:true})}
