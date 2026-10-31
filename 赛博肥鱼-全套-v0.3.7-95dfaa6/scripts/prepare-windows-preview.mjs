import { _electron as electron, expect } from '@playwright/test'
import { mkdir,writeFile } from 'node:fs/promises'
import { join } from 'node:path'

if (!process.argv.includes('--apply')) { console.log('使用 --apply 配置本项目的小店：VB-CABLE 专用输出、关闭本地监听、离线文字预览、暂停结束；不调用付费服务、不对外开播。'); process.exit(0) }
const root=process.cwd(), artifacts=join(root,'.local/windows-live-setup')
const qwen=process.argv.includes('--qwen')
await mkdir(artifacts,{recursive:true})
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.VITE_DEV_SERVER_URL;delete env.CYBER_FISH_TEST_DATA_DIR
let app
try {
 app=await electron.launch({executablePath:join(root,'release/win-unpacked/赛博肥鱼.exe'),args:[],env,timeout:30000})
 await expect.poll(()=>app.windows().length,{timeout:20000}).toBe(2)
 const control=app.windows().find(p=>new URL(p.url()).searchParams.get('view')==='console'),stage=app.windows().find(p=>new URL(p.url()).searchParams.get('view')==='stage')
 await control.waitForFunction(()=>!!window.shop)
 const result=await control.evaluate(async qwen=>{
  await window.shop.command({type:'pause'})
  const devices=Array.from(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='audiooutput'&&!['default','communications'].includes(d.deviceId))
  const output=devices.find(d=>/(?:^CABLE Input|(?:扬声器|Speakers).*VB-Audio Virtual Cable)/i.test(d.label))
  const monitor=devices.find(d=>/USB2.0 Speaker/i.test(d.label))||devices.find(d=>/Realtek/i.test(d.label))
  if(!output)throw new Error('未发现 VB-CABLE，不保存设置。')
  const {config}=await window.shop.getState()
  config.demo=true;config.mode='manual';config.voice.enabled=false;config.idle.enabled=false;config.input.enabled=false;config.music.bgmEnabled=false
  if(qwen){config.demo=false;config.brain={...config.brain,provider:'qwen',baseUrl:'https://dashscope.aliyuncs.com/compatible-mode/v1',model:'qwen-plus'};config.voice={...config.voice,enabled:true,provider:'qwen',baseUrl:'https://dashscope.aliyuncs.com',model:'qwen3-tts-flash',voice:'Cherry',instruction:'',workspaceId:''}}
  config.audio={...config.audio,mode:'live',streamDeviceId:output.deviceId,monitorEnabled:false,monitorDeviceId:monitor?.deviceId||'',streamGain:1,speechGain:1,musicGain:.18,ducking:.2}
  const saved=await window.shop.command({type:'set-config',config});if(!saved.ok)throw new Error(saved.message)
  const state=await window.shop.getState()
  return {outputLabel:output.label,monitorLabel:monitor?.label||'默认扬声器',monitorEnabled:false,mode:'live',demo:config.demo,voiceEnabled:config.voice.enabled,bgmEnabled:false,brainProvider:config.brain.provider,brainModel:config.brain.model,voiceModel:config.voice.model,voice:config.voice.voice,credentials:state.credentials,runtime:(await window.shop.command({type:'get-runtime-info'})).data}
 },qwen)
 await expect(stage.getByTestId('stage')).toHaveAttribute('data-loaded','true',{timeout:20000})
 if(!qwen)await control.evaluate(async()=>{await window.shop.command({type:'start'});await window.shop.command({type:'say',text:'本地预览测试通过，尚未开播。'});await window.shop.command({type:'action',action:'wave'})})
 await stage.screenshot({path:join(artifacts,'local-preview-test.png')})
 await control.evaluate(async()=>{await window.shop.command({type:'pause'});await window.shop.command({type:'music-stop'});await window.shop.command({type:'interrupt'})})
 const final=await control.evaluate(async()=>{const s=await window.shop.getState();return {running:s.running,speaking:s.stage.speaking,music:s.music.status,monitorEnabled:s.config.audio.monitorEnabled,demo:s.config.demo}})
 expect(final.running).toBe(false);expect(final.speaking).toBe(false);expect(final.monitorEnabled).toBe(false)
 await writeFile(join(artifacts,'shop-configuration.json'),JSON.stringify({at:new Date().toISOString(),...result,final},null,2))
 console.log(JSON.stringify({...result,final},null,2))
} finally {if(app){await new Promise(resolve=>setTimeout(resolve,600));await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{})}}
