import {nativeCountryAISummary} from '../../../../stellaris-player/src/native-country-ai-summary.mjs'
import {confirmedCountryAIHandoff} from '../../../../stellaris-player/src/country-ai-handoff.mjs'
import {loadHybridSettings,saveHybridSettings,saveNativeCountryAISettings} from '../../../../stellaris-player/src/hybrid-settings-store.mjs'
import { spawn, execFile, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, writeFile, mkdir, stat, rename } from 'node:fs/promises'
import { join, resolve, dirname as dirnamePath } from 'node:path'
import {surveySummary} from '../../../../stellaris-player/src/survey-summary.mjs'
import {hybridWorkSummary,campaignWorkSummary} from '../../../../stellaris-player/src/hybrid-work-summary.mjs'
import {executionStatus} from '../../../../stellaris-player/src/execution-status.mjs'
import type { StellarisStatus, StellarisResult,StellarisOrderTracking,StellarisOrderPhase,StellarisQuality } from '../../../packages/shared/src/stellaris'

interface Options {
  dataDirectory: string
  candidates?: string[]
  preferredProject?: string
  disabled?: boolean
  platform?: string
  nodePath?: string
  enginePackagePath?: string
  isAlive?: (pid: number) => boolean
  launch?: typeof spawn
  preflight?: (root: string, node: string) => Promise<{ ok: boolean; message?: string }>
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}
async function json(path: string): Promise<any> {
  try { if ((await stat(path)).size > 512 * 1024) return undefined; return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, '')) } catch { return undefined }
}
const alive = (pid: number) => { if (!Number.isSafeInteger(pid) || pid <= 0) return false; try { process.kill(pid, 0); return true } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM' } }
const sleep = (ms: number) => new Promise<void>(done => setTimeout(done, ms))
const ORDER_PHASES:StellarisOrderPhase[]=['submitted','queued','executing','completed','failed','expired_unknown']
const ASYNC_COMMANDS=new Set(['colonize','build_district','build_building','upgrade_building','clear_blocker','set_district_zone','build_ship','reinforce_fleet','move_fleet','survey','build_outpost','build_stations','upgrade_fleet','follow_fleet','diplomacy','respond_diplomacy','select_research'])
const finiteMetric=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1e15
const metrics=(row:any,keys:string[])=>Object.fromEntries(keys.filter(key=>finiteMetric(row?.[key])).map(key=>[key,row[key]]))
function safeOrderTracking(raw:any):StellarisOrderTracking|undefined {
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||!raw.counts||typeof raw.counts!=='object')return
  const counts=Object.fromEntries(ORDER_PHASES.flatMap(key=>raw.counts[key]===undefined?[[key,0]]:Number.isSafeInteger(raw.counts[key])&&raw.counts[key]>=0&&raw.counts[key]<=1000000?[[key,raw.counts[key]]]:[]))
  const recent=(Array.isArray(raw.recent)?raw.recent:[]).slice(-8).flatMap((row:any)=>{
    if(typeof row?.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(row.id)||!ASYNC_COMMANDS.has(row.command)||!ORDER_PHASES.includes(row.status))return []
    const reason=typeof row.reason==='string'?row.reason.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,180):''
    const safeReason=/(https?:\/\/|sk-|[a-z]:[\\/]|token|cookie|密钥|reasoning)/i.test(reason)?'':reason
    return [{id:row.id,command:row.command,status:row.status,...(safeReason?{reason:safeReason}:{}),...(finiteMetric(row.updatedAt)?{updatedAt:row.updatedAt}:{})}]
  })
  return {counts,recent}
}
function safeQuality(raw:any,sessionId:unknown,now:number):StellarisQuality {
  const unknown=(reason:string):StellarisQuality=>({status:'unknown',reason,audioIsolation:'not_measured',viewerLatency:'not_measured'})
  if(!raw)return unknown('missing')
  if(raw.version!==1||typeof sessionId!=='string'||!sessionId||raw.sessionId!==sessionId)return unknown('cross_session')
  if(!finiteMetric(raw.at)||raw.at>now+5000||now-raw.at>30000)return unknown('stale')
  const obs=raw.obs
  if(obs?.status!=='observed'||obs.source!=='local_obs'||typeof obs.stream?.active!=='boolean'||typeof obs.record?.active!=='boolean')return {...unknown(['not_configured','invalid_config','unavailable','authentication','invalid_response','request_failed'].includes(obs?.reason)?obs.reason:'invalid_response'),at:raw.at}
  return {status:'observed',source:'local_obs',at:raw.at,
    stats:metrics(obs.stats,['activeFps','averageFrameRenderTime','renderSkippedFrames','renderTotalFrames','outputSkippedFrames','outputTotalFrames']),
    stream:{active:obs.stream?.active===true,reconnecting:obs.stream?.reconnecting===true,...metrics(obs.stream,['outputDuration','outputBytes','outputSkippedFrames','outputTotalFrames','outputCongestion'])},
    record:{active:obs.record?.active===true,...metrics(obs.record,['outputDuration','outputBytes'])},audioIsolation:'not_measured',viewerLatency:'not_measured'}
}
async function validProject(root?: string) {
  return !!root && (await json(join(root, 'package.json')))?.name === 'deepseek-stellaris-player' && existsSync(join(root, 'scripts/autoplay-native.mjs')) && existsSync(join(root, 'scripts/desktop-preflight.mjs'))
}
function readPreflight(root: string, node: string): Promise<{ ok: boolean; message?: string }> {
  return new Promise(resolveResult => {
    const env = { ...process.env }; delete env.DEEPSEEK_API_KEY; delete env.ELECTRON_RUN_AS_NODE
    execFile(node, [join(root, 'scripts/desktop-preflight.mjs')], { cwd: root, env, windowsHide: true, timeout: 12000, maxBuffer: 8192 }, (error, stdout) => {
      if (error) return resolveResult({ ok: false, message: '启动检查未通过，请检查 Node、Python 和群星控制器目录。' })
      try { const result = JSON.parse(stdout); resolveResult({ ok: result.ok === true, message: typeof result.message === 'string' ? result.message : undefined }) }
      catch { resolveResult({ ok: false, message: '控制器返回的启动检查无效。' }) }
    })
  })
}

/** File/process metadata only until an explicit start/stop. Never opens the game pipe. */
export function createStellarisController(options: Options) {
  const now = options.now || Date.now, isAlive = options.isAlive || alive, wait = options.sleep || sleep
  const node = options.nodePath || process.env.CYBERFISH_NODE || join(process.env.ProgramFiles || 'C:/Program Files', 'nodejs/node.exe')
  const configPath = join(options.dataDirectory, 'stellaris-controller.json')
  let root: string | undefined, initialized = false, managed: ChildProcess | undefined
  let busy = false, stopping = false, starting = false, lastError = '', stopAt = 0, disposed = false
  const supported = (options.platform || process.platform) === 'win32'
  async function initialize() {
    if (initialized || options.disabled) return
    initialized = true
    const saved = await json(configPath)
    for (const candidate of [options.preferredProject, saved?.projectDirectory, ...(options.candidates || [])]) {
      if (typeof candidate === 'string' && await validProject(candidate)) { root = resolve(candidate); break }
    }
  }
  async function runtime() {
    if (!root) return { active: false, pids: [] as number[] }
    const base = join(root, '.local/native-bridge')
    const [desktop, lock, preflight, dsh, checkpoint,quality,startupError] = await Promise.all([
      json(join(root, '.local/desktop-controller.json')), json(join(base, 'controller.lock')),
      json(join(base, 'preflight.json')), json(join(base, 'dsh/current.json')), json(join(base, 'latest-session.json')),
      json(join(base,'quality-latest.json')),
      json(join(base,'startup-error.json')),
    ])
    // Old current.json files outlive their actors. A stopped checkpoint or stale
    // preflight cannot turn a reused OS PID into a running controller.
    const pendingPicture = preflight?.stage === 'waiting_for_picture' && now() - preflight.at < 15000
    const pids = [...new Set([managed?.pid, desktop?.source === 'cyberfish-desktop' && !desktop.stoppedAt ? desktop.pid : undefined,
      !checkpoint?.stopped ? lock?.pid : undefined, pendingPicture ? preflight.pid : undefined,
      checkpoint?.stopped === false ? dsh?.pid : undefined].filter((pid): pid is number => Number.isSafeInteger(pid) && isAlive(pid)))]
    return { active: pids.length > 0, pids, preflight, checkpoint, desktop, dsh, lock,quality,startupError }
  }
  async function getStatus(): Promise<StellarisStatus> {
    if (options.disabled) return { phase: 'unavailable', localTest: true, canStart: false, canStop: false, message: '当前为独立本地测试，不读取真实控制器或启动游戏。' }
    if (!supported) return { phase: 'unavailable', canStart: false, canStop: false, message: '群星原生控制器目前支持 Windows。' }
    await initialize()
    if (!root) return { phase: 'unavailable', canStart: false, canStop: false, message: '请选择 stellaris-player 控制器目录。' }
    let hybrid:NonNullable<StellarisStatus['hybrid']>={surveyEnabled:false,configurationKnown:false}
    try{const settings=await loadHybridSettings({path:join(root,'.local/hybrid-control/settings.json'),environment:{}});hybrid={surveyEnabled:settings.survey,nativeCountryAIEnabled:settings.nativeCountryAI===true,configurationKnown:true}}
    catch{hybrid.message='混合调查配置不可用，请在停止后重新选择模式。'}
    const current = await runtime(), checkpoint = current.checkpoint, state = checkpoint?.state
    const enginePackage = options.enginePackagePath || process.env.CYBERFISH_DSH_PACKAGE || join(process.env.APPDATA || '', 'npm/node_modules/@deepseek-ai/dsh/package.json')
    const pkg = await json(enginePackage), entrypoint = join(dirnamePath(enginePackage), 'lib/bin.js')
    const engine = pkg?.name === '@deepseek-ai/dsh' && existsSync(entrypoint) ? { name: pkg.name as string, version: String(pkg.version), entrypoint, mode: 'headless' as const,
      ...(checkpoint?.stopped === false && isAlive(current.dsh?.pid) ? { pid: current.dsh.pid as number } : {}) } : undefined
    let snapshot: StellarisStatus['snapshot']
    if (state?.date) {
      let at = 0; try { at = (await stat(join(root, '.local/native-bridge/latest-session.json'))).mtimeMs } catch { /* Replaced checkpoint. */ }
      snapshot = { date: String(executionStatus(checkpoint,now()).date||state.date), at, orders: Number(checkpoint.metrics?.orders) || 0, verified: Number(checkpoint.metrics?.verified) || 0,
        colonies: Number(state.capacities?.colonies) || 0, ships: (state.military?.fleets || []).reduce((n: number, f: any) => n + (Number(f.total_ships) || 0), 0),
        alloysNet: typeof state.resources?.alloys?.net === 'number' ? state.resources.alloys.net : undefined, pendingEvents: state.pendingEvents?.length || 0,
        ...(safeOrderTracking(state.orderTracking)?{orderTracking:safeOrderTracking(state.orderTracking)}:{}),quality:safeQuality(current.quality,checkpoint.sessionId,now()),
        countryAI:nativeCountryAISummary(checkpoint,{actorActive:current.active}),
        work:hybridWorkSummary(checkpoint,{actorActive:current.active}),
        campaign:campaignWorkSummary(checkpoint,{actorActive:current.active}),
        ...(state.surveyControl?{survey:surveySummary({...checkpoint,stopped:checkpoint.stopped||!current.active},now())}:{}) }
    }
    let phase: StellarisStatus['phase'] = 'stopped', message = '控制器已停止。打开桌面端不会启动群星。'
    if (starting) { phase = 'starting'; message = '正在检查已打开的群星和控制器。' }
    else if (current.active && stopping) { phase = 'stopping'; message = '正在停止控制并等待游戏暂停确认。' }
    else if (current.active && current.preflight?.stage === 'waiting_for_picture' && isAlive(current.preflight.pid)) { phase = 'waiting'; message = '等待游戏画面可见；当前仅本地等待，不调用 DeepSeek。' }
    else if (current.active) {
      const fresh = checkpoint?.stopped === false && (!current.desktop?.started || checkpoint.started >= current.desktop.started)
      phase = fresh ? snapshot?.pendingEvents ? 'attention' : 'running' : 'starting'
      message = fresh ? snapshot?.pendingEvents ? '正在处理游戏中的事件。' : '大肥鱼正在控制当前游戏。' : '正在启动官方 DSH 和群星控制器。'
    } else if(current.startupError?.started>=current.desktop?.started&&typeof current.startupError?.message==='string') {
      phase='error';message='模型拒绝了控制工具的参数定义，控制器已停止；请更新后重新启动。'
    } else if (lastError) { phase = 'error'; message = lastError }
    const taskState=state?.gestalt
    if(taskState&&Array.isArray(taskState.tasks)) {
      const waiting=taskState.tasks.filter((t:any)=>t?.status==='waiting'||t?.status==='blocked').length
      const stages:Record<string,string>={select:'选敌',prepare:'备战',muster:'集结',declare:'宣战核对',combat:'交战占领',peace:'议和',recover:'战后恢复',completed:'已完成首战',terminated:'已终止'}
      const campaign=taskState.campaign
      message+=` 持久任务 ${taskState.tasks.length} 项，等待或受阻 ${waiting} 项。`
      if(campaign&&stages[campaign.phase])message+=` 战役：${stages[campaign.phase]}。`
      if(Array.isArray(taskState.unconfirmed)&&taskState.unconfirmed.length)message+=` ${taskState.unconfirmed.length} 项动作需对账。`
    }
    const nodeAvailable = existsSync(node)
    if (!nodeAvailable && !current.active) { phase = 'unavailable'; message = '未找到 Node.js，请先安装到正常全局位置。' }
    if (!engine && !current.active) { phase = 'unavailable'; message = '未找到官方 DeepSeek Harness，请先安装本机 DSH。' }
    if(!hybrid.configurationKnown&&!current.active){phase='unavailable';message=hybrid.message!}
    return { phase, message, hybrid, projectDirectory: root, canStart: hybrid.configurationKnown && nodeAvailable && !!engine && !busy && !current.active, canStop: current.active && !stopping, ...(engine ? { engine } : {}),
      ...(current.pids[0] ? { pid: current.pids[0] } : {}), ...(snapshot ? { snapshot } : {}) }
  }
  async function start(): Promise<StellarisResult> {
    if (disposed) return { ok: false, message: '桌面端正在退出。', status: await getStatus() }
    if (busy) return { ok: false, message: '正在处理上一次操作。', status: await getStatus() }
    const status = await getStatus()
    if (busy || !status.canStart || !root) return { ok: false, message: status.message, status }
    busy = true; starting = true; stopping = false; lastError = ''
    try {
      const checked = await (options.preflight || readPreflight)(root, node)
      if (!checked.ok) { busy = false; starting = false; return { ok: false, message: checked.message || '请先手动打开群星并载入当前测试存档。', status: await getStatus() } }
      if (disposed) return { ok: false, message: '桌面端已退出，未启动控制器。', status: await getStatus() }
      await mkdir(join(root, '.local'), { recursive: true })
      await writeFile(join(root, '.local/desktop-controller.json.tmp'), JSON.stringify({ preparingAt: now(), source: 'cyberfish-desktop' }))
      const env = { ...process.env, CYBERFISH_REQUIRE_RUNNING_GAME: '1', CYBERFISH_NATIVE_COUNTRY_AI:status.hybrid?.nativeCountryAIEnabled?'1':'0', CYBERFISH_HYBRID_SURVEY:status.hybrid?.surveyEnabled?'1':'0', CYBERFISH_COLONY_UPGRADE_PILOT:'1', CYBERFISH_MONTHLY_LIFECYCLE_PILOT:'1', CYBERFISH_LOCAL_WAIT_PILOT:'1', CYBERFISH_STOP_BASELINE: String(now()) }; delete (env as NodeJS.ProcessEnv).DEEPSEEK_API_KEY; delete (env as NodeJS.ProcessEnv).ELECTRON_RUN_AS_NODE
      const child = (options.launch || spawn)(node, [join(root, 'scripts/autoplay-native.mjs')], { cwd: root, env, windowsHide: true, stdio: 'ignore' })
      managed = child
      child.once('exit', code => {
        if (managed === child) managed = undefined
        if (code && !stopping) lastError = `控制器意外结束（退出码 ${code}），请检查群星状态与本机配置。`
        starting = false
        if (root) void json(join(root, '.local/desktop-controller.json')).then(record => { if (record?.pid === child.pid) return writeFile(join(root!, '.local/desktop-controller.json'), JSON.stringify({ ...record, stoppedAt: now() })) }).catch(() => {})
      })
      await new Promise<void>((done, fail) => { child.once('spawn', done); child.once('error', () => { if (managed === child) managed = undefined; fail(new Error('无法启动控制器，请检查 Node.js 安装。')) }) })
      await writeFile(join(root, '.local/desktop-controller.json'), JSON.stringify({ pid: child.pid, started: now(), source: 'cyberfish-desktop', requireRunningGame: true }))
      busy = false; starting = false
      return { ok: true, message: '控制器已启动，只接管你已打开的群星。', status: await getStatus() }
    } catch (error) { busy = false; starting = false; lastError = error instanceof Error ? error.message : '控制器启动失败。'; return { ok: false, message: lastError, status: await getStatus() } }
    finally { busy = false; starting = false }
  }
  async function stop(shutdown = false): Promise<StellarisResult> {
    await initialize()
    if (options.disabled || !root) return { ok: false, status: await getStatus() }
    if (busy && !shutdown) return { ok: false, message: '正在处理上一次操作。', status: await getStatus() }
    const current = await runtime()
    if (!current.active) return { ok: true, message: '控制器已经停止。', status: await getStatus() }
    busy = true; stopping = true; stopAt = now()
    try {
      await mkdir(join(root, '.local'), { recursive: true })
      await writeFile(join(root, '.local/STOP'), `user_stop: desktop ${new Date(stopAt).toISOString()}\n`)
      // Existing supervisor watches STOP and independently confirms pause after
      // its one MCP connection closes. Never compete for that pipe here.
      for (let attempt = 0; attempt < 30 && (await runtime()).active; attempt++) await wait(500)
      const final = await runtime()
      if (final.active) return { ok: false, message: '停止请求已发出，仍在等待控制器退出；不会启动新一轮。', status: await getStatus() }
      lastError = ''; stopping = false; busy = false
      const cp=final.checkpoint,clean=cp?.cleanup
      const sameSession=current.checkpoint?.stopped===false&&typeof current.checkpoint?.sessionId==='string'&&cp?.sessionId===current.checkpoint.sessionId
      const paused=sameSession&&cp?.stopped===true&&clean?.bindingConfirmed===true&&!clean?.error&&clean?.pauseStateUnknown!==true&&clean?.pauseConfirmed!==false&&clean?.paused!==false&&(clean?.pauseConfirmed===true||clean?.paused===true)
      const reclaimed=!clean?.surveyCleanupError&&(clean?.surveyStatus===undefined||clean.surveyStatus==='confirmed')&&Array.isArray(clean?.survey)&&clean.survey.every((x:any)=>x?.confirmed===true)
      const monthlyConfirmed=clean?.monthlyTrade?.confirmed===true&&clean?.monthlyTrade?.recovered?.confirmed===true&&!clean?.colonyControlError&&!clean?.colonyUpgradeCleanupError
      const country=clean?.countryAI
      const countryConfirmed=country===undefined?cp?.state?.countryAIControl?.enabled!==true:confirmedCountryAIHandoff(country)
      return {ok:true,message:paused&&reclaimed&&monthlyConfirmed&&countryConfirmed?'控制器已停止，游戏已确认暂停并收回调查；本地托管不再派发，已排施工保留，现在由你接管。':'控制器已停止；暂停或托管交接尚未确认，请在游戏中核对后接管。',status:await getStatus() }
    } finally { busy = false }
  }
  async function setProject(directory: string): Promise<StellarisResult> {
    if (options.disabled || !supported) return { ok: false, status: await getStatus() }
    await initialize()
    if (busy || (await runtime()).active) return { ok: false, message: '请先停止当前控制器，再更换目录。', status: await getStatus() }
    if (!await validProject(directory)) return { ok: false, message: '这不是可用的 stellaris-player 目录，请选择包含控制器 package.json 和 scripts 的文件夹。', status: await getStatus() }
    root = resolve(directory); await mkdir(options.dataDirectory, { recursive: true })
    await writeFile(configPath + '.tmp', JSON.stringify({ projectDirectory: root })); await rename(configPath + '.tmp', configPath)
    lastError = ''; return { ok: true, message: '控制器目录已保存，尚未启动。', status: await getStatus() }
  }
  async function setHybridSurvey(enabled:unknown):Promise<StellarisResult>{
    await initialize()
    if(typeof enabled!=='boolean'||options.disabled||!supported||!root||disposed)return {ok:false,message:'当前不能更改调查模式。',status:await getStatus()}
    if(busy||(await runtime()).active)return {ok:false,message:'请先停止并接管，再更改调查模式；运行中不会切换控制权。',status:await getStatus()}
    busy=true
    try{await saveHybridSettings(enabled,{path:join(root,'.local/hybrid-control/settings.json')});return {ok:true,message:enabled?'混合调查已开启，下一次启动由大肥鱼决定委派；尚未操作游戏。':'已切回普通模式，下一次启动不启用原生调查。',status:await getStatus()}}
    catch{return {ok:false,message:'调查模式保存失败，未启动控制器。',status:await getStatus()}}
    finally{busy=false}
  }
  async function setNativeCountryAI(enabled:unknown):Promise<StellarisResult>{
    await initialize()
    if(typeof enabled!=='boolean'||options.disabled||!supported||!root||disposed)return {ok:false,message:'当前不能更改国家 AI 模式。',status:await getStatus()}
    if(busy||(await runtime()).active)return {ok:false,message:'请先停止并确认交接，再更改国家 AI 模式。',status:await getStatus()}
    busy=true
    try{await saveNativeCountryAISettings(enabled,{path:join(root,'.local/hybrid-control/settings.json')});return {ok:true,message:enabled?'国家 AI 科研与建设试点已选择；下次启动由大肥鱼委派与接管，尚未操作游戏。':'国家 AI 模式已关闭，尚未操作游戏。',status:await getStatus()}}
    catch{return {ok:false,message:'国家 AI 配置保存失败，未启动控制器。',status:await getStatus()}}
    finally{busy=false}
  }
  async function saveGameKey(key: unknown): Promise<StellarisResult> {
    await initialize()
    if (options.disabled || !root || busy || (await runtime()).active) return { ok: false, message: '请先停止控制器，再设置游戏密钥。', status: await getStatus() }
    if (typeof key !== 'string' || !/^sk-[A-Za-z0-9_-]{20,200}$/.test(key.trim())) return { ok: false, message: 'DeepSeek 密钥格式不正确。', status: await getStatus() }
    try {
      await new Promise<void>((done, fail) => {
        const env = { ...process.env }; delete env.DEEPSEEK_API_KEY; delete env.ELECTRON_RUN_AS_NODE
        const child = spawn(node, ['--input-type=module', '-e', 'import {saveDeepSeekKey} from "./src/credentials.mjs";let key="";for await(const part of process.stdin)key+=part;await saveDeepSeekKey(key);'], { cwd: root, env, windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] })
        const timer = setTimeout(() => { child.kill(); fail(new Error('密钥保存超时。')) }, 15000)
        child.once('error', () => { clearTimeout(timer); fail(new Error('无法启动本机安全存储。')) })
        child.once('close', code => { clearTimeout(timer); code === 0 ? done() : fail(new Error('密钥未能加密保存。')) })
        child.stdin.on('error', () => {}); child.stdin.end(key.trim())
      })
      return { ok: true, message: '游戏 DeepSeek 密钥已在本机加密保存，尚未启动游戏控制。', status: await getStatus() }
    } catch (error) { return { ok: false, message: error instanceof Error ? error.message : '密钥保存失败。', status: await getStatus() } }
  }
  async function dispose() { disposed = true; if (managed?.pid && isAlive(managed.pid)) return stop(true) }
  return { getStatus, start, stop: () => stop(), setProject, setHybridSurvey, setNativeCountryAI, saveGameKey, dispose }
}
