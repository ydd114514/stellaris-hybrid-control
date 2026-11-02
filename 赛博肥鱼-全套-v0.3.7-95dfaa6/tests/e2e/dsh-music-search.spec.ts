import {test,expect} from '@playwright/test'

test('搜索列出版本并按所选QQ结果加入轮播，不按关键词盲选',async({page})=>{
 await page.addInitScript(()=>{
  const calls:unknown[]=[];(window as any).__musicCalls=calls
  let catalog:any,tracks:any[]=[],bgmTrackIds:string[]=[]
  const view=()=>({localTest:false,enabled:false,volume:.2,account:{loggedIn:false,loginPending:false,message:'未登录'},state:{tracks,queue:[],searches:[],status:'stopped',skipVotes:[],activeViewers:0,skipRequired:3,lastMessage:'测试'},bgmTrackIds,blacklist:[],builtInBlacklist:[],reviewedLibraryOnly:false,catalog})
  ;(window as any).stellaris={getStatus:async()=>({phase:'stopped',message:'离线',canStart:false,canStop:false}),music:{view:async()=>structuredClone(view()),action:async(action:string,value:unknown)=>{
   calls.push({action,value})
   if(action==='search')catalog={query:value,page:1,more:true,tracks:[{id:'qq:cover',title:'One Last Kiss (翻唱)',artist:'其他歌手',source:'shop-qqmusic://track/cover'},{id:'qq:original',title:'One Last Kiss (最后一吻)',artist:'宇多田光',source:'shop-qqmusic://track/original'}]}
   if(action==='add-result'){tracks=[catalog.tracks.find((t:any)=>t.id===value)];bgmTrackIds=[value as string]}
   return {ok:true,message:action==='add-result'?'已加入背景曲库':'找到候选，请选择',view:structuredClone(view())}
  }}}
 })
 await page.goto('/stellaris.html?panel=music')
 await page.getByPlaceholder('搜索 QQ 歌名或歌手，例如 One Last Kiss').fill('one last kiss')
 await page.getByRole('button',{name:'搜索 QQ 音乐',exact:true}).click()
 const original=page.getByTestId('music-search-results').getByRole('listitem').filter({hasText:'宇多田光'})
 await expect(original).toBeVisible()
 await original.getByRole('button',{name:'加入轮播',exact:true}).click()
 await expect(original.getByRole('button',{name:'已在轮播',exact:true})).toBeDisabled()
 expect(await page.evaluate(()=>(window as any).__musicCalls)).toEqual([{action:'search',value:'one last kiss'},{action:'add-result',value:'qq:original'}])
 await expect(page.getByText('背景歌单 1 首')).toBeVisible()
})
