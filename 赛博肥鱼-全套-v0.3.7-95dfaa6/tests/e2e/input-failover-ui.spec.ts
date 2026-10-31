import { expect, test } from '@playwright/test'
import { createDefaultState } from '../../packages/core/src/defaults'
const IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZZsAAAAASUVORK5CYII='
test('主备输入独立设置两块ROI与预览，19位房号保持文本，切源不发音视频控制', async ({ page }, info) => {
 const state=createDefaultState();state.running=true;state.stage.muted=true;state.config.voice.enabled=false;state.config.idle.enabled=false
 await page.addInitScript(({state,image})=>{
  const commands:any[]=[],roi={commentRoi:{x:.81,y:.48,width:.175,height:.44},giftRoi:{x:.81,y:.34,width:.175,height:.13}}
  const screen:any={settings:{enabled:true,selection:{windowId:'window:42:0',...roi}},status:{state:'reading',message:'只读指定直播助手窗口，两块区域均无新候选。',frames:12,candidates:0,errorCount:0},failover:{selected:'screen',bridgeHealth:'unhealthy',message:'屏幕识别备用 · 后台暂不可用；屏幕备用读取中。',deliveredBridge:0,deliveredScreen:0,duplicates:2,ignored:3}}
  let primary={state:'reconnecting',room:'',received:0,message:'后台尚未确认健康，等待连接。'}
  Object.assign(window,{__inputCommands:commands,__restoreInputBridge:()=>{screen.failover.selected='bridge';screen.failover.bridgeHealth='healthy';screen.failover.message='后台主用 · 后台连接健康已确认；屏幕备用读取中。'}})
  window.shop={async getState(){return state},subscribe(){return()=>{}},async command(command){commands.push(command);if(command.type==='screen-input-info')return{ok:true,data:screen};if(command.type==='douyin-input-info')return{ok:true,data:primary};if(command.type==='screen-input-windows')return{ok:true,data:{windows:[{id:'window:42:0',name:'抖音直播伴侣'}],...screen}};if(command.type==='screen-input-set'){screen.settings={enabled:command.enabled,selection:command.selection};return{ok:true,data:screen}};if(command.type==='screen-input-preview')return{ok:true,data:{images:[{region:'comment',dataUrl:image,roi:roi.commentRoi},{region:'gift',dataUrl:image,roi:roi.giftRoi}]}};if(command.type==='douyin-input-start'){primary={state:'connected',room:command.room,received:0,message:'连接已建立，尚无真实互动。'};return{ok:true,data:primary}};if(command.type==='get-runtime-info')return{ok:true,data:{localTest:false}};if(command.type==='input-info')return{ok:true,data:{status:'listening',endpoint:'',token:'',received:0,rejected:0,message:'仅监听，不代表接通。'}};return{ok:true}},async openStage(){},async exportLogs(){return{ok:true}}}
 },{state,image:IMAGE})
 await page.goto('/');await expect(page.getByTestId('stage')).toHaveAttribute('data-loaded','true')
 await page.getByRole('navigation').getByRole('button',{name:'直播连接',exact:true}).click()
 const panel=page.getByTestId('input-failover')
 await expect(panel.getByTestId('input-selected-source')).toHaveText('屏幕识别备用')
 await expect(panel).toContainText('安静没有弹幕不算故障');await expect(panel).toContainText('屏幕实际投递 0 条')
 await panel.getByRole('button',{name:'列出直播助手窗口',exact:true}).click()
 await expect(panel.getByLabel('只读取这个直播助手窗口')).toHaveValue('window:42:0')
 await panel.getByLabel('评论区 宽度 百分比',{exact:true}).fill('30')
 await expect(panel.getByRole('button',{name:'核对评论 / 礼物裁图',exact:true})).toBeDisabled()
 await panel.getByRole('button',{name:'当前直播伴侣布局预置',exact:true}).click()
 await panel.getByRole('button',{name:'核对评论 / 礼物裁图',exact:true}).click()
 await expect(panel.getByTestId('screen-input-preview').getByRole('img')).toHaveCount(2)
 await panel.getByRole('button',{name:'保存主备接收设置',exact:true}).click()
 const room='7700000000000000001';await panel.getByLabel('抖音直播房间号 / 内部房间号').fill(room)
 await panel.getByRole('button',{name:'连接后台事件',exact:true}).click()
 await expect(panel).toContainText('尚无真实互动')
 await page.evaluate(()=>(window as any).__restoreInputBridge())
 await panel.getByRole('button',{name:'列出直播助手窗口',exact:true}).click()
 await expect(panel.getByTestId('input-selected-source')).toHaveText('后台优先 · 画面礼物补缺')
 await expect(panel).toContainText('匿名后台可能漏部分礼物')
 await panel.getByLabel('抖音直播房间号 / 内部房间号').fill('');await panel.getByRole('button',{name:'连接后台事件',exact:true}).click()
 const commands=await page.evaluate(()=>(window as any).__inputCommands)
 expect(commands.find((command:any)=>command.type==='douyin-input-start').room).toBe(room)
 expect(commands.filter((command:any)=>command.type==='douyin-input-start').at(-1).room).toBe('')
 expect(commands.find((command:any)=>command.type==='screen-input-set').selection).toMatchObject({windowId:'window:42:0',commentRoi:{x:.81,y:.48,width:.175,height:.44},giftRoi:{x:.81,y:.34,width:.175,height:.13}})
 for(const forbidden of ['pause','mute','music-stop','music-pause','start','open-capture','set-config'])expect(commands.some((command:any)=>command.type===forbidden)).toBe(false)
 await panel.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath('input-failover-rois.png')})
})
