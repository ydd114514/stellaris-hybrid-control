import { app, BrowserWindow, clipboard, dialog, ipcMain, protocol, safeStorage, session, shell } from 'electron'
import { join, dirname } from 'node:path'
import { mkdirSync } from 'node:fs'
import { writeFile,readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { findProjectDirectory } from './portable'
import { createStellarisController } from './stellaris-controller'
import { createStellarisBroadcast, stellarisObsCollection, OVERLAY_URL, PREVIEW_URL } from './stellaris-broadcast'
import { createStellarisMusic } from './stellaris-music'
import { createQQMusic } from './qq-music'
import { createQQVault } from './qq-vault'
import { createBilibiliRoom } from './bilibili-room'
import { createStellarisAi } from './stellaris-ai'
import {createStellarisSpeech} from './stellaris-speech'
import { prepareStellarisBundle } from './stellaris-bundle'
import { resolveStellarisProfile } from './stellaris-profile'

app.setName('群星控制器大肥鱼')
protocol.registerSchemesAsPrivileged([{scheme:'shop-qqmusic',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true,corsEnabled:true}}])
if (process.platform === 'win32') app.setAppUserModelId('cn.cyberfish.stellaris')
const testProfile = process.env.CYBER_FISH_TEST_DATA_DIR
const offline = process.argv.includes('--dsh-offline-test') || !!testProfile
const headlessSmoke = offline && process.argv.includes('--dsh-headless-smoke')
const sourceRoot = findProjectDirectory(app.getAppPath()) || findProjectDirectory(dirname(process.execPath))
const basic = process.env.CYBERFISH_BASIC_EDITION === '1'
const localSource = process.env.CYBERFISH_LOCAL_SOURCE === '1'
const dataRoot = resolveStellarisProfile({sourceRoot,documents:app.getPath('documents'),appData:app.getPath('appData'),basic,testProfile})
mkdirSync(dataRoot, { recursive: true }); app.setPath('userData', dataRoot)
const renderer = join(__dirname, '../renderer/stellaris.html')
const musicRenderer=join(__dirname,'../renderer/music-player.html')
let window: BrowserWindow | undefined, controller: ReturnType<typeof createStellarisController> | undefined
let broadcast: ReturnType<typeof createStellarisBroadcast> | undefined, preview: BrowserWindow | undefined
let music:ReturnType<typeof createStellarisMusic>|undefined,musicPlayer:BrowserWindow|undefined
let room:ReturnType<typeof createBilibiliRoom>|undefined,biliLogin:BrowserWindow|undefined,savedRoom:number|undefined
let ai:ReturnType<typeof createStellarisAi>|undefined
let speech:ReturnType<typeof createStellarisSpeech>|undefined,speechOwnsChat=false,speechPlayer:BrowserWindow|undefined
let speechControlGeneration=0,chatControlGeneration=0,playerControlGeneration=0
let quitting = false, readyToQuit = false
const validUrl = (url: string) => { try { return new URL(url).protocol === 'file:' && fileURLToPath(url) === renderer } catch { return false } }
function assertSender(event: Electron.IpcMainInvokeEvent) {
  if (!window || window.isDestroyed() || event.sender.id !== window.webContents.id || !event.senderFrame || !validUrl(event.senderFrame.url)) throw new Error('请从群星控制器大肥鱼 桌面控制台操作。')
}
if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => { window?.restore(); window?.show(); window?.focus() })
  app.whenReady().then(async () => {
    const bundledRoot = !offline && !localSource ? await prepareStellarisBundle(process.resourcesPath, dataRoot) : undefined
    controller = createStellarisController({ dataDirectory: dataRoot, disabled: offline,
      preferredProject: localSource && sourceRoot ? join(dirname(sourceRoot),'stellaris-player') : bundledRoot,
      candidates: bundledRoot ? [bundledRoot] : sourceRoot ? [join(dirname(sourceRoot), 'stellaris-player')] : [],
      nodePath: process.env.CYBERFISH_NODE, enginePackagePath: process.env.CYBERFISH_DSH_PACKAGE })
    music=createStellarisMusic({directory:dataRoot,disabled:offline,provider:async isAllowed=>{
      const vault=createQQVault(dataRoot),secret=vault.secret,previous=process.env.LOG_LEVEL
      let provider:typeof import('@yakult-green-tea/qq-music-api/serverless')
      try{process.env.LOG_LEVEL='silent';provider=await import('@yakult-green-tea/qq-music-api/serverless')}
      finally{if(previous===undefined)delete process.env.LOG_LEVEL;else process.env.LOG_LEVEL=previous}
      return createQQMusic({vault,isAllowed,request:request=>provider.handleRequest(request,{QQ_SESSION_SECRET:secret})})
    }})
    protocol.handle('shop-qqmusic',request=>music!.stream(request).catch(()=>new Response('音乐读取未完成',{status:502})))
    speech=createStellarisSpeech({directory:dataRoot,disabled:offline,getProject:async()=>(await controller!.getStatus()).projectDirectory,samplesDirectory:join(dataRoot,'captain-auditions'),tunedSamplesDirectory:join(__dirname,'../captain-tuned'),
      onStop:()=>{speechControlGeneration++;if(speechOwnsChat){speechOwnsChat=false;void ai?.action({type:'stop'})}},
      secrets:{available:()=>safeStorage.isEncryptionAvailable(),encrypt:value=>safeStorage.encryptString(value).toString('base64'),decrypt:value=>safeStorage.decryptString(Buffer.from(value,'base64'))}})
    ai = createStellarisAi({ dataDirectory: dataRoot, disabled: offline, basic, getProject: async () => (await controller!.getStatus()).projectDirectory, copy: text => clipboard.writeText(text),onSpoken:lines=>{for(const line of lines)speech?.say({id:line.id,text:line.to?`${line.to}，${line.text}`:line.text,kind:'host',at:line.at})},
      secrets: { available: () => safeStorage.isEncryptionAvailable(), encrypt: value => safeStorage.encryptString(value).toString('base64'), decrypt: value => safeStorage.decryptString(Buffer.from(value, 'base64')) } })
    broadcast = createStellarisBroadcast({ disabled: offline, getProject: async () => (await controller!.getStatus()).projectDirectory,onAudienceEvent:event=>{music!.event(event);ai!.feed(event)} })
    const biliSession=session.fromPartition('persist:cyberfish-bilibili')
    biliSession.setPermissionRequestHandler((_,__,done)=>done(false))
    room=createBilibiliRoom({disabled:offline,onEvent:event=>broadcast!.receivePlatform(event),cookies:async()=>{
      const cookies=await biliSession.cookies.get({url:'https://api.bilibili.com'})
      return cookies.filter(c=>['SESSDATA','buvid3','DedeUserID'].includes(c.name)&&!/[\r\n;]/.test(c.value)).map(c=>`${c.name}=${c.value}`).join('; ')
    }})
    if(!offline)try{const prefs=JSON.parse(await readFile(join(dataRoot,'bilibili-room.json'),'utf8'));if(Number.isSafeInteger(prefs.roomId)&&prefs.roomId>0)savedRoom=prefs.roomId}catch{}
    const liveInfo=async()=>({...await broadcast!.info(),bilibili:{...room!.view(),roomId:room!.view().roomId||savedRoom}})
    async function showMusicPlayer(){
      if(!musicPlayer||musicPlayer.isDestroyed()){
        musicPlayer=new BrowserWindow({width:540,height:170,title:'群星控制器大肥鱼 · QQ音乐',autoHideMenuBar:true,webPreferences:{preload:join(__dirname,'preload.cjs'),contextIsolation:true,sandbox:true,nodeIntegration:false,webSecurity:true,autoplayPolicy:'no-user-gesture-required'}})
        musicPlayer.webContents.setWindowOpenHandler(()=>({action:'deny'}))
        musicPlayer.webContents.on('will-navigate',(e,url)=>{if(url!==new URL(`file:///${musicRenderer.replaceAll('\\','/')}`).href)e.preventDefault()})
        musicPlayer.on('closed',()=>{musicPlayer=undefined;void music?.action('stop')})
        await musicPlayer.loadFile(musicRenderer)
      }
      musicPlayer.webContents.setAudioMuted(false)
    }
    const playerSender=(event:Electron.IpcMainInvokeEvent)=>musicPlayer&&!musicPlayer.isDestroyed()&&event.sender.id===musicPlayer.webContents.id&&event.senderFrame&&event.senderFrame.url.startsWith('file:')&&fileURLToPath(event.senderFrame.url)===musicRenderer
    ipcMain.handle('dsh:music-view',event=>{if(!playerSender(event))assertSender(event);return music!.view()})
    ipcMain.handle('dsh:music-feedback',(event,generation:unknown,kind:unknown)=>{if(!playerSender(event))throw new Error('仅音乐播放器可确认播放');music!.feedback(generation,kind)})
    ipcMain.handle('dsh:music-action',async(event,action:unknown,value:unknown)=>{
      assertSender(event)
      if(!['connect','login','poll','start','stop','add','remove','volume','next','blacklist','queueLimit'].includes(String(action)))throw new Error('不支持的音乐操作')
      if(action==='stop'||action==='blacklist')musicPlayer?.webContents.setAudioMuted(true)
      const result=await music!.action(String(action),value)
      if(action==='start'&&result.ok)await showMusicPlayer()
      return result
    })
    ipcMain.handle('dsh:status', event => { assertSender(event); return controller!.getStatus() })
    ipcMain.handle('dsh:save-game-key', (event, key: unknown) => { assertSender(event); return controller!.saveGameKey(key) })
    ipcMain.handle('dsh:set-hybrid-survey',(event,enabled:unknown)=>{assertSender(event);return controller!.setHybridSurvey(enabled)})
    ipcMain.handle('dsh:set-native-country-ai',(event,enabled:unknown)=>{assertSender(event);return controller!.setNativeCountryAI(enabled)})
    ipcMain.handle('dsh:start', event => { assertSender(event); return controller!.start() })
    ipcMain.handle('dsh:stop', event => { assertSender(event); return controller!.stop() })
    ipcMain.handle('dsh:live-info', event => { assertSender(event); return liveInfo() })
    ipcMain.handle('dsh:ai-view', event => { assertSender(event); return ai!.view() })
    ipcMain.handle('dsh:ai-action', (event, action: unknown) => { assertSender(event);if(['start','start-chat','stop'].includes((action as any)?.type)){chatControlGeneration++;speechOwnsChat=false}return ai!.action(action as any) })
    ipcMain.handle('dsh:speech-view',event=>{assertSender(event);return speech!.view()})
    ipcMain.handle('dsh:speech-action',async(event,action:unknown)=>{
      assertSender(event)
      const playerTicket=(action as any)?.type==='open-player'?++playerControlGeneration:0
      if((action as any)?.type==='close-player'){
        playerControlGeneration++
        speechPlayer?.webContents.setAudioMuted(true);speechPlayer?.close();speechPlayer=undefined
        return {ok:true,message:'本机语音播放器已关闭；直播浏览器源可在租约释放后接管。',view:await speech!.view()}
      }
      const result=await speech!.action(action as any)
      if(result.ok&&(action as any)?.type==='auditions'&&result.view.auditionsUrl)await shell.openExternal(result.view.auditionsUrl)
      if(result.ok&&(action as any)?.type==='open-player'&&result.view.playerUrl){
        if(playerTicket!==playerControlGeneration)return {...result,ok:false,message:'本机播放器打开已取消。'}
        const url=result.view.playerUrl
        if(!speechPlayer||speechPlayer.isDestroyed()){
          const player=new BrowserWindow({width:620,height:220,title:'大肥鱼 · 本机语音播放器',autoHideMenuBar:true,webPreferences:{contextIsolation:true,sandbox:true,nodeIntegration:false,webSecurity:true,backgroundThrottling:false,autoplayPolicy:'no-user-gesture-required'}})
          speechPlayer=player
          player.webContents.setWindowOpenHandler(()=>({action:'deny'}))
          player.webContents.on('will-navigate',(e,next)=>{if(next!==url)e.preventDefault()})
          player.on('closed',()=>{if(speechPlayer===player){speechPlayer=undefined;playerControlGeneration++}})
          await player.loadURL(url)
          if(playerTicket!==playerControlGeneration){if(!player.isDestroyed())player.close();return {...result,ok:false,message:'本机播放器打开已取消。'}}
        }else{speechPlayer.show();speechPlayer.focus()}
        speechPlayer?.webContents.setAudioMuted(false)
      }
      if(result.ok&&(action as any)?.type==='start'&&result.view.config.replyAudience){
        const speechTicket=speechControlGeneration,chatTicket=chatControlGeneration,wasRunning=ai!.view().status.running
        const chat=await ai!.action({type:'start-chat'})
        if(speechTicket!==speechControlGeneration||!(await speech!.view()).enabled){
          if(chat.ok&&!wasRunning&&chatTicket===chatControlGeneration)await ai!.action({type:'stop'})
          return {...result,ok:false,message:'语音启动已取消。',view:await speech!.view()}
        }
        if(!chat.ok){await speech!.action({type:'stop'});return {...result,ok:false,message:chat.message||'请先在AI中枢配置场控模型。',view:await speech!.view()}}
        if(!wasRunning&&chatTicket===chatControlGeneration)speechOwnsChat=true
      }
      if(result.ok&&(action as any)?.type==='stop'&&speechOwnsChat){speechOwnsChat=false;await ai!.action({type:'stop'})}
      return result
    })
    ipcMain.handle('dsh:live-action', async (event, action: unknown,value:unknown) => {
      assertSender(event)
      if (!['prepare', 'start', 'stop', 'test', 'preview', 'copyOverlay', 'copyInput', 'exportObs','connectRoom','disconnectRoom','loginBilibili'].includes(String(action))) throw new Error('不支持的直播设置操作。')
      if (offline) return { ok: false, message: '独立测试不启动服务、写剪贴板或导出真实文件。', info: await broadcast!.info() }
      if(action==='disconnectRoom'){room!.stop();return {ok:true,message:'已断开真实直播间。音乐可在上方单独停止。',info:await liveInfo()}}
      if(action==='connectRoom'){
        const project=(await controller!.getStatus()).projectDirectory
        if(!project)return {ok:false,message:'请先选择群星控制器目录。',info:await liveInfo()}
        const result=await room!.start(value)
        if(result.ok){savedRoom=room!.view().roomId;await writeFile(join(dataRoot,'bilibili-room.json'),JSON.stringify({roomId:savedRoom}));await broadcast!.operation('prepare')
          const playing=await music!.action('start');if(playing.ok)await showMusicPlayer()
          return {...result,message:result.message+(playing.ok?' 背景音乐已开启。':' QQ音乐尚未开启，请先在上方扫码连接。'),info:await liveInfo()}
        }return {...result,info:await liveInfo()}
      }
      if(action==='loginBilibili'){
        if(!biliLogin||biliLogin.isDestroyed()){
          biliLogin=new BrowserWindow({width:1040,height:760,title:'群星控制器大肥鱼 · B站扫码登录',autoHideMenuBar:true,webPreferences:{partition:'persist:cyberfish-bilibili',contextIsolation:true,sandbox:true,nodeIntegration:false,webSecurity:true,backgroundThrottling:false}})
          biliLogin.webContents.setAudioMuted(true);biliLogin.webContents.setWindowOpenHandler(()=>({action:'deny'}))
          const allowed=(url:string)=>{try{const u=new URL(url);return u.protocol==='https:'&&(u.hostname==='bilibili.com'||u.hostname.endsWith('.bilibili.com'))}catch{return false}}
          biliLogin.webContents.on('will-navigate',(e,url)=>{if(!allowed(url))e.preventDefault()});biliLogin.webContents.on('will-redirect',(e,url)=>{if(!allowed(url))e.preventDefault()})
          biliLogin.on('closed',()=>{biliLogin=undefined;const status=room!.view();if(status.roomId&&status.status!=='stopped')void room!.start(String(status.roomId))})
          await biliLogin.loadURL('https://passport.bilibili.com/login')
        }else{biliLogin.show();biliLogin.focus()}
        return {ok:true,message:'请在B站官方页面扫码；完成后关闭登录窗口，正在运行的弹幕连接会刷新登录态。',info:await liveInfo()}
      }
      if (action === 'prepare' || action === 'start' || action === 'stop' || action === 'test') return broadcast!.operation(action)
      let message = ''
      if (action === 'copyOverlay') { clipboard.writeText(OVERLAY_URL); message = '已复制透明框面地址，浏览器源尺寸设为 1920 × 1080。' }
      if (action === 'copyInput') {
        const config = broadcast!.connectionConfig()
        if (!config) return { ok: false, message: '请先开启本地弹幕接入。', info: await broadcast!.info() }
        clipboard.writeText(config); message = '已复制本机弹幕接入配置，含本机令牌；请只交给你信任的本地转发工具。'
      }
      if (action === 'exportObs') {
        const saved = await dialog.showSaveDialog(window!, { title: '导出大肥鱼 OBS 场景', defaultPath: join(app.getPath('documents'), '大肥鱼群星-OBS.json'), filters: [{ name: 'OBS 场景集合', extensions: ['json'] }] })
        if (!saved.canceled && saved.filePath) { await writeFile(saved.filePath, JSON.stringify(stellarisObsCollection(), null, 2)); message = '场景已导出。在 OBS 的“场景集合 → 导入”中选择该文件，再核对游戏来源和声音。' }
        else message = '未导出文件。'
      }
      if (action === 'preview') {
        const prepared = await broadcast!.operation('prepare'); if (!prepared.ok) return prepared
        if (!preview || preview.isDestroyed()) {
          preview = new BrowserWindow({ width: 1280, height: 760, title: '群星控制器大肥鱼 · 直播布局预览（静音）', autoHideMenuBar: true,
            webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true } })
          preview.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
          preview.webContents.on('will-navigate', (e, url) => { if (url !== PREVIEW_URL) e.preventDefault() })
          preview.on('closed', () => { preview = undefined })
          await preview.loadURL(PREVIEW_URL)
        } else { preview.show(); preview.focus() }
        message = '已打开静音布局预览；正式游戏使用直播软件的实时游戏采集。'
      }
      return { ok: true, message, info: await liveInfo() }
    })
    ipcMain.handle('dsh:choose-project', async event => {
      assertSender(event)
      const status = await controller!.getStatus()
      if (offline || status.canStop) return { ok: false, status, message: offline ? '独立测试不更改真实控制器配置。' : '请先停止控制器，再更换目录。' }
      const picked = await dialog.showOpenDialog(window!, { title: '选择 stellaris-player 控制器目录', properties: ['openDirectory'] })
      return picked.canceled || !picked.filePaths[0] ? { ok: true, status, message: '未更改控制器目录。' } : controller!.setProject(picked.filePaths[0])
    })
    window = new BrowserWindow({ width: 1120, height: 850, minWidth: 900, minHeight: 690, title: '群星控制器大肥鱼 · 群星控制台',
      backgroundColor: '#eef5ff', autoHideMenuBar: true, show: false,focusable:!headlessSmoke,skipTaskbar:headlessSmoke,
      webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true } })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.on('closed',()=>app.quit())
    window.webContents.on('will-navigate', (event, url) => { if (!validUrl(url)) event.preventDefault() })
    window.on('page-title-updated', event => event.preventDefault())
    window.once('ready-to-show', () => {if(!headlessSmoke)window!.show()})
    await window.loadFile(renderer,{query:process.argv.includes('--ai-hub')?{panel:'ai'}:process.argv.includes('--music')?{panel:'music'}:process.argv.includes('--speech')?{panel:'speech'}:{}})
  }).catch(() => { dialog.showErrorBox('群星控制器大肥鱼 暂时无法打开', '请检查程序目录是否完整，或重新解压安装包。游戏没有自动启动。'); app.quit() })
  app.on('before-quit', event => {
    if (readyToQuit) return
    event.preventDefault()
    if (quitting) return
    quitting = true
    playerControlGeneration++
    musicPlayer?.webContents.setAudioMuted(true)
    speechPlayer?.webContents.setAudioMuted(true)
    void Promise.allSettled([Promise.resolve(controller?.dispose()), Promise.resolve(room?.dispose()),Promise.resolve(broadcast?.dispose()),Promise.resolve(music?.dispose()),Promise.resolve(ai?.dispose()),Promise.resolve(speech?.dispose())]).finally(() => { readyToQuit = true; app.quit() })
  })
  app.on('window-all-closed', () => app.quit())
}
