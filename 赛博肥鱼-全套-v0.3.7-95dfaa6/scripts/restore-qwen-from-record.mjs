import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {join} from 'node:path'
import {_electron as electron,expect} from '@playwright/test'
if(!process.argv.includes('--apply')){console.log('使用 --apply 从用户授权的历史千问配置恢复密钥，通过正式应用的安全 IPC 加密保存，不打印明文。请先退出小店。');process.exit(0)}
const root=process.cwd(),source='C:/Users/YDD/Desktop/ai资讯工作流/.env'
const text=await readFile(source,'utf8'),raw=text.split(/\r?\n/).find(l=>/^\s*DASHSCOPE_API_KEY\s*=/.test(l))?.replace(/^\s*DASHSCOPE_API_KEY\s*=\s*/,'').trim(),key=raw?.replace(/^(['"])(.*)\1$/,'$2')
if(!key||!/^sk-[^\s]{16,2044}$/.test(key))throw Error('历史配置没有可用的千问密钥。')
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.VITE_DEV_SERVER_URL;delete env.CYBER_FISH_TEST_DATA_DIR
let app
try{
 app=await electron.launch({executablePath:join(root,'release/win-unpacked/赛博肥鱼.exe'),args:[],env,timeout:30000})
 await expect.poll(()=>app.windows().length,{timeout:20000}).toBe(2)
 const control=app.windows().find(p=>new URL(p.url()).searchParams.get('view')==='console');await control.waitForFunction(()=>!!window.shop)
 const result=await control.evaluate(async({key,dialogue})=>{
  await window.shop.command({type:'pause'})
  const voice=await window.shop.command({type:'save-key',provider:'qwen',key});if(!voice.ok)throw new Error('千问安全存储写入失败。')
  if(dialogue){const brain=await window.shop.command({type:'save-key',provider:'deepseek',key});if(!brain.ok)throw new Error('对话服务安全存储写入失败。')}
  return (await window.shop.getState()).credentials
 },{key,dialogue:process.argv.includes('--dialogue')})
 expect(result.qwen).toBe(true);expect(result.encrypted).toBe(true)
 await mkdir('.local/windows-live-setup',{recursive:true})
 await writeFile('.local/windows-live-setup/qwen-restored.json',JSON.stringify({saved:true,encrypted:true,provider:'qwen',source:'用户历史配音项目已保存的 DASHSCOPE_API_KEY',baseUrl:'https://dashscope.aliyuncs.com',model:'qwen3-tts-flash',voice:'Cherry',at:new Date().toISOString()},null,2))
 console.log('千问密钥已通过正式 Windows 应用安全接口加密保存。')
}finally{if(app){await new Promise(resolve=>setTimeout(resolve,600));await app.evaluate(({app})=>app.exit(0)).catch(()=>{});await app.close().catch(()=>{})}}
