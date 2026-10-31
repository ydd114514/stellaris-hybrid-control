import { test, expect } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { createDefaultState, ACTIONS } from '../../packages/core/src/defaults'
import { FACES } from '../../packages/shared/src'

test.use({ timezoneId: 'Asia/Shanghai' })
test('茶馆三套新增服装加载、骨骼动作与弹幕净空', async ({ page }) => {
 test.setTimeout(300000)
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
 const state=createDefaultState();state.config.voice.enabled=false;state.config.idle.enabled=false;state.config.input.enabled=false;state.config.music.bgmEnabled=false;state.stage.muted=true;state.running=true;state.config.look.timeOfDay='day';state.stage.text='清茶已经沏好，坐下来聊聊吧。';state.shop.decorations=['neon','plant','tank','chime']
 state.music.lastMessage=''
 state.history=[{id:'tea-chat',eventId:'tea-chat',viewerName:'小叶',heard:'今天想喝一杯什么茶？',say:['来一壶清茶，慢慢聊。'],status:'done',face:'happy',action:'tea',station:'counter',source:'mock',createdAt:Date.now(),voiceStyle:''}]
 await page.addInitScript(initial=>{
  let s=initial;const listeners=new Set<(v:typeof initial)=>void>();Object.assign(window,{__teahouse:(patch:{outfit?:string;action?:string;face?:typeof initial.stage.face})=>{s={...s,config:{...s.config,look:{...s.config.look,...(patch.outfit?{outfit:patch.outfit}:{})}},stage:{...s.stage,...(patch.action?{action:patch.action}:{}),...(patch.face?{face:patch.face}:{}),commandId:Math.random().toString()}};listeners.forEach(f=>f(s))}})
  window.shop={async getState(){return s},subscribe(f){listeners.add(f);return()=>listeners.delete(f)},async command(){return{ok:true}},async openStage(){},async exportLogs(){return{ok:true}}}
 },state)
 await page.route('**/*',r=>/^https?:/.test(r.request().url())&&!r.request().url().startsWith('http://127.0.0.1:5173')?r.abort():r.continue())
 await page.setViewportSize({width:540,height:960});await page.goto('/?view=stage')
 const stage=page.getByTestId('stage');await expect(stage).toHaveAttribute('data-loaded','true')
 const output=resolve('.local/teahouse-preview');mkdirSync(output,{recursive:true})
 for(const outfit of ['maid','cowboy','pumpkin','ghost']){
  await page.evaluate(outfit=>(window as any).__teahouse({outfit,action:'stand',face:'happy'}),outfit)
  await expect(stage).toHaveAttribute('data-rendered-skin',`deepseek-${outfit}`)
  await page.waitForTimeout(900)
  await page.screenshot({path:resolve(output,`${outfit}-tea-room.png`)})
  const isolated=await page.addStyleTag({content:'.shop-scene,.counter-layer,.counter-props,.stage-overlay{visibility:hidden!important}'})
  await page.getByTestId('stage-character').screenshot({path:resolve(output,`${outfit}-standing-rig.png`),omitBackground:true});await isolated.evaluate(e=>e.remove())
  for(const face of FACES){await page.evaluate(face=>(window as any).__teahouse({face}),face.id);await page.waitForTimeout(12)}
  for(const action of ACTIONS){await page.evaluate(action=>(window as any).__teahouse({action,face:'happy'}),action.id);await expect(stage).toHaveAttribute('data-action',action.id==='idle'?'stand':action.id,{timeout:15000});await page.waitForTimeout(40)}
  for(const action of ['wave','bow','sit','tea']){
   await page.evaluate(action=>(window as any).__teahouse({action,face:'happy'}),action);await page.waitForTimeout(800);await page.screenshot({path:resolve(output,`${outfit}-${action}.png`)});const isolated=await page.addStyleTag({content:'.shop-scene,.counter-layer,.counter-props,.stage-overlay{visibility:hidden!important}'});await page.getByTestId('stage-character').screenshot({path:resolve(output,`${outfit}-${action}-rig.png`),omitBackground:true});await isolated.evaluate(e=>e.remove())
  }
 }
 const rect=await page.getByTestId('audience-care').boundingBox();expect(rect).not.toBeNull();expect(rect!.y+rect!.height).toBeLessThan(630)
 await expect(page.getByTestId('shop-title')).toHaveText('肥鱼茶话铺');await expect(page.getByTestId('tea-service')).toBeVisible()
 const topicBox=await page.getByTestId('tea-topic-card').boundingBox();expect(topicBox!.x).toBeGreaterThan(320);expect(topicBox!.x+topicBox!.width).toBeLessThan(500);await expect(page.getByTestId('tea-topic-lines')).not.toHaveText('')
 const previousTopic=await page.getByTestId('tea-topic-lines').textContent();await page.evaluate(()=>(window as any).__teahouse({action:'fortune'}));await expect(page.getByTestId('tea-topic-lines')).not.toHaveText(previousTopic!)
 expect(errors).toEqual([])
})
