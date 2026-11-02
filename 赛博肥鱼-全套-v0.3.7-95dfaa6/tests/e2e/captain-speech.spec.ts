import {test,expect} from '@playwright/test'
import {CAPTAIN_DEFAULTS} from '../../apps/desktop/electron/stellaris-speech'
import {CAPTAIN_TUNED_VOICE} from '../../packages/core/src/captain-tuned'

test('captain chat starts without a selected voice; metadata query does not activate speech',async({page})=>{
 await page.addInitScript(defaults=>{
  const calls:any[]=[];Object.assign(window,{__captainCalls:calls})
  let speech:any={localTest:false,enabled:false,hasKey:true,encrypted:true,message:'先确认音色。',config:{...defaults,presetId:''},queued:0,usage:{requests:0,completed:0,failed:0,cancelled:0,inputTokens:0,outputTokens:0,missing:0},voiceCheck:{state:'unchecked',message:'尚未查询'}}
  let status:any={running:false,message:'场控未启动。',busy:[],pending:0,hourRequests:0,usage:{}}
  const copy=(x:any)=>JSON.parse(JSON.stringify(x))
  window.stellaris={getStatus:async()=>({phase:'stopped',message:'隔离界面',canStart:false,canStop:false}),start:async()=>{throw Error('no game')},stop:async()=>{throw Error('no game')},chooseProject:async()=>{throw Error('no project')},ai:{view:async()=>({localTest:false,status:copy(status)} as any),action:async action=>{calls.push({module:'chat',type:action.type});status={...status,running:action.type==='start-chat',message:action.type==='start-chat'?'弹幕聊天已启动。':'弹幕聊天已停止。'};return {ok:true,view:{status:copy(status)} as any}}},speech:{view:async()=>copy(speech),action:async action=>{calls.push({module:'speech',type:action.type});if(action.type==='save-config'){speech={...speech,config:action.config,message:'语音设置已保存，仍处于停止状态。'}}if(action.type==='query-voice'){speech.voiceCheck={state:'unknown',errorCode:'AllocationQuota.FreeTierOnly',message:'查询权限未确认；这不代表TTS整体不可用。'};speech.message=speech.voiceCheck.message}return {ok:action.type!=='query-voice',message:speech.message,view:copy(speech)}}}}
 },{...CAPTAIN_DEFAULTS})
 await page.goto('/stellaris.html?panel=speech')
 await expect(page.getByTestId('captain-speech')).toBeVisible();await expect(page.getByRole('button',{name:'启动语音与聊天',exact:true})).toBeDisabled()
 await page.getByRole('button',{name:'启动弹幕文字回复',exact:true}).click();await expect(page.getByRole('button',{name:'停止AI中枢',exact:true})).toBeEnabled()
 await page.getByLabel('业务空间ID').fill('verified-workspace');await page.getByRole('button',{name:'保存设置',exact:true}).click();await page.getByRole('button',{name:'查询已保存设置的音色状态',exact:true}).click()
 await expect(page.getByTestId('captain-voice-check')).toContainText('AllocationQuota.FreeTierOnly');await expect(page.getByRole('button',{name:'启动语音与聊天',exact:true})).toBeDisabled()
 const calls=await page.evaluate(()=>(window as any).__captainCalls);expect(calls).toEqual([{module:'chat',type:'start-chat'},{module:'speech',type:'save-config'},{module:'speech',type:'query-voice'}]);expect(calls.some((x:any)=>x.module==='speech'&&x.type==='start')).toBe(false)
 await page.screenshot({path:'.local/captain-resume-20261029/voice-chat-panel-offline.png',fullPage:true})
})

test('a verified tuned sample can be adopted and previewed without starting live speech',async({page})=>{
 await page.addInitScript(({defaults,tuned})=>{
  const calls:string[]=[];Object.assign(window,{__captainCalls:calls})
  let speech:any={localTest:false,enabled:false,hasKey:true,encrypted:true,message:'推荐声音已就绪。',config:defaults,queued:0,usage:{requests:0,completed:0,failed:0,cancelled:0,inputTokens:0,outputTokens:0,missing:0},tunedVoice:{ready:true,name:tuned.name,duration:10.48,message:'真实小样通过核验。'}}
  const copy=()=>JSON.parse(JSON.stringify(speech))
  window.stellaris={getStatus:async()=>({phase:'stopped',message:'隔离界面',canStart:false,canStop:false}),start:async()=>{throw Error('no game')},stop:async()=>{throw Error('no game')},chooseProject:async()=>{throw Error('no project')},speech:{view:async()=>copy(),action:async action=>{calls.push(action.type);if(action.type==='use-tuned-voice')speech={...speech,config:{...defaults,presetId:tuned.id,model:tuned.model,voice:tuned.voice,instruction:tuned.instruction,baseUrl:tuned.baseUrl},playerUrl:'http://127.0.0.1:17661/player',message:`已采用${tuned.name}，语音仍未开启。`};return {ok:true,message:speech.message,view:copy()}}}}
 },{defaults:{...CAPTAIN_DEFAULTS},tuned:{...CAPTAIN_TUNED_VOICE}})
 await page.goto('/stellaris.html?panel=speech')
 await expect(page.getByText('推荐：'+CAPTAIN_TUNED_VOICE.name)).toContainText('10.5秒真实小样')
 await page.getByRole('button',{name:'使用已调好的角色声',exact:true}).click()
 await expect(page.getByLabel('模型',{exact:true})).toHaveValue(CAPTAIN_TUNED_VOICE.model)
 await expect(page.getByLabel('当前音色')).toHaveValue(CAPTAIN_TUNED_VOICE.voice)
 await expect(page.getByLabel('百炼接口地址')).toHaveValue(CAPTAIN_TUNED_VOICE.baseUrl)
 await expect(page.getByLabel('推荐声音小样')).toHaveAttribute('src','http://127.0.0.1:17661/tuned.wav')
 await expect(page.getByRole('button',{name:'启动语音与聊天',exact:true})).toBeEnabled()
 await expect(page.getByText('当前选定：'+CAPTAIN_TUNED_VOICE.name)).toContainText('语音已停止')
 expect(await page.evaluate(()=>(window as any).__captainCalls)).toEqual(['use-tuned-voice'])
 await page.screenshot({path:'.local/captain-reference-20261029/voice-chat-tuned-offline.png',fullPage:true})
})

test('语音表单有焦点时仍刷新播放状态，同时保留本地配置草稿',async({page})=>{
 await page.addInitScript(defaults=>{
  const speech:any={localTest:false,enabled:true,hasKey:true,encrypted:true,message:'等待语音',config:{...defaults,presetId:'20'},queued:0,usage:{requests:0,completed:0,failed:0,cancelled:0,inputTokens:0,outputTokens:0,missing:0},playback:{playerConnected:false,status:'idle'}}
  ;(window as any).__speechFixture=speech
  ;(window as any).stellaris={getStatus:async()=>({phase:'stopped',message:'隔离测试',canStart:false,canStop:false}),speech:{view:async()=>structuredClone(speech),action:async()=>({ok:false,message:'测试不启动语音',view:structuredClone(speech)})}}
 },{...CAPTAIN_DEFAULTS})
 await page.goto('/stellaris.html?panel=speech')
 await expect(page.getByTestId('speech-player-status')).toContainText('播放器尚未接入')
 await page.locator('.voice-form').dispatchEvent('focusin')
 await page.evaluate(()=>{const s=(window as any).__speechFixture;s.playback={playerConnected:true,status:'playing'};s.current={id:'offline',text:'测试发言',kind:'host',phase:'playing'};s.config.workspaceId='新的后台值'})
 await expect(page.getByTestId('speech-player-status')).toContainText('播放器已确认正在播放')
 await expect(page.getByLabel('业务空间ID')).toHaveValue('')
})
