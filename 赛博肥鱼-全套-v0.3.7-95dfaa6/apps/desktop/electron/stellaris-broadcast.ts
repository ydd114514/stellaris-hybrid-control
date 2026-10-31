import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createLiveInputBridge } from './live-input'
import type { StellarisLiveInfo, StellarisLiveResult } from '../../../packages/shared/src/stellaris'
import type { LiveEvent } from '../../../packages/shared/src/index'

export const OVERLAY_URL = 'http://127.0.0.1:17655/overlay?voice=1'
export const PREVIEW_URL = 'http://127.0.0.1:17655/'

/** Ordinary OBS sources, no account information, stream key or start-streaming command. */
export function stellarisObsCollection() {
  const game = randomUUID(), overlay = randomUUID(), music = randomUUID(), scene = randomUUID()
  const source = (id: string, name: string, uuid: string, settings: object, volume = 1) => ({ id, versioned_id: id, name, uuid, settings, volume, balance: .5, mixers: 1, enabled: true, muted: false, monitoring_type: 0, sync: 0, flags: 0, hotkeys: {}, private_settings: {} })
  const item = (name: string, uuid: string, id: number, x: number, y: number, width: number, height: number) => ({ name, source_uuid: uuid, id, visible: true, locked: true, rot: 0, align: 5,
    pos: { x, y }, scale: { x: 1, y: 1 }, bounds_type: 2, bounds_align: 5, bounds: { x: width, y: height }, crop_left: 0, crop_top: 0, crop_right: 0, crop_bottom: 0 })
  return { name: '大肥鱼 · 群星直播', version: 1, resolution: { x: 1920, y: 1080 }, current_scene: '大肥鱼 · 群星', current_program_scene: '大肥鱼 · 群星', scene_order: [{ name: '大肥鱼 · 群星' }],
    current_transition: '淡入淡出', transition_duration: 300, transitions: [{ name: '淡入淡出', id: 'fade_transition', settings: {} }], quick_transitions: [], groups: [], modules: {},
    // Explicitly disable all global capture channels when this collection loads.
    DesktopAudioDevice1: null, DesktopAudioDevice2: null,
    AuxAudioDevice1: null, AuxAudioDevice2: null, AuxAudioDevice3: null,
    sources: [
      source('game_capture', '群星 · 实时游戏与声音', game, { capture_mode: 'window', window: 'Stellaris:SDL_app:stellaris.exe', priority: 2, capture_audio: true, capture_cursor: true, capture_overlays: false }, .6),
      source('browser_source', '大肥鱼 · 蓝白框面与字幕', overlay, { url: OVERLAY_URL, width: 1920, height: 1080, fps_custom: true, fps: 30, reroute_audio: true, shutdown: false, restart_when_active: false, css: 'body { background-color: rgba(0,0,0,0); margin: 0; overflow: hidden; }' }),
      source('wasapi_process_output_capture','大肥鱼 · QQ音乐',music,{window:'大肥鱼 DSH · QQ音乐:Chrome_WidgetWin_1:大肥鱼 DSH.exe',priority:2},1),
      source('scene', '大肥鱼 · 群星', scene, { id_counter: 3, custom_size: true, cx: 1920, cy: 1080, items: [item('群星 · 实时游戏与声音', game, 1, 32, 78, 1504, 846), item('大肥鱼 · 蓝白框面与字幕', overlay, 2, 0, 0, 1920, 1080),item('大肥鱼 · QQ音乐',music,3,0,0,1,1)] }),
    ] }
}

async function prepareCommentary(root: string) {
  await new Promise<void>((done, fail) => {
    const env = { ...process.env }; delete env.DEEPSEEK_API_KEY; delete env.ELECTRON_RUN_AS_NODE
    const child = spawn(process.env.CYBERFISH_NODE || join(process.env.ProgramFiles || 'C:/Program Files', 'nodejs/node.exe'), ['--input-type=module', '-e', 'import {ensureCommentary} from "./src/commentary-launch.mjs"; await ensureCommentary();'], { cwd: root, env, windowsHide: true, stdio: 'ignore' })
    const timer = setTimeout(() => { child.kill(); fail(new Error('直播画面服务启动超时，请检查控制器目录。')) }, 12000)
    child.once('error', () => { clearTimeout(timer); fail(new Error('无法准备直播画面，请检查本机 Node.js。')) })
    child.once('exit', code => { clearTimeout(timer); code === 0 ? done() : fail(new Error('直播画面服务未启动，请检查控制器目录。')) })
  })
}

export function createStellarisBroadcast(options: { disabled?: boolean; getProject(): Promise<string | undefined>; prepare?: (root: string) => Promise<void>; healthy?: () => Promise<boolean>; port?: number; onAudienceEvent?: (event:LiveEvent)=>unknown }) {
  let inputRoot: string | undefined, disposed = false, busy = false, inputGeneration = 0
  let delivery = Promise.resolve()
  const seen = new Set<string>()
  // Both room sockets and the authenticated local bridge share this serial delivery
  // boundary, so a duplicate cannot race an awaited file write on the other input.
  function enqueue(event:LiveEvent,origin:'bridge'|'bilibili-web',resolveRoot:()=>Promise<string|undefined>,current:()=>boolean) {
    let accepted = false
    const work = delivery.catch(()=>{}).then(async()=>{
      if(!current()||disposed||seen.has(event.id)){accepted=current()&&!disposed;return}
      const root=await resolveRoot()
      if(!root||!current()||disposed)return
      if(event.kind==='chat'&&event.text){
        await mkdir(join(root,'.local/commentary'),{recursive:true})
        if(!current()||disposed)return
        // Viewer text is display data. It is never passed to a game command or shell.
        await appendFile(join(root,'.local/commentary/audience.jsonl'),JSON.stringify({id:event.id,type:'chat',platform:'bilibili',origin,name:event.user.name,text:event.text,at:Date.now()})+'\n')
      }
      if(!current()||disposed)return
      seen.add(event.id);if(seen.size>10000)seen.delete(seen.values().next().value!)
      await options.onAudienceEvent?.(event)
      accepted=true
    })
    delivery=work.then(()=>{},()=>{})
    return work.then(()=>accepted)
  }
  const input = createLiveInputBridge({ onEvent: async event => {
    const root=inputRoot,run=inputGeneration
    if(!root||disposed||event.platform!=='bilibili')return {ok:false,message:'只接收当前 B 站本地连接的消息。'}
    const ok=await enqueue(event,'bridge',async()=>root,()=>run===inputGeneration&&inputRoot===root)
    return {ok,...(!ok?{message:'本地连接已停止。'}:{})}
  } })
  async function healthy() {
    if (options.disabled || disposed) return false
    if (options.healthy) return options.healthy()
    try { const r = await fetch(PREVIEW_URL + 'health', { signal: AbortSignal.timeout(1500), redirect: 'error' }); return r.ok && (await r.json()).application === 'cyberfish-commentary' } catch { return false }
  }
  async function info(): Promise<StellarisLiveInfo> {
    const local = input.info()
    return { localTest: !!options.disabled, ready: await healthy(), previewUrl: PREVIEW_URL, overlayUrl: OVERLAY_URL,
      input: { status: local.status, received: local.received, rejected: local.rejected, lastEventAt: local.lastEventAt, endpoint: local.endpoint,
        message: local.status === 'listening' ? '本机接收器已就绪，等候 B 站弹幕工具转发；尚未连接真实直播间。' : local.status === 'stopped' ? '尚未开启本地弹幕接入。' : local.message } }
  }
  async function operation(action: 'prepare' | 'start' | 'stop' | 'test'): Promise<StellarisLiveResult> {
    if (options.disabled || disposed) return { ok: false, message: '独立测试不启动真实服务或读取直播接入信息。', info: await info() }
    if (busy) return { ok: false, message: '正在处理上一次直播设置操作。', info: await info() }
    busy = true
    try {
      if (action === 'stop') { inputGeneration++;inputRoot = undefined;await input.stop(); return { ok: true, message: '本地弹幕接入已关闭。', info: await info() } }
      if (action === 'test') { const result = await input.test(); return { ok: result.ok, message: result.ok ? '本地认证与消息解析通过；没有插入假弹幕，也没有调用模型。' : '请先开启本地弹幕接入。', info: await info() } }
      const root = await options.getProject()
      if (disposed) return { ok: false, message: '桌面端已退出，本次设置已取消。', info: await info() }
      if (!root) return { ok: false, message: '请先在群星控制台选择有效的 stellaris-player 目录。', info: await info() }
      if (action === 'prepare') { await (options.prepare || prepareCommentary)(root); return { ok: true, message: '直播画面已准备；可以预览或导入 OBS 场景。', info: await info() } }
      if (input.info().status === 'stopped') { inputRoot = root;inputGeneration++;await input.start({ port: options.port ?? 17658 }) }
      return { ok: true, message: '本地弹幕接入已开启。复制接入配置给你使用的弹幕转发工具。', info: await info() }
    } catch { return { ok: false, message: '本地直播服务未准备好，请检查端口和控制器目录后重试。', info: await info() } }
    finally { busy = false }
  }
  function connectionConfig() {
    if (options.disabled || disposed || input.info().status === 'stopped') return
    const value = input.info()
    return JSON.stringify({ protocol: 'cyberfish-normalized-v1', endpoint: value.endpoint, websocketEndpoint: value.websocketEndpoint, headers: { Authorization: `Bearer ${value.token}`, 'Content-Type': 'application/json' },
      example: { id: '平台消息唯一ID', platform: 'bilibili', kind: 'chat', user: { id: '观众ID', name: '观众昵称' }, text: '真实弹幕内容', at: Date.now() } }, null, 2)
  }
  async function receivePlatform(event:LiveEvent) {
    if(options.disabled||disposed||event.platform!=='bilibili'||!['chat','gift','follow','enter','like'].includes(event.kind)||event.kind==='chat'&&!event.text)return
    await enqueue(event,'bilibili-web',options.getProject,()=>!disposed)
  }
  return { info, operation, connectionConfig, receivePlatform, async dispose() { disposed = true;inputGeneration++;inputRoot = undefined;await input.stop();await delivery;seen.clear() } }
}
