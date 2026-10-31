import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeImage, powerSaveBlocker, protocol, session, shell, Tray } from 'electron'
import { writeFile } from 'node:fs/promises'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import type { AppState, Command, CommandResult } from '../../../packages/shared/src/index'
import { createRuntime } from '../../../packages/core/src/runtime'
import { synthesizeQwen, designQwenVoice } from '../../../packages/core/src/voice'
import { createCredentialStore, createPersistentStore } from './storage'
import { findProjectDirectory, migrateLegacyProfile, resolveDataDirectory } from './portable'
import { createMediaLibrary } from './media-library'
import { createLiveInputBridge } from './live-input'
import { createQQMusic } from './qq-music'
import { createQQVault } from './qq-vault'
import { readAudioReservation, type AudioReservation } from './audio-reservation'
import { createLiveScreenInput, DEFAULT_SCREEN_ROIS, type LiveScreenSelection } from './live-screen-input'
import { validNormalizedRect } from './live-screen-parser'
import { createInputFailover } from './input-failover'
import { createLiveHealthReporter } from './live-health'
import { createDouyinReceiver, parseDouyinRoom } from './douyin-receiver'
import { createDouyinSigner } from './douyin-signer'
import { createDouyinRoomDiscovery } from './douyin-room-discovery'
import { createBilibiliReceiver } from './bilibili-receiver'
import { createBilibiliInputController } from './bilibili-input-controller'
import { namespaceLiveEvent } from '../../../packages/inputs/src/normalize'

app.setName('赛博肥鱼')
// The companion's GDI fallback cannot read Chromium's GPU-composited window on
// some Windows drivers. Keep WebGL for the rig but compose the window in software.
if (process.platform === 'win32') app.commandLine.appendSwitch('disable-gpu-compositing')
protocol.registerSchemesAsPrivileged(['shop-media', 'shop-qqmusic'].map(scheme => ({ scheme, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } })))
const localTest = process.argv.includes('--cyberfish-local-test')
const requestedProfile = process.env.CYBER_FISH_TEST_DATA_DIR || process.argv.find(value => value.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length)
const legacyDirectory = app.getPath('userData')
const dataDirectory = resolveDataDirectory({ appPath: app.getAppPath(), executable: process.execPath, documents: app.getPath('documents'), explicit: process.env.CYBER_FISH_HOME, testDirectory: requestedProfile, localTest })
for (const directory of [dataDirectory,join(dataDirectory,'session'),join(dataDirectory,'logs'),join(dataDirectory,'crashes')]) mkdirSync(directory,{recursive:true,mode:0o700})
app.setPath('userData',dataDirectory); app.setPath('sessionData',join(dataDirectory,'session')); app.setPath('crashDumps',join(dataDirectory,'crashes')); app.setAppLogsPath(join(dataDirectory,'logs'))
const projectDirectory = findProjectDirectory(app.getAppPath()) || findProjectDirectory(dirname(process.execPath))
const rendererFile = join(__dirname, '../renderer/index.html')
const isDev = !app.isPackaged && !!process.env.VITE_DEV_SERVER_URL
const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173'
let consoleWindow: BrowserWindow | null = null, stageWindow: BrowserWindow | null = null, tray: Tray | undefined
let quitting = false
let runtime: ReturnType<typeof createRuntime> | undefined
let store: ReturnType<typeof createPersistentStore> | undefined
let media: ReturnType<typeof createMediaLibrary> | undefined
let input: ReturnType<typeof createLiveInputBridge> | undefined
let screenInput: ReturnType<typeof createLiveScreenInput> | undefined
let inputFailover: ReturnType<typeof createInputFailover> | undefined
let inputFailoverTimer: ReturnType<typeof setInterval> | undefined
let screenSettings: { enabled: boolean; selection?: LiveScreenSelection } = { enabled: false }
let screenRetryAt = 0, screenOperation: Promise<unknown> | undefined
let liveHealth: ReturnType<typeof createLiveHealthReporter> | undefined
let primaryInput: ReturnType<typeof createDouyinReceiver> | undefined
let bilibiliInput: ReturnType<typeof createBilibiliReceiver> | undefined
let bilibiliController: ReturnType<typeof createBilibiliInputController> | undefined
let douyinInputStatus = '内置模拟器'
let primarySettings = { enabled: false, room: '' }, primaryRetryAt = 0, lastPrimarySignal = 0
let primaryOperation: Promise<unknown> | undefined
let roomDiscovery: ReturnType<typeof createDouyinRoomDiscovery> | undefined, discoveredRoom = ''
let qq: ReturnType<typeof createQQMusic> | undefined
let qqLoading: Promise<ReturnType<typeof createQQMusic>> | undefined
let unsubscribe: (() => void) | undefined, sleepBlocker: number | undefined
let inputStatus = '内置模拟器', inputSettingSignature = ''
let inputOperation: Promise<unknown> = Promise.resolve()
let menuSignature = ''
let audioReservation: AudioReservation | undefined
let audioReservationTimer: ReturnType<typeof setInterval> | undefined
const driverInstalled = () => process.platform === 'win32' ? existsSync(join(process.env.ProgramFiles || 'C:\\Program Files','VB','CABLE','vbMmeCable64_win10.inf')) : process.platform === 'darwin' && existsSync('/Library/Audio/Plug-Ins/HAL/BlackHole2ch.driver')

async function getQQ() {
  if (localTest || requestedProfile) throw new Error('独立测试不连接真实QQ音乐，请在直播工作台连接。')
  if (qq) return qq
  if (qqLoading) return qqLoading
  qqLoading = (async () => {
    const vault = createQQVault(dataDirectory)
    const secret = vault.secret
    // Import only the port-free entry. Its logger captures this setting at import,
    // so upstream diagnostics cannot leak sessions or playback URLs into our logs.
    const previous = process.env.LOG_LEVEL
    let provider: typeof import('@yakult-green-tea/qq-music-api/serverless')
    try { process.env.LOG_LEVEL = 'silent'; provider = await import('@yakult-green-tea/qq-music-api/serverless') }
    catch { throw new Error('QQ音乐组件加载失败，请重新打开小店或重新安装完整安装包。') }
    finally { if (previous === undefined) delete process.env.LOG_LEVEL; else process.env.LOG_LEVEL = previous }
    if (quitting) throw new Error('小店正在退出，请重新打开后再连接QQ音乐。')
    qq = createQQMusic({
      request: request => provider.handleRequest(request, { QQ_SESSION_SECRET: secret }),
      vault,
      isAllowed: mid => {
        if (!runtime || quitting) return false
        const state = runtime.getState(), track = state.music.tracks.find(track => track.id === state.music.current?.trackId)
        // Keep an already paused element's buffer valid; its renderer alone
        // controls audibility. Stop/next/logout still invalidate the source.
        return ['playing', 'paused'].includes(state.music.status) && track?.source === `shop-qqmusic://track/${mid}`
      },
    })
    return qq
  })()
  try { return await qqLoading } finally { qqLoading = undefined }
}

function allowedUrl(url: string): boolean {
  try { const parsed = new URL(url); return isDev ? parsed.origin === new URL(devUrl).origin : parsed.protocol === 'file:' && fileURLToPath(parsed) === rendererFile } catch { return false }
}
function secure(window: BrowserWindow) {
  window.webContents.setWindowOpenHandler(({ url }) => { try { if (new URL(url).protocol === 'https:') void shell.openExternal(url) } catch { /* Invalid URL. */ } return { action: 'deny' } })
  window.webContents.on('will-navigate',(event,url)=>{if(!allowedUrl(url))event.preventDefault()})
  // This event belongs to BrowserWindow, not webContents. The renderer's shared
  // index.html title must never overwrite the capture source's stable OS title.
  window.on('page-title-updated',event=>event.preventDefault())
}
function showConsole() { consoleWindow?.show(); consoleWindow?.focus() }
function showStage() { if(!stageWindow||stageWindow.isDestroyed())stageWindow=createWindow(true); stageWindow.showInactive() }
function createWindow(stage: boolean): BrowserWindow {
  const title=stage?(localTest?'赛博肥鱼 · 本地测试画面（不推流）':'赛博肥鱼 · 抖音直播采集（9:16）'):(localTest?'赛博肥鱼 · 本地测试工作台':'赛博肥鱼 · 小店后台')
  const window=new BrowserWindow({
    width:stage?540:1440,height:stage?960:960,minWidth:stage?270:1060,minHeight:stage?480:720,
    title,
    backgroundColor:stage?'#132422':'#101917',titleBarStyle:'default',frame:!stage,focusable:!stage,skipTaskbar:stage && process.platform !== 'win32',
    autoHideMenuBar:true,show:false,useContentSize:stage,
    webPreferences:{preload:join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,backgroundThrottling:!stage,autoplayPolicy:'no-user-gesture-required'},
  })
  if(stage)window.setAspectRatio(9/16)
  secure(window)
  window.webContents.on('did-finish-load',()=>window.setTitle(title))
  window.once('ready-to-show',()=>{window.setTitle(title);if(stage)window.showInactive();else window.show()})
  window.on('close',event=>{if(!quitting){event.preventDefault();window.hide()}})
  window.on('closed',()=>{if(stage)stageWindow=null;else consoleWindow=null})
  if(isDev)void window.loadURL(`${devUrl}${devUrl.includes('?')?'&':'?'}view=${stage?'stage':'console'}`)
  else void window.loadFile(rendererFile,{query:{view:stage?'stage':'console'}})
  return window
}
function assertSender(event: Electron.IpcMainInvokeEvent) {
  if(![consoleWindow,stageWindow].some(w=>w&&!w.isDestroyed()&&w.webContents.id===event.sender.id)||!event.senderFrame||!allowedUrl(event.senderFrame.url))throw new Error('该窗口没有访问小店后台的权限。')
}
function decorate(state:AppState):AppState {return {...state,
  ...(audioReservation ? { stage: { ...state.stage, muted: true }, audioReservation: { kind: 'rehearsal' as const, expiresAt: audioReservation.expiresAt, message: '真实测试正在独占直播声音。请在「测试直播」窗口互动；此工作台已暂停送音，防止双重声音。测试结束后可手动恢复。' } } : {}),
  connection:{...state.connection,input:localTest?'本地测试 · 输入桥关闭':inputStatus}}}
function broadcast(state?:AppState){const snapshot=decorate(state||runtime!.getState());for(const window of [consoleWindow,stageWindow])if(window&&!window.isDestroyed())window.webContents.send('shop:state',snapshot)}
function refreshInputStatus() {
  if (quitting) return
  const status = bilibiliInput?.info(), bilibili = status ? `B站：${status.message}` : 'B站：尚未连接'
  const next = `抖音 / 本机：${douyinInputStatus}；${bilibili}`
  if (next !== inputStatus) { inputStatus = next; if (runtime) broadcast() }
}
async function refreshAudioReservation() {
  const root = projectDirectory || findProjectDirectory(dataDirectory)
  if (!root) return
  const next = readAudioReservation(join(root, '.local/live-rehearsals/active-audio.json'))
  if (next?.pid === audioReservation?.pid && next?.expiresAt === audioReservation?.expiresAt) return
  audioReservation = next
  if (!runtime || quitting) return
  // Mute the decorated stage immediately, then cancel production generation and
  // pause its music. User monitor/device preferences are never rewritten.
  broadcast()
  if (next) {
    await runtime.command({ type: 'pause' })
    if (runtime.getState().music.status === 'playing') await runtime.command({ type: 'music-pause' })
  }
  buildMenu()
}
function launchLocalTest(){
  if(localTest){showConsole();return}
  const args=app.isPackaged?['--cyberfish-local-test']:[app.getAppPath(),'--cyberfish-local-test']
  const env={...process.env};delete env.CYBER_FISH_TEST_DATA_DIR;delete env.ELECTRON_RUN_AS_NODE
  const child=spawn(process.execPath,args,{env,detached:true,stdio:'ignore'});child.unref()
}
function buildMenu(){
  const state=runtime!.getState()
  const signature=JSON.stringify([state.running,state.config.audio.monitorEnabled,localTest,!!audioReservation])
  if(signature===menuSignature)return
  menuSignature=signature
  const menu=Menu.buildFromTemplate([
    {label:localTest?'本地测试工作台':'打开小店后台',click:showConsole},
    {label:'显示直播采集窗口',click:showStage},
    {label:'本地监听',type:'checkbox',checked:state.config.audio.monitorEnabled,click:()=>{const current=runtime!.getState().config;void runtime!.command({type:'set-config',config:{...current,audio:{...current.audio,monitorEnabled:!current.audio.monitorEnabled}}})}},
    {label:'独立本地测试',enabled:!localTest,click:launchLocalTest},
    {type:'separator'},
    {label:state.running?'暂停营业':'开始营业',enabled:!audioReservation,click:()=>{void desktopCommand({type:runtime!.getState().running?'pause':'start'})}},
    {label:'紧急静音',click:()=>{void runtime!.command({type:'mute'})}},
    {type:'separator'},{label:'退出小店',click:()=>app.quit()},
  ])
  tray?.setContextMenu(menu)
  Menu.setApplicationMenu(Menu.buildFromTemplate([{label:'赛博肥鱼',submenu:[{label:'打开后台',click:showConsole},{label:'显示采集窗口',click:showStage},{type:'separator'},{label:'退出小店',accelerator:'CommandOrControl+Q',click:()=>app.quit()}]},{role:'editMenu',label:'编辑'},{role:'windowMenu',label:'窗口'}]))
}
const commandTypes=new Set(['start','pause','interrupt','mute','unmute','clear-logs','reset-session','set-config','save-key','test-connection','inject','approve','skip','say','action','face','station','stage-event','set-gifts','set-shop','set-viewer','voice-preview','design-voice','vote-open','vote-close','vote-cancel','plan-apply','suggestion-dismiss','end-show','forget-viewer','archive-query','wallet-topup','wallet-reset','music-set-tracks','music-request','music-approve','music-reject','music-play','music-pause','music-resume','music-stop','music-next','music-ended','music-error','open-capture','open-audio-setup','import-music','open-local-test','get-runtime-info','input-info','input-start','input-stop','input-rotate-token','input-test','input-copy'])
for (const type of ['music-started','qq-status','qq-search','qq-login-start','qq-login-poll','qq-logout','rations-topup','rations-reset']) commandTypes.add(type)
for (const type of ['screen-input-info','screen-input-windows','screen-input-warmup','screen-input-set','screen-input-preview']) commandTypes.add(type)
for (const type of ['douyin-input-info','douyin-input-start','douyin-input-stop']) commandTypes.add(type)
for (const type of ['bilibili-input-info','bilibili-input-save','bilibili-input-start','bilibili-input-stop','bilibili-input-clear']) commandTypes.add(type)

function checkedScreenSelection(value: unknown): LiveScreenSelection {
  if (!value || typeof value !== 'object') throw new Error('请先选择直播助手窗口。')
  const input = value as LiveScreenSelection
  if (typeof input.windowId !== 'string' || !/^window:\d{1,12}:\d+$/.test(input.windowId)) throw new Error('直播助手窗口标识无效，请重新选择。')
  const commentRoi = input.commentRoi || DEFAULT_SCREEN_ROIS.commentRoi, giftRoi = input.giftRoi || DEFAULT_SCREEN_ROIS.giftRoi
  if (!validNormalizedRect(commentRoi) || !validNormalizedRect(giftRoi)) throw new Error('读取区域必须在窗口内，宽高至少为1%。')
  return { windowId: input.windowId, commentRoi: { ...commentRoi }, giftRoi: { ...giftRoi } }
}
function screenInfo() { return { settings: screenSettings, status: screenInput?.status(), failover: inputFailover?.info() } }
async function startScreenInput() {
  if (quitting || localTest || requestedProfile || !screenInput || !screenSettings.enabled || !screenSettings.selection || screenOperation) return
  const selection = screenSettings.selection
  screenRetryAt = Date.now()
  screenOperation = screenInput.start(selection).catch(() => { inputStatus = '屏幕备用暂不可用，后台接收继续；将自动重试。' }).finally(() => { screenOperation = undefined })
  await screenOperation
}
function savePrimaryInput() {
  const file = join(dataDirectory,'douyin-input-settings.json'), temporary = `${file}.tmp`
  writeFileSync(temporary,JSON.stringify(primarySettings),{mode:0o600});renameSync(temporary,file);chmodSync(file,0o600)
}
function startPrimaryInput() {
  const room = primarySettings.room || discoveredRoom
  if (quitting || localTest || requestedProfile || !primaryInput || !primarySettings.enabled || !room || primaryOperation) return
  primaryRetryAt = Date.now()
  const work = primaryInput.start(room).catch(() => inputFailover?.bridgeHealth({state:'disconnected',channel:'direct'})).finally(()=>{if(primaryOperation===work)primaryOperation=undefined})
  primaryOperation=work
}
async function syncPrimaryDiscovery() {
  try{if(primarySettings.enabled&&!primarySettings.room&&!localTest&&!requestedProfile)await roomDiscovery?.start();else roomDiscovery?.stop()}
  catch{inputFailover?.bridgeHealth({state:'disconnected',channel:'direct'})}
  if(!primarySettings.enabled)roomDiscovery?.stop()
  startPrimaryInput()
}

async function syncInput(state:AppState){
  const signature=JSON.stringify(state.config.input)
  if(signature===inputSettingSignature)return inputOperation
  inputSettingSignature=signature
  const config={...state.config.input}
  inputOperation=inputOperation.catch(()=>{}).then(async()=>{
    inputFailover?.bridgeHealth({ state: 'disconnected', channel: 'local' })
    if(localTest||!config.enabled)return await input?.stop()
    return await input?.start(config)
  })
  return inputOperation
}

async function desktopCommand(command:Command):Promise<CommandResult>{
  if(command.type==='inject')command={...command,event:{...command.event,origin:'simulator'}}
  if (audioReservation && ['start','unmute','voice-preview','design-voice','say','approve','music-play','music-resume','music-next'].includes(command.type)) return { ok: false, message: '直播声卡正由真实测试独占，请在测试窗口操作；本轮结束后再恢复正常小店。' }
  if (command.type.startsWith('bilibili-input-')) return bilibiliController ? bilibiliController.command(command as Parameters<typeof bilibiliController.command>[0]) : { ok: false, message: 'B 站接收器尚未准备，请稍后重试。' }
  if (command.type === 'douyin-input-info') return {ok:true,data:{...(primaryInput?.info()||{state:'stopped',room:'',received:0,message:localTest?'独立本地测试不连接真实直播间。':'后台来源尚未准备。'}),configuredRoom:primarySettings.room,automatic:primarySettings.enabled&&!primarySettings.room,discovery:roomDiscovery?.info(),...(primarySettings.enabled&&!primarySettings.room&&!discoveredRoom?{message:roomDiscovery?.info().message||'等待自动发现直播房间候选，后台健康尚未确认。'}:{})}}
  if (command.type.startsWith('douyin-input-') && (localTest || requestedProfile)) return {ok:false,message:'独立本地测试不连接真实直播间。'}
  if (command.type === 'douyin-input-start') { primarySettings={enabled:true,room:command.room.trim()?parseDouyinRoom(command.room):''};savePrimaryInput();primaryInput!.stop();primaryOperation=undefined;discoveredRoom='';void syncPrimaryDiscovery();return {ok:true,data:primaryInput!.info(),message:'后台接收正在准备；留空房号会自动跟随伴侣的新房间，只连接消息，不改变直播画面或声音。'} }
  if (command.type === 'douyin-input-stop') { primarySettings.enabled=false;savePrimaryInput();roomDiscovery?.stop();primaryInput!.stop();return {ok:true,data:primaryInput!.info(),message:'后台直连已停止，屏幕备用继续按主备规则接收。'} }
  if (command.type === 'screen-input-info') return { ok: true, data: screenInfo() }
  if (command.type.startsWith('screen-input-') && (localTest || requestedProfile)) return { ok: false, message: '独立本地测试不读取真实直播助手窗口；请在主工作台配置主备输入。' }
  if (command.type === 'screen-input-windows') return { ok: true, data: { windows: await screenInput!.listWindows(), ...screenInfo() } }
  if (command.type === 'screen-input-warmup') return { ok: true, data: await screenInput!.warmup() }
  if (command.type === 'screen-input-preview') return { ok: true, data: await screenInput!.preview(command.selection ? checkedScreenSelection(command.selection) : screenSettings.selection) }
  if (command.type === 'screen-input-set') {
    const selection = command.selection ? checkedScreenSelection(command.selection) : screenSettings.selection
    if (command.enabled && !selection) return { ok: false, message: '请先选择直播助手窗口与评论、礼物读取区域。' }
    screenSettings = { enabled: !!command.enabled, ...(selection ? { selection } : {}) }
    const file = join(dataDirectory, 'screen-input-settings.json'), temporary = `${file}.tmp`
    writeFileSync(temporary, JSON.stringify(screenSettings), { mode: 0o600 }); renameSync(temporary, file); chmodSync(file, 0o600)
    screenInput!.stop(); inputFailover!.configureScreen(screenSettings.enabled)
    if (screenSettings.enabled) await startScreenInput()
    return { ok: true, data: screenInfo(), message: command.enabled ? '主备自动接收已开启，只切消息来源，不改直播画面与声音。' : '屏幕备用已关闭，后台接收继续。' }
  }
  if (command.type === 'qq-status') return { ok: true, data: localTest || requestedProfile ? { loggedIn: false, loginPending: false, message: '独立测试不登录或请求真实QQ曲库，请在直播工作台连接。' } : await (await getQQ()).status() }
  if (command.type === 'qq-search') return { ok: true, data: await (await getQQ()).search(command.query) }
  if (command.type === 'qq-login-start') return { ok: true, data: await (await getQQ()).loginStart(command.channel) }
  if (command.type === 'qq-login-poll') return { ok: true, data: await (await getQQ()).loginPoll() }
  if (command.type === 'qq-logout') {
    const state = runtime!.getState()
    if (state.music.tracks.find(track => track.id === state.music.current?.trackId)?.source.startsWith('shop-qqmusic:')) await runtime!.command({ type: 'music-stop' })
    return { ok: true, data: await (await getQQ()).logout() }
  }
  if(command.type==='open-capture'){showStage();return {ok:true}}
  if(command.type==='open-local-test'){launchLocalTest();return {ok:true,message:'已打开独立本地测试，不影响正在运行的直播。'}}
  if(command.type==='get-runtime-info')return {ok:true,data:{dataDirectory,localTest,platform:process.platform,driverInstalled:driverInstalled(),captureTitle:localTest?'赛博肥鱼 · 本地测试画面（不推流）':'赛博肥鱼 · 抖音直播采集（9:16）'}}
  if(command.type==='open-audio-setup'){
    if(process.platform==='win32'){await shell.openExternal('https://vb-audio.com/Cable/');return {ok:true,message:'已打开 VB-CABLE 官方页面。安装驱动后，小店输出选 CABLE Input，直播伴侣麦克风选 CABLE Output；不要修改系统默认输出。'}}
    const installer=projectDirectory&&join(projectDirectory,'.local/installers/BlackHole2ch-0.7.1.pkg')
    if(!driverInstalled()&&installer&&existsSync(installer)){const message=await shell.openPath(installer);return message?{ok:false,message:'无法打开安装包，请在项目 .local/installers 文件夹手动打开。'}:{ok:true,message:'已打开 BlackHole 安装器；完成系统授权后重新检测设备。'}}
    if(driverInstalled()){await shell.openPath('/System/Applications/Utilities/Audio MIDI Setup.app');return {ok:true,message:'已打开音频设备设置；请保持电脑默认输出不变。'}}
    await shell.openExternal('https://existential.audio/blackhole/');return {ok:true,message:'已打开 BlackHole 官方下载页。'}
  }
  if(command.type==='import-music'){
    const imported=await media!.import(consoleWindow!)
    return {ok:imported.tracks.length>0||!imported.skipped,data:{tracks:imported.tracks},...(imported.skipped?{message:`已导入 ${imported.tracks.length} 首，${imported.skipped} 个文件因格式、大小、读取错误或曲库上限未导入。`}:{})}
  }
  if(command.type==='input-info')return {ok:true,data:input!.info()}
  if(command.type==='input-copy'){const info=input!.info();clipboard.writeText(JSON.stringify({endpoint:info.endpoint,websocketEndpoint:info.websocketEndpoint,headers:{Authorization:`Bearer ${info.token}`}},null,2));return {ok:true,message:'本机输入连接参数已复制，请仅粘贴给本机弹幕工具。'}}
  if(command.type==='input-start'){
    if(localTest)return {ok:false,message:'独立本地测试不连接真实弹幕输入，请在直播工作台连接。'}
    const config=runtime!.getState().config;await runtime!.command({type:'set-config',config:{...config,input:{...config.input,enabled:true}}});await syncInput(runtime!.getState());return {ok:true,data:input!.info()}
  }
  if(command.type==='input-stop'){const config=runtime!.getState().config;await runtime!.command({type:'set-config',config:{...config,input:{...config.input,enabled:false}}});await syncInput(runtime!.getState());return {ok:true,data:input!.info()}}
  if(command.type==='input-rotate-token')return {ok:true,data:input!.rotateToken()}
  if(command.type==='input-test')return await input!.test()
  if(command.type==='set-config'&&localTest){command={...command,config:{...command.config,demo:true,audio:{...command.config.audio,mode:'test'},input:{...command.config.input,enabled:false}}}}
  return await runtime!.command(command)
}
if(!app.requestSingleInstanceLock())app.quit()
else{
  app.on('second-instance',showConsole)
  app.whenReady().then(async()=>{
    const ownContents=(contents:Electron.WebContents|null)=>!!contents&&[consoleWindow,stageWindow].some(w=>w&&!w.isDestroyed()&&w.webContents.id===contents.id)
    session.defaultSession.setPermissionRequestHandler((contents,permission,callback,details)=>callback(String(permission)==='speaker-selection'&&ownContents(contents)&&allowedUrl(details.requestingUrl)))
    session.defaultSession.setPermissionCheckHandler((contents,permission)=>String(permission)==='speaker-selection'&&ownContents(contents)&&allowedUrl(contents!.getURL()))
    if(!localTest&&!requestedProfile)await migrateLegacyProfile(legacyDirectory,dataDirectory)
    store=createPersistentStore(dataDirectory);media=createMediaLibrary(dataDirectory)
    protocol.handle('shop-qqmusic', async request => {
      try { return await (await getQQ()).stream(request) }
      catch { return new Response('QQ音乐暂时无法播放，请检查点歌台登录状态。', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' } }) }
    })
    const credentials=localTest?{get:()=>undefined,set(){throw new Error('独立本地测试不保存真实密钥，请在直播工作台配置。')},encrypted:false}:createCredentialStore(dataDirectory)
    runtime=createRuntime({store,credentials,archive:store.archive,music:localTest||requestedProfile?undefined:{async resolve(query,signal){signal.throwIfAborted();const provider=await getQQ();signal.throwIfAborted();return provider.resolve(query,signal)}},voice:{
      async synthesize(text,config,key,signal,onRequest){const result=await synthesizeQwen({text,config,apiKey:key,signal,onRequest});return {audio:{kind:result.kind,data:result.data,url:result.url,sampleRate:result.sampleRate,words:result.words,rate:config.rate,outputDeviceId:config.outputDeviceId},characters:result.characters,charactersReported:result.charactersReported,usage:result.usage}},
      async design(description,previewText,config,key,signal){return designQwenVoice({description,previewText,config,apiKey:key,signal})},
      async test(config,key,signal,onRequest){const result=await synthesizeQwen({text:'你好，欢迎来到肥鱼小店，先坐下来歇一会儿吧。',config,apiKey:key,signal,onRequest});return {ok:true,characters:result.characters,charactersReported:result.charactersReported,usage:result.usage}},
    }})
    liveHealth = createLiveHealthReporter(app.getPath('userData'), () => decorate(runtime!.getState()), 10000, () => primaryInput || screenInput || inputFailover ? { primary: primaryInput?.info().diagnostics, bilibili: bilibiliInput?.info(), screen: screenInput?.status(), failover: inputFailover?.info() } : {})
    if(localTest){const config=runtime.getState().config;await runtime.command({type:'set-config',config:{...config,demo:true,audio:{...config.audio,mode:'test',monitorEnabled:false},input:{...config.input,enabled:false}}})}
    inputFailover = createInputFailover({ deliver: event => runtime!.command({ type: 'inject', event: namespaceLiveEvent(event, event.platform || 'douyin') }), onDuplicateGift:event=>runtime!.confirmDuplicateGift({...namespaceLiveEvent(event,event.platform||'douyin'),origin:'bridge'}), onChange: info => { douyinInputStatus = info.message; refreshInputStatus() } })
    screenInput = createLiveScreenInput({ ...(!app.isPackaged && projectDirectory ? { nativePath: join(projectDirectory, '.local/native', process.platform === 'win32' ? 'live-screen-ocr.ps1' : 'live-screen-ocr') } : {}), onCandidates: rows => { void inputFailover!.screenCandidates(rows) }, onStatus: status => inputFailover!.screenStatus(status) })
    if (!localTest && !requestedProfile) {
      try { const saved = JSON.parse(readFileSync(join(dataDirectory, 'screen-input-settings.json'), 'utf8')); screenSettings = { enabled: saved.enabled === true, ...(saved.selection ? { selection: checkedScreenSelection(saved.selection) } : {}) } } catch { /* Fresh or invalid input preferences remain disabled. */ }
    }
    inputFailover.configureScreen(screenSettings.enabled)
    input=createLiveInputBridge({onEvent:event=>{
      const platform=event.platform||runtime!.getState().config.input.platform||'douyin'
      return platform==='bilibili'?runtime!.command({type:'inject',event:{...namespaceLiveEvent(event,'bilibili'),origin:'bridge'}}):inputFailover!.bridgeEvent(namespaceLiveEvent(event,'douyin'),'local')
    },onHealth:signal=>{if(runtime!.getState().config.input.platform!=='bilibili')inputFailover!.bridgeHealth({...signal,channel:'local'})},onStatus:()=>{ inputFailover!.tick() }})
    // A Bilibili local bridge must not mark Douyin healthy and hide its OCR backup.
    primaryInput = createDouyinReceiver({ signer:createDouyinSigner({allowPinnedFallback:true}),onEvent:event=>inputFailover!.bridgeEvent(namespaceLiveEvent(event,'douyin'),'direct'),onStatus:status=>{
      if(status.state==='connected'){const signal=Math.max(status.lastFrameAt||0,status.lastPongAt||0);if(signal>lastPrimarySignal){lastPrimarySignal=signal;inputFailover!.bridgeHealth({state:'heartbeat',heartbeatExpected:true,channel:'direct'})}else if(!lastPrimarySignal)inputFailover!.bridgeHealth({state:'connected',heartbeatExpected:true,channel:'direct'})}
      else{lastPrimarySignal=0;inputFailover!.bridgeHealth({state:'disconnected',channel:'direct'})}
    }})
    bilibiliInput = createBilibiliReceiver({ credentials: () => bilibiliController?.credentials(), onEvent: event => runtime!.command({ type: 'inject', event: { ...event, origin: 'bridge' } }), onStatus: () => refreshInputStatus() })
    bilibiliController = createBilibiliInputController({ store: credentials, receiver: bilibiliInput, disabled: localTest || !!requestedProfile })
    refreshInputStatus()
    roomDiscovery=createDouyinRoomDiscovery({onRoom:candidate=>{if(!primarySettings.enabled||primarySettings.room)return;const next=candidate.field==='web_rid'?candidate.roomId:`room_id:${candidate.roomId}`;if(next===discoveredRoom)return;discoveredRoom=next;primaryInput!.stop();primaryOperation=undefined;startPrimaryInput()}})
    if(!localTest&&!requestedProfile){try{const saved=JSON.parse(readFileSync(join(dataDirectory,'douyin-input-settings.json'),'utf8'));primarySettings={enabled:saved.enabled===true,room:typeof saved.room==='string'&&saved.room.trim()?parseDouyinRoom(saved.room):''}}catch{/* No automatic room is guessed. */}}
    inputFailoverTimer = setInterval(() => { inputFailover?.tick(); if (screenSettings.enabled && ['disconnected','unavailable','permission-needed'].includes(screenInput!.status().state) && Date.now() - screenRetryAt >= 10000) void startScreenInput();if(primarySettings.enabled&&['ended','stopped','error'].includes(primaryInput!.info().state)&&Date.now()-primaryRetryAt>=30000)startPrimaryInput() }, 1000)
    inputFailoverTimer.unref?.()
    ipcMain.handle('shop:get-state',event=>{assertSender(event);return decorate(runtime!.getState())})
    ipcMain.handle('shop:command',async(event,command:unknown)=>{
      assertSender(event)
      if(!command||typeof command!=='object'||!('type'in command)||!commandTypes.has(String(command.type)))return {ok:false,message:'无法识别这条操作。'}
      if(JSON.stringify(command).length>128*1024)return {ok:false,message:'操作内容过长，请缩短后重试。'}
      if(event.sender.id===stageWindow?.webContents.id&&!['stage-event','music-started','music-ended','music-error'].includes(String(command.type)))return {ok:false,message:'请从小店后台执行此操作。'}
      try{return await desktopCommand(command as Command)}catch(error){return {ok:false,message:error instanceof Error?error.message:'操作未完成，请检查输入内容后重试。'}}
    })
    ipcMain.handle('shop:open-stage',event=>{assertSender(event);showStage()})
    ipcMain.handle('shop:export-logs',async event=>{
      assertSender(event)
      const result=await dialog.showSaveDialog(consoleWindow!,{title:'导出小店日志',defaultPath:`肥鱼小店日志-${new Date().toISOString().slice(0,10)}.json`,filters:[{name:'JSON 日志',extensions:['json']}]})
      if(result.canceled||!result.filePath)return {ok:true,message:'已取消导出。'}
      try{const state=runtime!.getState();await writeFile(result.filePath,JSON.stringify({exportedAt:new Date().toISOString(),version:state.version,logs:state.logs,history:state.history,costs:state.costs},null,2),{encoding:'utf8',mode:0o600});return {ok:true,message:'日志已导出。'}}catch{return {ok:false,message:'无法写入所选位置，请换一个文件夹。'}}
    })
    const iconPath=app.isPackaged?join(process.resourcesPath,'app-icon.png'):join(projectDirectory || app.getAppPath(),'assets/app-icon.png')
    const icon=nativeImage.createFromPath(iconPath).resize({width:18,height:18})
    tray=new Tray(icon);tray.setToolTip(localTest?'赛博肥鱼 · 本地测试':'赛博肥鱼 · 后台营业');tray.on('click',showConsole)
    unsubscribe=runtime.subscribe(state=>{
      if(state.running&&sleepBlocker===undefined)sleepBlocker=powerSaveBlocker.start('prevent-app-suspension')
      else if(!state.running&&sleepBlocker!==undefined){powerSaveBlocker.stop(sleepBlocker);sleepBlocker=undefined}
      broadcast(state);buildMenu();void syncInput(state).catch(()=>{inputStatus='输入桥连接失败，请检查连接设置。';broadcast()})
    })
    await refreshAudioReservation()
    audioReservationTimer = setInterval(() => { void refreshAudioReservation().catch(() => {}) }, 500)
    audioReservationTimer.unref?.()
    consoleWindow=createWindow(false);stageWindow=createWindow(true);buildMenu();await syncInput(runtime.getState());void startScreenInput();void syncPrimaryDiscovery()
  }).catch(error=>{dialog.showErrorBox('小店暂时无法启动',error instanceof Error?error.message:'请重新启动应用。');app.quit()})
  app.on('before-quit',()=>{quitting=true;liveHealth?.stop();clearInterval(audioReservationTimer);clearInterval(inputFailoverTimer);inputFailover?.dispose();screenInput?.dispose();roomDiscovery?.dispose();primaryInput?.stop();void bilibiliInput?.stop();unsubscribe?.();void input?.stop();qq?.dispose();protocol.unhandle('shop-qqmusic');runtime?.dispose();media?.dispose();tray?.destroy();if(sleepBlocker!==undefined)powerSaveBlocker.stop(sleepBlocker);store?.close()})
  app.on('window-all-closed',()=>{if(quitting)app.quit()})
  app.on('activate',showConsole)
}
