import { existsSync,statSync } from 'node:fs'
import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { callWindowsBridge, createWindowsDriver } from './driver.mjs'
import { createAgent } from './agent.mjs'
import { installObserverMod,installSteeringMod,installStellarCompatibilityMod,installAutomationCompatibilityMod, MOD_NAME } from './mod-install.mjs'
import { createModObserver } from './mod-observer.mjs'
import { loadDeepSeekKey, credentialStatus } from './credentials.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const args = process.argv.slice(2), command = args[0] || 'doctor'
const flag = name => args.includes(name)
const argument = name => { const at = args.indexOf(name); return at < 0 ? undefined : args[at + 1] }
const defaults = { model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com', maxSteps: 12, requestTimeoutMs: 30000, maxObservationAgeMs: 45000 }
const configPath = resolve(argument('--config') || join(root, 'config.json'))
let config = { ...defaults }
if (existsSync(configPath)) config = { ...config, ...JSON.parse(await readFile(configPath, 'utf8')) }
const gameCandidates = [config.gamePath, 'D:/SteamLibrary/steamapps/common/Stellaris/stellaris.exe', 'C:/Program Files (x86)/Steam/steamapps/common/Stellaris/stellaris.exe'].filter(Boolean)
const gamePath = gameCandidates.find(path => existsSync(path)) || config.gamePath
const pythonCandidates = [config.pythonPath, 'C:/Program Files/Python315/python.exe', 'C:/Program Files/Python314/python.exe', 'C:/Program Files/Python313/python.exe'].filter(Boolean)
const pythonPath = pythonCandidates.find(path => existsSync(path)) || 'python'
const documentsPath = argument('--documents') || config.documentsPath || join(homedir(), 'Documents', 'Paradox Interactive', 'Stellaris')
const local = join(root, '.local')
let logWrites = Promise.resolve()
const driverOptions = { pythonPath, gamePath, maxObservationAgeMs: config.maxObservationAgeMs }

async function gameVersion() {
  try { return JSON.parse(await readFile(join(gamePath.replace(/[\\/]stellaris\.exe$/i, ''), 'launcher-settings.json'), 'utf8')).version }
  catch { return '未检测到；可在 config.json 填写 gamePath。' }
}
function report(event) {
  // Only the public event schema is recorded, not the request, image or CoT.
  const text = JSON.stringify(event)
  process.stdout.write(text + '\n')
  logWrites = logWrites.then(() => appendFile(join(local, 'session.jsonl'), text + '\n', { mode: 0o600 })).catch(() => {})
}
try {
  if (command === 'doctor') {
    const python = spawnSync(pythonPath, ['--version'], { encoding: 'utf8', windowsHide: true })
    let windows
    try { windows = await callWindowsBridge({ command: 'doctor', ...(gamePath ? { gamePath } : {}) }, { pythonPath }) }
    catch (error) { windows = { ok: false, message: error.message } }
    const keyStatus = credentialStatus()
    console.log(JSON.stringify({ node: process.version, python: python.status === 0 ? python.stdout.trim() : 'Python 不可用', gamePath: gamePath || '未找到', gameVersion: await gameVersion(), parserPresent: existsSync(join(root, 'vendor', 'stellaris-companion', 'stellaris-parser.exe')), observerModInstalled: existsSync(join(documentsPath, 'mod', `${MOD_NAME}.mod`)), deepseekKeyConfigured: keyStatus.stored || keyStatus.environment, keyStorage: keyStatus.stored ? 'Windows DPAPI CurrentUser' : keyStatus.environment ? 'process environment' : '未配置', gameWindows: windows, next: '先加载单人游戏并暂停，保持群星在前台；play --paused 才会调用 DeepSeek 并操作。' }, null, 2))
  } else if (command === 'check-api') {
    const apiKey = await loadDeepSeekKey()
    if (!apiKey) throw new Error('尚未配置本机 DeepSeek 密钥。')
    const { verifyDeepSeekApi } = await import('./api-check.mjs')
    const result = await verifyDeepSeekApi({ apiKey, model: config.model })
    await mkdir(local, { recursive: true })
    await writeFile(join(local, 'deepseek-connection-check.json'), JSON.stringify(result, null, 2), { mode: 0o600 })
    console.log(JSON.stringify(result, null, 2))
    if (!result.ok) process.exitCode = 1
  } else if (['install-mod','install-steering-mod','install-stellar-compat','install-automation-compat'].includes(command)) {
    const gameDirectory=argument('--game-dir')||'D:/SteamLibrary/steamapps/common/Stellaris';
    const stellarDirectory=argument('--stellar-ai-dir')||[resolve(gameDirectory,'../../workshop/content/281990/3686836322'),'C:/Tools/SteamCMD/steamapps/workshop/content/281990/3686836322'].find(path=>existsSync(join(path,'descriptor.mod')));
    const findWorkshop=id=>[resolve(gameDirectory,'../../workshop/content/281990',id),'C:/Tools/SteamCMD/steamapps/workshop/content/281990/'+id].find(path=>existsSync(join(path,'descriptor.mod')));
    const install=command==='install-automation-compat'?installAutomationCompatibilityMod:command==='install-stellar-compat'?installStellarCompatibilityMod:command==='install-steering-mod'?installSteeringMod:installObserverMod;
    const installation = await install({gameDirectory,stellarDirectory,ultimateDirectory:argument('--ultimate-dir')||findWorkshop('2250100617'),performanceDirectory:argument('--performance-dir')||findWorkshop('2184737698'),
      ...(argument('--energy-reserve')?{reserveEnergy:Number(argument('--energy-reserve'))}:{}),...(argument('--alloy-reserve')?{reserveAlloys:Number(argument('--alloy-reserve'))}:{}),documentsPath,dryRun:flag('--dry-run'),updateGenerated:flag('--update-generated'),backupDirectory:argument('--backup-dir')})
    if (!installation.dryRun) { await mkdir(local, { recursive: true }); await writeFile(join(local, 'mod-installation.json'), JSON.stringify(installation, null, 2), { mode: 0o600 }) }
    console.log(JSON.stringify(installation, null, 2))
  } else if (command === 'observe') {
    await mkdir(local, { recursive: true })
    const image = await createWindowsDriver(driverOptions).observe()
    const path = join(local, 'last-observation.png')
    await writeFile(path, Buffer.from(image.imageBase64, 'base64'))
    console.log(JSON.stringify({ ok: true, path, width: image.width, height: image.height, message: '仅保存群星窗口截图，没有调用模型或发送操作。' }, null, 2))
  } else if (command === 'save') {
    const savePath = argument('--save')
    if (!savePath) throw new Error('请使用 save --save "存档.sav" 指定只读存档。')
    const { observeSave } = await import('./save-observer.mjs')
    console.log(JSON.stringify(await observeSave({ savePath }), null, 2))
  } else if (command === 'play-fast') {
    if(!flag('--paused')&&!flag('--takeover'))throw new Error('请载入非铁人单人测试局并关闭教程，再运行 play-fast --takeover；程序会先识别实际暂停状态。')
    const minutes=Number(argument('--minutes')||30),maxRequests=Number(argument('--requests')||600)
    if(!Number.isFinite(minutes)||minutes<0.1||minutes>120||!Number.isInteger(maxRequests)||maxRequests<1||maxRequests>10000)throw new Error('连续测试时长须为0.1–120分钟，请求数须为1–10000。')
    const apiKey=await loadDeepSeekKey();if(!apiKey)throw new Error('没有已配置的DeepSeek密钥。')
    const {createFastPlayer}=await import('./fast-player.mjs'),{readGameScreen}=await import('./hud.mjs')
    const directory=join(local,'continuous-tests',String(Date.now()));await mkdir(directory,{recursive:true})
    let frame=0,lastSave=0,writes=Promise.resolve()
    const modObserver=await createModObserver({logPath:join(documentsPath,'logs','game.log')})
    const{createLiveSaveObserver}=await import('./live-save-observer.mjs')
    let localization
    if(argument('--save-dir')){const{loadGameLocalization}=await import('./game-localization.mjs');localization=await loadGameLocalization(gamePath.replace(/[\\/]stellaris\.exe$/i,''))}
    const liveSave=createLiveSaveObserver({directory:argument('--save-dir'),notBefore:0,resolveDisplayName:localization?.resolve})
    const driver=createWindowsDriver({...driverOptions,assumePaused:flag('--paused')?true:undefined,focusOnStart:true,parkCursor:true,previewWidth:1280,readHud:readGameScreen,observeContext:async image=>(await liveSave.read(image))||modObserver.read()})
    const{planStrategy}=await import('./strategy-planner.mjs')
    const events=[]
    const player=createFastPlayer({driver,apiKey,model:config.model,maxRequests,maxDurationMs:minutes*60000,strategist:argument('--save-dir')?planStrategy:undefined,goal:argument('--goal')||'正常自主游玩当前非铁人单人局，根据实际局势持续科研、调查、扩张和发展经济，保持正常游戏节奏。',onEvent:event=>{
      events.push(event);process.stdout.write(JSON.stringify(event)+'\n')
      writes=writes.then(()=>appendFile(join(directory,'events.jsonl'),JSON.stringify(event)+'\n'))
    },onEvidence:async({stage,image,request})=>{
      frame++
      // Keep bounded checkpoints plus all skill transitions, not 30 minutes
      // of full-resolution screenshots. Each newest frame is also retained.
      const bytes=Buffer.from(image.imageBase64,'base64')
      await writeFile(join(directory,'latest.png'),bytes)
      await writeFile(join(directory,'latest.json'),JSON.stringify({stage,request,frame,observationId:image.id,imageHash:image.imageHash,hud:image.hud,modelImage:image.modelImage?{width:image.modelImage.width,height:image.modelImage.height,bytes:Buffer.byteLength(image.modelImage.imageBase64,'base64')}:null}))
      if(Date.now()-lastSave>=15000||!['turn','running'].includes(stage)){
        lastSave=Date.now();await writeFile(join(directory,`${String(frame).padStart(5,'0')}-${stage}.png`),bytes)
      }
    }})
    const stop=()=>player.stop();process.on('SIGINT',stop);process.on('SIGTERM',stop)
    const stopFile=join(local,'STOP'),startedAt=Date.now()
    const control=setInterval(()=>{try{if(statSync(stopFile).mtimeMs>=startedAt)stop()}catch{}},400)
    try{
      const result=await player.run();await writes
      await writeFile(join(directory,'report.json'),JSON.stringify({directory,...result},null,2));console.log(JSON.stringify({report:join(directory,'report.json'),...result},null,2))
      if(result.status==='attention')process.exitCode=1
    }finally{clearInterval(control);await driver.stop();await writes;process.off('SIGINT',stop);process.off('SIGTERM',stop)}
  } else if (command === 'play') {
    if (!flag('--paused')) throw new Error('请先加载单人游戏并暂停，保持群星在前台，再运行 play --paused。不会自动加载或覆盖你的存档。')
    const apiKey = await loadDeepSeekKey()
    if (!apiKey) throw new Error('尚未配置 DeepSeek 密钥。可双击「启动群星AI.bat」在本机输入。')
    const maxSteps = Number(argument('--steps') || config.maxSteps)
    if (!Number.isSafeInteger(maxSteps) || maxSteps < 2 || maxSteps > 100) throw new Error('每轮模型请求上限需为 2–100。')
    await mkdir(local, { recursive: true })
    let initialContext
    if (argument('--save')) {
      const { observeSave } = await import('./save-observer.mjs')
      initialContext = await observeSave({ savePath: argument('--save') })
    }
    const modObserver = await createModObserver({ logPath: join(documentsPath, 'logs', 'game.log'), ...(config.modPlayerName ? { playerName: config.modPlayerName } : {}) })
    const driver = createWindowsDriver({ ...driverOptions, assumePaused: true, observeContext: () => modObserver.read() })
    const agent = createAgent({ apiKey, baseUrl: config.baseUrl, model: config.model, goal: argument('--goal') || config.goal, initialContext, maxSteps, requestTimeoutMs: config.requestTimeoutMs, driver, onEvent: report })
    let interrupted = false
    const stop = () => { if (!interrupted) { interrupted = true; agent.stop(); void driver.stop() } }
    process.on('SIGINT', stop); process.on('SIGTERM', stop)
    try {
      const result = await agent.run()
      console.log(JSON.stringify(result, null, 2))
      if (result.status === 'error') process.exitCode = 1
    } finally {
      await driver.stop()
      if (driver.info().paused !== true) { report({ type: 'attention', message: '无法确认游戏已重新暂停。请手动切回群星并暂停；原型已停止输入。' }); process.exitCode = 1 }
      await logWrites; process.off('SIGINT', stop); process.off('SIGTERM', stop)
    }
  } else throw new Error('支持的命令：doctor、check-api、install-mod、observe、save --save 路径、play --paused。')
} catch (error) {
  // Never print a request object or an arbitrary remote response.
  console.error(error instanceof Error ? error.message : '群星玩家未完成本次操作。')
  process.exitCode = 1
}
