// Explicit, read-only account rehearsal. No login, logout, persistence or audio.
import {app} from 'electron'
import {existsSync,mkdirSync,writeFileSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {createQQVault} from '../apps/desktop/electron/qq-vault'
import {createQQMusic} from '../apps/desktop/electron/qq-music'
import {assessMusic} from '../packages/core/src/music-policy'
if(!process.argv.includes('--run-real')){console.log('计划模式：加 --run-real 才只读检查本项目已有 QQ 登录。');app.quit()}
else{
 const profile=resolve('.local/qq-readonly-probe');mkdirSync(profile,{recursive:true})
 app.setName('赛博肥鱼');app.setPath('userData',profile)
 void app.whenReady().then(async()=>{
  let qq:ReturnType<typeof createQQMusic>|undefined;const count={search:0,details:0,play:0,lyrics:0}
  const timer=setTimeout(()=>{qq?.dispose();app.exit(2)},60000)
  try{
   const source=resolve('.local/user-data')
   if(!existsSync(join(source,'qq-music-session.enc.json'))){report({available:false,reason:'本项目没有已有QQ登录'});return}
   const vault=createQQVault(source),snapshot=vault.get(),secret=vault.secret
   if(!snapshot){report({available:false,reason:'本项目尚未登录QQ音乐'});return}
   const previous=process.env.LOG_LEVEL;process.env.LOG_LEVEL='silent'
   let provider:typeof import('@yakult-green-tea/qq-music-api/serverless')
   try{provider=await import('@yakult-green-tea/qq-music-api/serverless')}finally{if(previous===undefined)delete process.env.LOG_LEVEL;else process.env.LOG_LEVEL=previous}
   qq=createQQMusic({vault:{get:()=>snapshot,set:()=>{throw new Error('只读检查禁止改登录')}},isAllowed:()=>false,request:request=>{
    const url=new URL(request.url);let kind:keyof typeof count|undefined
    if(request.method==='GET'&&url.pathname==='/search')kind='search'
    if(request.method==='GET'&&url.pathname.startsWith('/getSongInfo/'))kind='details'
    if(request.method==='GET'&&url.pathname.startsWith('/getMusicPlay/'))kind='play'
    if(request.method==='GET'&&url.pathname==='/getLyric')kind='lyrics'
    if(!kind)return Promise.resolve(new Response('{}',{status:403}));count[kind]++
    return provider.handleRequest(request,{QQ_SESSION_SECRET:secret})
   }})
   const status=await qq.status();if(!status.loggedIn){report({available:false,reason:'保存的授权不可用'});return}
   const track=await qq.resolve('望むのは日常 近藤佑輔'),lyrics=await qq.lyrics(track.id.slice(3))
   report({available:true,resolved:true,title:track.title,screening:assessMusic(track,lyrics),requests:count,sourceVaultWrites:0,audioPlayed:false})
  }catch{report({available:false,reason:'保存的授权不可用或QQ请求失败，需要在桌面端扫码',requests:count,sourceVaultWrites:0})}
  finally{clearTimeout(timer);qq?.dispose();app.quit()}
 })
}
function report(value:unknown){writeFileSync(resolve('.local/artifacts/qq-readonly-probe.json'),JSON.stringify(value,null,2))}
