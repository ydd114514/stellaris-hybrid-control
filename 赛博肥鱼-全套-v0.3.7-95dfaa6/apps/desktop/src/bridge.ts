import type { ShopBridge, AppState, Command } from '../../../packages/shared/src'
import { createRuntime } from '../../../packages/core/src/runtime'
import { createMemoryArchive, type ArchiveRow } from '../../../packages/core/src/archive'

let cachedBridge: ShopBridge | undefined

export function getBridge(): ShopBridge {
  if (window.shop) return window.shop
  if (cachedBridge) return cachedBridge
  const standalone = new URLSearchParams(location.search).get('view') === 'stage'
  const channel = new BroadcastChannel('cyber-fish-preview-v1')
  let runtime: ReturnType<typeof createRuntime> | undefined
  let cached: AppState | undefined
  const listeners = new Set<(state: AppState) => void>()
  if (!standalone) {
    // The preview keeps the chat record in localStorage, capped; the desktop app keeps everything in SQLite.
    let archiveRows: ArchiveRow[] = []
    try { archiveRows = JSON.parse(localStorage.getItem('cyber-fish-archive') || '[]') } catch { /* Start with an empty record. */ }
    let archiveTimer: ReturnType<typeof setTimeout> | undefined
    const archive = createMemoryArchive(archiveRows, rows => { clearTimeout(archiveTimer); archiveTimer = setTimeout(() => { try { localStorage.setItem('cyber-fish-archive', JSON.stringify(rows)) } catch { /* Storage full: the session keeps its record in memory. */ } }, 500) }, 5000)
    runtime = createRuntime({ archive, store: {
      load() { try { return JSON.parse(localStorage.getItem('cyber-fish-demo') || 'null') } catch { return null } },
      save(state) { try { localStorage.setItem('cyber-fish-demo', JSON.stringify(state)) } catch { /* storage full, current session remains available */ } },
    } })
    cached = runtime.getState()
    runtime.subscribe(state => { cached = state; for (const fn of listeners) fn(state); channel.postMessage({ type: 'state', state }) })
  }
  channel.onmessage = async ({ data }) => {
    if (data.type === 'state' && standalone) { cached = data.state; for (const fn of listeners) fn(data.state) }
    if (data.type === 'request-state' && runtime) channel.postMessage({ type: 'state', state: runtime.getState() })
    if (data.type === 'command' && runtime) await runtime.command(data.command)
  }
  if (standalone) channel.postMessage({ type: 'request-state' })
  const bridge: ShopBridge = {
    async getState() {
      if (runtime) return runtime.getState()
      if (cached) return cached
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { listeners.delete(receive); reject(new Error('请先打开小店控制台，再打开舞台预览。')) }, 8000)
        const receive = (s: AppState) => { clearTimeout(timer); listeners.delete(receive); resolve(s) }
        listeners.add(receive)
      })
    },
    async command(command: Command) {
      if (command.type === 'bilibili-input-info') return { ok: true, data: { state: 'stopped', configured: false, received: 0, reconnects: 0, message: '浏览器仅供排练，B 站接入请使用桌面工作台。' } }
      if (command.type.startsWith('bilibili-input-')) return { ok: false, message: 'B 站账号配置和真实直播连接请在桌面应用中使用。' }
      if (command.type === 'save-key' || command.type === 'test-connection' || command.type === 'design-voice') return { ok: false, message: '请在桌面应用中配置真实服务，浏览器预览仅使用本地模拟。' }
      if (['open-capture'].includes(command.type)) { await bridge.openStage(); return {ok:true} }
      if (command.type === 'input-info') return {ok:true,data:{status:'stopped',endpoint:'',token:'',received:0,rejected:0,message:'浏览器仅供排练，真实直播连接请使用桌面应用。'}}
      if (command.type === 'qq-status') return {ok:true,data:{loggedIn:false,loginPending:false,message:'浏览器仅供排练，QQ 音乐搜索和扫码登录请在桌面应用中使用。'}}
      if (['qq-search','qq-login-start','qq-login-poll','qq-logout'].includes(command.type)) return {ok:false,message:'QQ 音乐连接请在桌面应用中使用；浏览器排练不会登录或请求真实曲库。'}
      if (['open-local-test','get-runtime-info','open-audio-setup','import-music','input-start','input-stop','input-test','input-rotate-token','input-copy'].includes(command.type)) return {ok:false,message:'此功能请在桌面应用中使用。'}
      if (command.type === 'set-config') { command.config.demo = true }
      if (runtime) return runtime.command(command)
      channel.postMessage({ type: 'command', command }); return { ok: true }
    },
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn) } },
    async openStage() { window.open(`${location.origin}${location.pathname}?view=stage`, 'cyber-fish-stage', 'width=540,height=960'); if (runtime) setTimeout(() => channel.postMessage({ type: 'state', state: runtime!.getState() }), 700) },
    async exportLogs() {
      const state = runtime?.getState() || cached
      const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), logs: state?.logs, history: state?.history, costs: state?.costs }, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = `小店日志-${new Date().toISOString().slice(0,10)}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
      return { ok: true, message: '日志已导出。' }
    },
  }
  cachedBridge = bridge
  if (import.meta.hot) import.meta.hot.dispose(() => { runtime?.dispose(); channel.close(); listeners.clear(); cachedBridge = undefined })
  return bridge
}
