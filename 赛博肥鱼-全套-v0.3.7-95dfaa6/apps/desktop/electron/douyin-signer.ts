import { app, BrowserWindow, session } from 'electron'
import { randomUUID } from 'node:crypto'
import type { DouyinSigner } from './douyin-receiver'

/** Optional, immutable fallback only. SDK is fetched to RAM, never redistributed as a repository asset.
 * Repository license is MIT; the bundled platform SDK's separate upstream copyright is not independently verified.
 * Prefer the official SDK URLs discovered in the public Douyin page. */
export const PINNED_DOUYIN_SDK = 'https://raw.githubusercontent.com/qinant/dycast-desktop/43bf564c2d0c540ec912648deecc4946af5e87d1/public/mssdk.js'
export interface DouyinSignerOptions { sdkSource?: string; allowPinnedFallback?: boolean; fetch?: typeof fetch; userAgent?: string }
function allowedSdk(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash && !url.port && url.href.length < 2000 && /mssdk/i.test(url.pathname) && ['douyin.com', 'douyinstatic.com', 'bytedcdn.com', 'bytescm.com', 'bytegoofy.com', 'bytegecko.com'].some(host => url.hostname === host || url.hostname.endsWith('.' + host))
  } catch { return false }
}
async function fetchSource(url: string, fetcher: typeof fetch, signal: AbortSignal) {
  const response = await fetcher(url, { signal, redirect: 'error' })
  if (!response.ok) throw new Error(`签名脚本请求返回 HTTP ${response.status}。`)
  if (!response.body) throw new Error('签名脚本响应为空。')
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0
  try { for (;;) { const item = await reader.read(); if (item.done) break; size += item.value.byteLength; if (size > 1024 * 1024) throw new Error('签名脚本超过大小限制。'); chunks.push(item.value) } }
  finally { await reader.cancel().catch(() => {}) }
  return Buffer.concat(chunks).toString('utf8')
}
/** Dedicated in-memory, hidden, sandboxed renderer. No Node, IPC bridge, user cookies or outbound requests. */
export function createDouyinSigner(options: DouyinSignerOptions = {}): DouyinSigner {
  let window: BrowserWindow | undefined, prepared: Promise<BrowserWindow> | undefined, generation = 0
  const fetcher = options.fetch || globalThis.fetch
  function dispose() { generation++; window?.destroy(); window = undefined; prepared = undefined }
  async function prepare(signal: AbortSignal, supplied: readonly string[]) {
    if (prepared) return prepared
    const run = generation
    prepared = (async () => {
      let source = options.sdkSource
      if (!source) {
        const candidates = [...new Set(supplied.filter(allowedSdk))].slice(0, 4)
        if (options.allowPinnedFallback) candidates.push(PINNED_DOUYIN_SDK)
        for (const url of candidates) { signal.throwIfAborted(); try { source = await fetchSource(url, fetcher, signal); if (source) break } catch { if (signal.aborted) throw new DOMException('已取消', 'AbortError') } }
      }
      if (!source || Buffer.byteLength(source) > 1024 * 1024) throw new Error('未找到可用的公开签名脚本，请使用画面识别备用。')
      signal.throwIfAborted(); await app.whenReady(); if (run !== generation) throw new DOMException('已取消', 'AbortError')
      const isolated = session.fromPartition(`cyberfish-douyin-sign-${randomUUID()}`, { cache: false })
      isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false)); isolated.setPermissionCheckHandler(() => false)
      isolated.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*', 'file://*/*'] }, (_details, callback) => callback({ cancel: true }))
      const created = new BrowserWindow({ show: false, width: 1, height: 1, skipTaskbar: true, focusable: false, webPreferences: { session: isolated, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false } })
      window = created; if (options.userAgent) created.webContents.setUserAgent(options.userAgent)
      created.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); created.webContents.on('will-navigate', event => event.preventDefault())
      const bootstrap = `Object.defineProperty(document,'cookie',{configurable:true,get:()=>'',set:()=>{}});for(const key of ['localStorage','sessionStorage']){const values=new Map();Object.defineProperty(window,key,{configurable:true,value:{getItem:k=>values.get(String(k))??null,setItem:(k,v)=>values.set(String(k),String(v)),removeItem:k=>values.delete(String(k)),clear:()=>values.clear(),key:i=>[...values.keys()][i]??null,get length(){return values.size}}})}`
      const html = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; img-src 'none'; style-src 'none'; frame-src 'none'; worker-src 'none'"><script>${bootstrap};${source.replace(/<\/script/gi, '<\\/script')}</script>`
      await created.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'))
      if (signal.aborted || run !== generation) { created.destroy(); throw new DOMException('已取消', 'AbortError') }
      const ready = await created.webContents.executeJavaScript('typeof window.byted_acrawler?.frontierSign === "function"')
      if (!ready) { created.destroy(); throw new Error('公开脚本未提供可用的抖音签名函数。') }
      return created
    })().catch(error => { if (run === generation) { prepared = undefined; window?.destroy(); window = undefined }; throw error })
    return prepared
  }
  return {
    dispose,
    async sign(stub, signal, sdkUrls = []) {
      if (!/^[a-f0-9]{32}$/i.test(stub)) throw new Error('签名输入不是有效摘要。')
      signal.throwIfAborted()
      let timer: ReturnType<typeof setTimeout> | undefined
      const onAbort = () => dispose(); signal.addEventListener('abort', onAbort, { once: true })
      try {
        return await Promise.race([
          (async () => { const target = await prepare(signal, sdkUrls); signal.throwIfAborted(); const result = await target.webContents.executeJavaScript(`String(window.byted_acrawler.frontierSign({'X-MS-STUB':${JSON.stringify(stub)}})?.['X-Bogus'] || '')`); signal.throwIfAborted(); if (typeof result !== 'string' || !result) throw new Error('抖音签名函数返回为空。'); return result })(),
          new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { dispose(); reject(new Error('抖音隔离签名超时。')) }, 10000); timer.unref?.() }),
        ])
      } finally { if (timer) clearTimeout(timer); signal.removeEventListener('abort', onAbort) }
    },
  }
}
