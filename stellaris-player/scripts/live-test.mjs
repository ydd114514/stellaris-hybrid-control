import { mkdir, writeFile, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { loadDeepSeekKey } from '../src/credentials.mjs'
import { createWindowsDriver, callWindowsBridge } from '../src/driver.mjs'
import { createAgent } from '../src/agent.mjs'
import { createModObserver } from '../src/mod-observer.mjs'

const phase = process.argv[2] || 'play'
if (!['setup','play'].includes(phase)) throw new Error('仅支持 setup 或 play 测试阶段。')
const root = fileURLToPath(new URL('..',import.meta.url))
const directory = join(root,'.local','live-tests',`${Date.now()}-${phase}`)
await mkdir(directory,{recursive:true})
const key = await loadDeepSeekKey()
if (!key) throw new Error('尚未配置 DeepSeek 密钥。')
const report = { startedAt:new Date().toISOString(),phase,model:'deepseek-flash',directory,observations:[],actions:[],requests:[],result:null }
let writes=Promise.resolve(), sequence=0
function event(value) {
  const line=JSON.stringify(value)+'\n'
  process.stdout.write(line)
  writes=writes.then(()=>appendFile(join(directory,'events.jsonl'),line)).catch(()=>{})
}
const nativeOptions={pythonPath:'C:/Program Files/Python315/python.exe',gamePath:'D:/SteamLibrary/steamapps/common/Stellaris/stellaris.exe'}
const mod = await createModObserver({logPath:'C:/Users/YDD/Documents/Paradox Interactive/Stellaris/logs/game.log'})
const driver=createWindowsDriver({ ...nativeOptions,assumePaused:phase==='play',observeContext:()=>mod.read(),invoke:async payload=>{
  const response=await callWindowsBridge(payload,nativeOptions)
  if(payload.command==='execute')report.actions.push({at:new Date().toISOString(),action:payload.action,receipt:response})
  return response
}})
const recorded={
  async observe(options) {
    const image=await driver.observe(options),bytes=Buffer.from(image.imageBase64,'base64')
    const file=`${String(++sequence).padStart(3,'0')}.png`
    await writeFile(join(directory,file),bytes)
    report.observations.push({file,id:image.id,at:image.at,width:image.width,height:image.height,windowId:image.windowId,sha256:createHash('sha256').update(bytes).digest('hex'),modContextPresent:!!image.gameContext})
    return image
  },
  async execute(action,options) {
    const result=await driver.execute(action,options)
    // Let a real GUI repaint before the mandatory post-action observation.
    await new Promise(resolve=>setTimeout(resolve,350))
    return result
  },
}
const wrappedFetch=async(url,options)=>{
  const started=performance.now(),response=await fetch(url,options)
  const row={at:new Date().toISOString(),httpStatus:response.status,elapsedMs:Math.round(performance.now()-started),usage:null}
  report.requests.push(row)
  try {
    const data=await response.clone().json(),usage={}
    for(const name of ['prompt_tokens','completion_tokens','total_tokens','prompt_cache_hit_tokens','prompt_cache_miss_tokens'])if(typeof data.usage?.[name]==='number')usage[name]=data.usage[name]
    row.usage=usage
  } catch { /* Missing provider usage stays explicitly unknown. */ }
  return response
}
const goal=phase==='setup'
  ? '从当前主菜单创建一个新的非铁人单人测试局。优先选择现成的人类联邦预设帝国，沿用默认银河设置，确认铁人模式关闭。进入新局后保持初始暂停，关闭不必要的欢迎窗口，看到实际银河/帝国界面和暂停状态后结束。不要加载、删除或覆盖旧存档。'
  : '保持游戏暂停，只验证物理学科研：打开科技界面，若物理学没有研究项目，从实际候选中选择一项合理的项目，看到它成为当前研究后结束；若已有项目则不重选并如实说明。不要推进时间、建造、保存或退出。'
const agent=createAgent({apiKey:key,model:'deepseek-flash',phase,driver:recorded,maxSteps:phase==='setup'?18:8,requestTimeoutMs:30000,goal,onEvent:event,fetch:wrappedFetch})
const abort=()=>agent.stop()
process.on('SIGINT',abort);process.on('SIGTERM',abort)
try { report.result=await agent.run();event({type:'test-result',...report.result}) }
finally {
  await driver.stop();await writes
  report.endedAt=new Date().toISOString()
  report.actualUsage=report.requests.reduce((total,row)=>{for(const field of ['prompt_tokens','completion_tokens','total_tokens']){if(typeof row.usage?.[field]==='number')total[field]=(total[field]||0)+row.usage[field]}return total},{})
  await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2),{mode:0o600})
  process.off('SIGINT',abort);process.off('SIGTERM',abort)
  console.log(JSON.stringify({report:join(directory,'report.json'),screenshots:report.observations.length,actions:report.actions.length,result:report.result},null,2))
}
