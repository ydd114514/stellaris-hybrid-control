import {test,expect} from '@playwright/test'
test('重新扫码时旧登录缓存不能清除新二维码，确认新登录后才清除',async({page})=>{
 await page.addInitScript(()=>{
  let pending=false
  ;(window as any).__confirmMusicLogin=false
  const view=()=>({localTest:false,enabled:false,volume:.2,maxQueue:30,account:{loggedIn:true,loginPending:pending&&!((window as any).__confirmMusicLogin),message:'已保存旧登录'},state:{tracks:[],queue:[],searches:[],status:'stopped',skipVotes:[],activeViewers:0,skipRequired:3,lastMessage:'测试'},bgmTrackIds:[],blacklist:[],builtInBlacklist:[]})
  ;(window as any).stellaris={getStatus:async()=>({phase:'stopped',message:'离线测试',canStart:false,canStop:false}),music:{view:async()=>view(),action:async(action:string)=>{
   if(action==='login'){pending=true;return{ok:true,message:'请扫码',login:{qrDataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfSkAAAAASUVORK5CYII=',expiresAt:Date.now()+120000,message:'请扫码'},view:view()}}
   return{ok:true,message:'状态已更新',view:view()}
  }}}
 })
 await page.goto('/stellaris.html?panel=music')
 await page.getByRole('button',{name:'手机 QQ 扫码',exact:true}).click()
 await expect(page.getByAltText('QQ 音乐登录二维码')).toBeVisible()
 await page.evaluate(()=>{(window as any).__confirmMusicLogin=true})
 await expect(page.getByAltText('QQ 音乐登录二维码')).toHaveCount(0,{timeout:6000})
})
