import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { parseScreenCandidates, validNormalizedRect, type LiveScreenCandidate, type NormalizedRect, type OCRObservation } from './live-screen-parser'
export type { LiveScreenCandidate, NormalizedRect } from './live-screen-parser'

export interface LiveScreenWindow { id: string; name: string }
export interface LiveScreenSelection { windowId: string; commentRoi?: NormalizedRect; giftRoi?: NormalizedRect }
export interface LiveScreenStatus { state: 'idle' | 'starting' | 'reading' | 'disconnected' | 'permission-needed' | 'unavailable'; message: string; windowId?: string; lastFrameAt?: number; lastCandidateAt?: number; frames: number; candidates: number; errorCount: number }
export interface LiveScreenPreview { images: { region: 'comment' | 'gift'; dataUrl: string; roi: NormalizedRect }[] }
interface NativeResult { version: number; observations: OCRObservation[]; images?: LiveScreenPreview['images']; error?: string }
interface NativeRequest { windowId: number; regions: { region: 'comment' | 'gift'; roi: NormalizedRect }[]; preview?: boolean; warmup?: boolean }
interface Options {
  onCandidates: (rows: LiveScreenCandidate[]) => void; onStatus?: (status: LiveScreenStatus) => void
  nativePath?: string; platform?: string; intervalMs?: number; timeoutMs?: number; now?: () => number
  permission?: () => string | Promise<string>; listSources?: () => Promise<LiveScreenWindow[]>
  recognize?: (request: NativeRequest, signal: AbortSignal) => Promise<NativeResult>
}
export const DEFAULT_SCREEN_ROIS = { commentRoi: { x: .81, y: .48, width: .175, height: .44 }, giftRoi: { x: .81, y: .34, width: .175, height: .13 } } satisfies Record<string, NormalizedRect>
const allowedName = (name: string) => /抖音直播(?:伴侣|助手)/u.test(name) || process.platform === 'win32' && /^(?:直播伴侣|直播助手)(?:\s.*)?$/u.test(name)
const windowNumber = (id: string) => { const match = /^window:(\d{1,12}):\d+$/u.exec(id); const value = Number(match?.[1]); return Number.isSafeInteger(value) && value > 0 && value <= 0xffffffff ? value : undefined }
function nativePath() { const file = process.platform === 'win32' ? 'live-screen-ocr.ps1' : 'live-screen-ocr'; const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath; const packed = resources && join(resources, 'app.asar.unpacked', 'dist', 'electron', 'native', file); return packed && existsSync(packed) ? packed : join(process.cwd(), '.local', 'native', file) }
function nativeOCR(path: string, request: NativeRequest, signal: AbortSignal): Promise<NativeResult> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('已停止画面读取。', 'AbortError')); return }
    // Windows PowerShell 5.1 supplies the built-in .NET/WinRT bridge used by OCR.
    const windows = process.platform === 'win32'
    const child = spawn(windows ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : path, windows ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path] : [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }), chunks: Buffer[] = []
    let size = 0, done = false
    const finish = (error?: Error, value?: NativeResult) => { if (done) return; done = true; signal.removeEventListener('abort', abort); if (error) { child.kill('SIGKILL'); reject(error) } else resolve(value!) }
    const abort = () => finish(new DOMException('已停止画面读取。', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
    child.stdout.on('data', chunk => { size += chunk.length; if (size > (request.preview ? 3 * 1024 * 1024 : 256 * 1024)) finish(new Error('识别结果过大。')); else chunks.push(Buffer.from(chunk)) })
    child.stderr.resume() // Native diagnostics are not copied to application logs.
    child.on('error', () => finish(new Error('本机识别程序不可用。')))
    child.stdin.on('error', () => { /* Process failure is handled by close/error. */ })
    child.on('close', () => { if (done) return; try { const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as NativeResult; if (body.version !== 1 || !Array.isArray(body.observations)) throw new Error(); finish(undefined, body) } catch { finish(new Error('本机画面识别未完成。')) } })
    child.stdin.end(JSON.stringify(request))
  })
}
/** Captures one selected Douyin window locally. Never requests a desktop/audio source. */
export function createLiveScreenInput(options: Options) {
  const now = options.now ?? Date.now, platform = options.platform ?? process.platform, sessionId = randomUUID()
  const supported = platform === 'darwin' || platform === 'win32'
  const visible = new Map<string, { key: string; y: number; frame: number; count?: number; signature: string; streak: number; emitted: string; at: number }>()
  let rowSequence = 0
  let state: LiveScreenStatus = { state: 'idle', message: '尚未读取直播助手画面。', frames: 0, candidates: 0, errorCount: 0 }
  let selected: LiveScreenSelection | undefined, timer: ReturnType<typeof setTimeout> | undefined, controller: AbortController | undefined, generation = 0, running = false, disposed = false, busy = false, failures = 0
  let activeRead: Promise<LiveScreenPreview | undefined> | undefined
  let bindingId: number | undefined, boundMainTitle: string | undefined
  const report = (patch: Partial<LiveScreenStatus>) => { state = { ...state, ...patch }; try { options.onStatus?.({ ...state }) } catch { /* Status listeners cannot interrupt the live show. */ } }
  const permission = options.permission ?? (async () => platform === 'win32' ? 'granted' : (await import('electron')).systemPreferences.getMediaAccessStatus('screen'))
  const sources = options.listSources ?? (async () => (await (await import('electron')).desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false })).map(source => ({ id: source.id, name: source.name })))
  const recognize = options.recognize ?? ((request: NativeRequest, signal: AbortSignal) => nativeOCR(options.nativePath ?? nativePath(), request, signal))
  async function listWindows() { if (!supported) return []; try { if (await permission() !== 'granted') { report({ state: 'permission-needed', message: '请手动在系统设置的“隐私与安全性→屏幕与系统音频录制”允许赛博肥鱼；授权前不读取窗口列表或画面。' }); return [] }; return (await sources()).filter(source => source && windowNumber(source.id) !== undefined && allowedName(source.name)).slice(0, 30).map(source => ({ id: source.id, name: source.name.slice(0, 120) })) } catch { report({ state: 'disconnected', message: '暂时无法列出直播助手窗口，请检查录屏权限及窗口是否打开。' }); return [] } }
  function selection(value: LiveScreenSelection): LiveScreenSelection {
    if (!value || windowNumber(value.windowId) === undefined) throw new Error('请选择抖音直播伴侣或直播助手窗口。')
    const commentRoi = value.commentRoi ?? DEFAULT_SCREEN_ROIS.commentRoi, giftRoi = value.giftRoi ?? DEFAULT_SCREEN_ROIS.giftRoi
    if (!validNormalizedRect(commentRoi) || !validNormalizedRect(giftRoi)) throw new Error('读取区域需在窗口内，宽高至少为窗口的百分之一。')
    return { windowId: value.windowId, commentRoi: { ...commentRoi }, giftRoi: { ...giftRoi } }
  }
  function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => { const abort = () => { signal.removeEventListener('abort', abort); reject(new DOMException('画面读取已取消。', 'AbortError')) }; if (signal.aborted) { abort(); return }; signal.addEventListener('abort', abort, { once: true }); promise.then(value => { signal.removeEventListener('abort', abort); resolve(value) }, error => { signal.removeEventListener('abort', abort); reject(error) }) })
  }
  async function performRead(value: LiveScreenSelection, preview = false): Promise<LiveScreenPreview | undefined> {
    if (busy) throw new Error('正在读取画面，请稍后再试预览。')
    busy = true; const token = generation, abort = controller = new AbortController()
    const timeout = setTimeout(() => abort.abort(), Math.max(1000, Math.min(15000, options.timeoutMs ?? (platform === 'win32' ? 15000 : 7000))))
    try {
      const access = await abortable(Promise.resolve(permission()), abort.signal)
      if (access !== 'granted') { report({ state: 'permission-needed', message: '需要你手动在系统设置的“隐私与安全性→屏幕与系统音频录制”允许赛博肥鱼读取屏幕；不会自动更改授权。' }); return }
      if (abort.signal.aborted || token !== generation) return
      const windows = await abortable(listWindows(), abort.signal)
      // Electron's trailing display token can change when a window moves screens.
      // ScreenCaptureKit identifies that same window by its CGWindowID alone.
      let target = windows.find(window => windowNumber(window.id) === windowNumber(value.windowId))
      // Reattach only after this reader has successfully captured that exact
      // main-window title. Never guess on a stale first start, a popup, or two
      // same-name candidates. Native SCK checks the owning bundle before capture.
      if (!target && boundMainTitle) {
        const replacements = windows.filter(window => window.name.trim() === boundMainTitle)
        if (replacements.length === 1) target = replacements[0]
      }
      if (!target) { failures++; report({ state: 'disconnected', errorCount: state.errorCount + 1, message: '选定的直播助手窗口已关闭或不可见，正在等待原窗口恢复；直播画面和音乐继续。' }); return }
      const output = await abortable(recognize({ windowId: windowNumber(target.id)!, regions: [{ region: 'comment', roi: value.commentRoi! }, { region: 'gift', roi: value.giftRoi! }], ...(preview ? { preview: true } : {}) }, abort.signal), abort.signal)
      if (abort.signal.aborted || token !== generation || disposed) return
      if (output.error) {
        report({ state: output.error === 'permission' ? 'permission-needed' : 'disconnected', errorCount: state.errorCount + 1, message: output.error === 'permission' ? '本机录屏权限未允许，请手动授权后再读取。' : output.error === 'blank-frame' ? '选定区域几乎全白、全黑或透明，尚未取得有效画面，已退避等待；音乐和直播继续。' : output.error === 'ocr-language' ? 'Windows 中文 OCR 语言包不可用，请在系统语言选项中安装简体中文的光学字符识别组件。' : output.error === 'window-missing' ? '选定直播助手窗口已消失，正在退避等待；音乐和直播继续。' : '直播助手画面暂时无法读取，已退避等待；音乐和直播继续。' }); failures++; return
      }
      failures = 0
      if (preview) return { images: (output.images ?? []).filter(image => ['comment', 'gift'].includes(image.region) && validNormalizedRect(image.roi) && typeof image.dataUrl === 'string' && image.dataUrl.length <= 1500000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+=*$/u.test(image.dataUrl)).slice(0, 2) }
      if (['抖音直播伴侣', '抖音直播助手', '直播伴侣', '直播助手'].includes(target.name.trim())) boundMainTitle = target.name.trim()
      if (selected === value && target.id !== value.windowId) selected = { ...value, windowId: target.id }
      const frame = state.frames + 1, used = new Set<string>(), rows: LiveScreenCandidate[] = []
      for (const item of parseScreenCandidates(output.observations)) {
        const y = item.bounds?.y ?? 0, key = item.fingerprint, signature = `${key}:${item.count ?? ''}`
        const matching = [...visible].filter(([id, row]) => !used.has(id) && row.key === key && frame - row.frame <= 3 && Math.abs(y - row.y) <= .25 && !(item.kind === 'gift' && item.count !== undefined && row.count !== undefined && item.count < row.count)).sort((a, b) => Math.abs(a[1].y - y) - Math.abs(b[1].y - y))[0]
        const fingerprint = matching?.[0] ?? createHash('sha256').update(`${sessionId}:${++rowSequence}:${key}`).digest('hex')
        used.add(fingerprint)
        const prior = matching?.[1], streak = prior && prior.frame === frame - 1 && prior.signature === signature && now() - prior.at <= 4000 ? Math.min(1000, prior.streak + 1) : 1
        let emitted = prior?.emitted ?? ''
        if (streak >= (item.kind === 'gift' ? 3 : 2) && emitted !== signature) { rows.push({ ...item, fingerprint, confirmedFrames: streak }); emitted = signature }
        visible.set(fingerprint, { key, y, frame, count: item.count, signature, streak, emitted, at: now() })
      }
      for (const [id, row] of visible) if (frame - row.frame >= 3) visible.delete(id)
      report({ state: 'reading', windowId: target.id, message: '正在本机识别选定窗口；画面候选无法核验账号、礼物价格或实际收入。', frames: state.frames + 1, candidates: state.candidates + rows.length, lastFrameAt: now(), ...(rows.length ? { lastCandidateAt: now() } : {}) })
      if (rows.length) { try { options.onCandidates(rows) } catch { report({ errorCount: state.errorCount + 1, message: '画面已读取，候选消息处理失败；直播继续。' }) } }
    } catch { if (token === generation && !disposed) { failures++; report({ state: 'disconnected', errorCount: state.errorCount + 1, message: '直播助手画面识别超时或暂不可用，正在退避重试；不会停止直播或音乐。' }) } }
    finally { clearTimeout(timeout); if (controller === abort) controller = undefined; busy = false }
  }
  function read(value: LiveScreenSelection, preview = false) { if (busy) return Promise.reject(new Error('正在读取画面，请稍后再试预览。')); const task = performRead(value, preview); activeRead = task; void task.then(() => { if (activeRead === task) activeRead = undefined }, () => { if (activeRead === task) activeRead = undefined }); return task }
  function schedule() { if (!running || disposed) return; const ticket = generation; timer = setTimeout(async () => { if (!running || !selected || disposed || ticket !== generation) return; if (!busy) await read(selected); if (ticket === generation) schedule() }, failures ? Math.min(15000, 2000 * 2 ** Math.min(failures, 3)) : state.state === 'permission-needed' ? 15000 : Math.max(1000, Math.min(2000, options.intervalMs ?? 1500))); timer.unref?.() }
  function stop() { running = false; generation++; if (timer) clearTimeout(timer); timer = undefined; controller?.abort(); report({ state: 'idle', message: '已停止读取直播助手画面；直播画面和音乐继续。' }) }
  return {
    listWindows,
    async warmup(): Promise<{ ready: boolean; message: string }> {
      if (running || busy || disposed) return { ready: false, message: '当前正在读取画面，暂不进行预热。' }
      if (!supported) return { ready: false, message: '本机文字识别需要 Windows 10/11 或 macOS。' }
      const ticket = generation, abort = controller = new AbortController(); busy = true
      report({ state: 'starting', message: '本机文字识别正在用中性假图预热，不读取真实窗口；后台事件通道继续。' })
      const timeout = setTimeout(() => abort.abort(), 30000)
      const work = (async () => {
        try { const result = await abortable(recognize({ windowId: 0, warmup: true, regions: [{ region: 'comment', roi: DEFAULT_SCREEN_ROIS.commentRoi }, { region: 'gift', roi: DEFAULT_SCREEN_ROIS.giftRoi }] }, abort.signal), abort.signal); if (ticket !== generation || disposed || abort.signal.aborted || result.error) return { ready: false, message: '本机文字识别尚未预热完成，后台事件通道继续。' }; return { ready: true, message: '本机文字识别已预热；未读取任何真实窗口。' } }
        catch { return { ready: false, message: '本机文字识别预热超时或不可用，后台事件通道继续。' } }
        finally { clearTimeout(timeout); if (controller === abort) controller = undefined; busy = false }
      })()
      const pending = work.then(() => undefined); activeRead = pending; void pending.finally(() => { if (activeRead === pending) activeRead = undefined })
      const result = await work
      if (ticket === generation && !disposed) report({ state: result.ready ? 'idle' : 'unavailable', message: result.message })
      return result
    },
    async start(value: LiveScreenSelection) { if (disposed) throw new Error('画面读取器已经关闭。'); const target = selection(value); stop(); const ticket = generation; if (activeRead) await activeRead; if (ticket !== generation || disposed) return; if (windowNumber(target.windowId) !== bindingId) { bindingId = windowNumber(target.windowId); boundMainTitle = undefined }; selected = target; if (!supported) { report({ state: 'unavailable', message: '本机画面识别需要 Windows 10/11 或 macOS。' }); return }; running = true; report({ state: 'starting', windowId: selected.windowId, message: '正在检查指定直播助手窗口和本机读取权限。' }); await read(selected); if (ticket === generation) schedule() },
    stop,
    async preview(value?: LiveScreenSelection): Promise<LiveScreenPreview> { if (!supported || disposed) throw new Error('当前无法预览本机直播助手画面。'); const target = value ? selection(value) : selected; if (!target) throw new Error('请先选择直播助手窗口和读取区域。'); return await read(target, true) ?? { images: [] } },
    status: () => ({ ...state }),
    dispose() { stop(); disposed = true; visible.clear() },
  }
}
