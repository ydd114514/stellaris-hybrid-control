// Account read only: no BrowserWindow, login writes, playback or model requests.
import {app} from 'electron'
import {readFileSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {createQQVault} from '../apps/desktop/electron/qq-vault'
import {createQQMusic,safeError} from '../apps/desktop/electron/qq-music'

const source=process.env.CYBERFISH_IMPORT_SOURCE,profile=process.env.CYBERFISH_IMPORT_PROFILE,output=process.env.CYBERFISH_IMPORT_OUTPUT
if(!source||!profile||!output)throw Error('导入参数不完整。')
const local=JSON.parse(readFileSync(join(source,'Local State'),'utf8'))
writeFileSync(join(profile,'Local State'),JSON.stringify({os_crypt:local.os_crypt}),{mode:0o600})
app.setName('大肥鱼QQ歌单导入');app.setPath('userData',profile);app.disableHardwareAcceleration()
void app.whenReady().then(async()=>{
 let qq:ReturnType<typeof createQQMusic>|undefined
 const timeout=setTimeout(()=>{app.exit(2)},135000)
 try{
  const vault=createQQVault(source),snapshot=vault.get(),secret=vault.secret
  if(!snapshot)throw Error('QQ音乐尚未登录或登录已失效，请重新扫码。')
  process.env.LOG_LEVEL='silent'
  const provider=await import('@yakult-green-tea/qq-music-api/serverless')
  let calls=0
  qq=createQQMusic({vault:{get:()=>snapshot,set:()=>{throw Error('禁止修改QQ登录')}},isAllowed:()=>false,request:request=>{
   const url=new URL(request.url)
   if(request.method!=='GET'||url.pathname!=='/user/liked-songs')throw Error('导入只允许读取我喜欢')
   calls++;return provider.handleRequest(request,{QQ_SESSION_SECRET:secret})
  }})
  const result=await qq.likedSongs()
  writeFileSync(output,JSON.stringify({ok:true,...result,requests:calls}),{mode:0o600})
 }catch(error){writeFileSync(output,JSON.stringify({ok:false,message:safeError(error).message}),{mode:0o600})}
 finally{clearTimeout(timeout);qq?.dispose();app.quit()}
})
