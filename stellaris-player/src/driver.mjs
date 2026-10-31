import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
const bridgePath = fileURLToPath(new URL('../native/windows_bridge.py', import.meta.url))

const interrupted = () => new DOMException('群星玩家已停止。', 'AbortError')
const delay = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(interrupted())
  const timer = setTimeout(done, ms)
  function done() { signal?.removeEventListener('abort', cancel); resolve() }
  function cancel() { clearTimeout(timer); signal?.removeEventListener('abort', cancel); reject(interrupted()) }
  signal?.addEventListener('abort', cancel, { once: true })
})

/** One bounded local command, no shell interpolation and no account material. */
export function callWindowsBridge(payload, { pythonPath = 'python', timeoutMs = 8000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonPath, ['-X', 'utf8', bridgePath], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    const chunks = []; let bytes = 0, settled = false
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value) }
    const timer = setTimeout(() => { child.kill(); finish(new Error('游戏本地输入桥超时，已停止本次操作。')) }, timeoutMs)
    child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > 32 * 1024 * 1024) { child.kill(); finish(new Error('游戏画面超过本机读取上限。')) } else chunks.push(chunk) })
    // Native failures can contain environment paths. Only its structured Chinese
    // message is surfaced; arbitrary stderr is never copied to a live overlay.
    child.stderr.resume()
    child.on('error', () => finish(new Error('无法启动 Python 本地桥，请运行 doctor 检查 Python 路径。')))
    child.on('close', () => {
      if (settled) return
      try {
        const result = JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/u, ''))
        if (!result || typeof result !== 'object') throw new Error()
        if (result.ok === false) finish(new Error(typeof result.message === 'string' ? result.message : '群星窗口读取或输入未完成。'))
        else finish(undefined, result)
      } catch (error) { finish(error instanceof Error && error.message !== '' ? error : new Error('游戏输入桥没有返回有效结果。')) }
    })
    child.stdin.on('error', () => {})
    child.stdin.end(JSON.stringify(payload))
  })
}

/** Model-facing driver: only the bound foreground Stellaris window can act. */
export function createWindowsDriver(options = {}) {
  const invoke = options.invoke || (payload => callWindowsBridge(payload, options))
  const now = options.now || Date.now
  let latest, lastDimensions, stopped = false, epoch = 0, sequence = 0, paused = options.assumePaused === true ? true : options.assumePaused === false ? false : 'unknown', inFlight = false
  let boundWindow, boundWindowId=options.windowId, focusAttempted = false, lastAction
  let pendingExecution, stopping, pauseReceipts = 0
  const localStop = new AbortController()
  const common = () => ({ ...(options.gamePath ? { gamePath: options.gamePath } : {}), ...(boundWindow ? { expectedWindow: boundWindow } : {}), ...(boundWindowId ? { windowId: boundWindowId } : {}) })
  async function observe() {
    if (stopped) throw interrupted()
    const run = epoch
    if (options.focusOnStart && !focusAttempted) {
      focusAttempted = true
      const focused = await invoke({ command: 'focus', ...(options.gamePath ? { gamePath: options.gamePath } : {}) })
      if (stopped || run !== epoch) throw interrupted()
      const identity = focused.windowId || focused.window?.windowId
      if (typeof identity !== 'string' || !/^\d+:\d+:\d+$/.test(identity)) throw new Error('无法确认已切入指定群星窗口。')
      boundWindowId = identity; boundWindow = focused.window
    }
    const image = await invoke({ command: 'observe', ...common(), ...(options.previewWidth?{previewWidth:options.previewWidth}:{}) })
    if (stopped || run !== epoch) throw interrupted()
    if (typeof image.imageBase64 !== 'string' || !image.imageBase64 || image.mimeType !== 'image/png' || !Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) || image.width < 320 || image.height < 240) throw new Error('未取得有效群星画面，已停止操作。')
    const identity = image.windowId || image.window?.windowId
    if (typeof identity !== 'string' || !/^\d+:\d+:\d+$/.test(identity) || boundWindowId && identity !== boundWindowId) throw new Error('群星窗口身份已改变；本轮不会切到另一局或新窗口。')
    boundWindowId = identity; boundWindow = image.window
    lastDimensions = { expectedWidth: image.width, expectedHeight: image.height }
    const imageHash = createHash('sha256').update(image.imageBase64).digest('hex')
    latest = { ...image, id: `obs-${++sequence}-${imageHash.slice(0, 24)}`, imageHash, at: now(), paused, pauseEvidence: '启动前由用户暂停；后续按已发送的继续/暂停指令跟踪，仍须看图核验。' }
    if(typeof options.readHud==='function'){
      const hud=await options.readHud(latest,{lastAction})
      if(stopped||run!==epoch)throw interrupted()
      if(hud&&typeof hud.paused==='boolean')paused=hud.paused
      latest={...latest,paused,...(hud?{hud}:{})}
    }
    if (typeof options.observeContext === 'function') {
      try { const context = await options.observeContext(latest); if (context) latest.gameContext = context }
      catch { latest.gameContextWarning = '观测 Mod 暂未提供可核验摘要，本轮依据截图。' }
    }
    if (stopped || run !== epoch) throw interrupted()
    return { ...latest }
  }
  function requireObservation(observationId) {
    if (!latest || observationId !== latest.id || now() - latest.at > (options.maxObservationAgeMs || 45000)) throw new Error('游戏观察已过期，请重新看图后再操作。')
    return { expectedWidth: latest.width, expectedHeight: latest.height }
  }
  async function native(action, signal, dimensions) {
    if (stopped || signal?.aborted) throw interrupted()
    const result = await invoke({ command: 'execute', ...common(), ...dimensions, ...(options.parkCursor?{parkCursor:true}:{}), action })
    if (stopped || signal?.aborted) throw interrupted()
    lastAction={...action,at:now()}
    return result
  }
  async function togglePause(nextPaused, dimensions) {
    // SPACE is private to pause management. Never cancel/kill this command in
    // flight: its receipt must update state before stop decides on cleanup.
    try {
      const result = await invoke({ command: 'execute', ...common(), ...dimensions, action: { type: 'key', key: 'SPACE' } })
      if (result?.ok === false) throw new Error()
      paused = nextPaused
      if (nextPaused) pauseReceipts++
      return result
    } catch {
      paused = 'unknown'; stopped = true
      throw new Error(nextPaused ? '未能确认重新暂停。请手动暂停群星，程序已停止继续操作。' : '未能确认继续指令的结果。请手动检查并暂停群星，再重新启动玩家。')
    }
  }
  async function performExecute(action, { observationId, signal } = {}) {
    if (stopped || signal?.aborted) throw interrupted()
    if (inFlight) throw new Error('上一条群星操作尚未结束。')
    const dimensions = requireObservation(observationId)
    if (!action || typeof action !== 'object') throw new Error('游戏操作格式不正确。')
    if (action.type === 'key' && /^(?:space|spacebar|空格)$/i.test(String(action.key || '').trim())) throw new Error('推进游戏请使用 advance 或 setRunning，不能直接切换暂停。')
    const run = epoch
    inFlight = true
    try {
      if (action.type === 'advance') {
        if (paused !== true) throw new Error('无法确认游戏已暂停，请手动暂停后重新启动玩家。')
        if (!Number.isFinite(action.seconds) || action.seconds < 1 || action.seconds > 15) throw new Error('每次推进需在 1–15 秒之间。')
        let resumed = false, pauseError
        try {
          if (stopped || signal?.aborted) throw interrupted()
          await togglePause(false, dimensions)
          resumed = true
          await delay(action.seconds * 1000, signal)
        } finally {
          if (resumed) {
            // Even after stop, a final target-checked SPACE restores pause.
            // A lost foreground window is refused by the native layer.
            try { await togglePause(true, dimensions) }
            catch (error) { pauseError = error }
          }
          // A cancellation must not mask failure to restore pause.
          if (pauseError) throw pauseError
        }
        if (stopped || run !== epoch || signal?.aborted) throw interrupted()
        return { ok: true, message: `已推进约 ${action.seconds} 秒现实时间并发送暂停；游戏日期与暂停状态需从新画面核验。`, pauseSent: true }
      }
      const result = await native(action, signal, dimensions)
      if (stopped || run !== epoch) throw interrupted()
      // A successful SendInput receipt is deliberately not a game success claim.
      return { ...result, message: '输入已发送；请依据新画面检查游戏是否接受以及实际结果。' }
    } finally { inFlight = false; latest = undefined }
  }
  async function performSetRunning(running, { observationId, signal } = {}) {
    if (stopped || signal?.aborted) throw interrupted()
    if (inFlight) throw new Error('上一条群星操作尚未结束。')
    if (typeof running !== 'boolean') throw new Error('运行状态必须是布尔值。')
    const dimensions = requireObservation(observationId)
    if (paused !== true && paused !== false) throw new Error('无法确认游戏暂停状态，请手动暂停后重新启动玩家。')
    const nextPaused = !running, run = epoch
    inFlight = true
    try {
      const changed = paused !== nextPaused
      if (changed) await togglePause(nextPaused, dimensions)
      // A late successful resume still needs a matching pause when cancelled.
      // stop waits for this complete operation before releasing inputs.
      if (stopped || signal?.aborted || run !== epoch) {
        if (paused === false) await togglePause(true, dimensions)
        throw interrupted()
      }
      return { ok: true, running, paused, changed, pauseSent: changed && nextPaused, message: changed ? (running ? '已发送继续指令；可继续观察和操作，游戏状态仍须看图核验。' : '已发送暂停指令；游戏状态仍须看图核验。') : '运行状态与已跟踪状态一致，没有重复切换暂停。' }
    } finally { inFlight = false; latest = undefined }
  }
  function startExecution(operation, { observationId, signal } = {}) {
    if (pendingExecution) return Promise.reject(new Error('上一条群星操作尚未结束。'))
    const combined = signal ? AbortSignal.any([signal, localStop.signal]) : localStop.signal
    // Register the promise before invoking native callbacks. A synchronous stop
    // from inside an injected/native callback must not miss this pending work.
    const work = Promise.resolve().then(() => operation({ observationId, signal: combined }))
    const tracked = work.then(value => { if (pendingExecution === tracked) pendingExecution = undefined; return value }, error => { if (pendingExecution === tracked) pendingExecution = undefined; throw error })
    pendingExecution = tracked
    void tracked.catch(() => {})
    return tracked
  }
  function execute(action, options) { return startExecution(options => performExecute(action, options), options) }
  function setRunning(running, options) { return startExecution(options => performSetRunning(running, options), options) }
  function stop() {
    if (stopping) return stopping
    stopped = true; epoch++
    const active = pendingExecution, pauseCountAtStop = pauseReceipts
    localStop.abort()
    stopping = Promise.resolve().then(async () => {
      // Keep the parent alive until an in-progress advance has attempted pause.
      // Killing a child in the middle of a held key is deliberately avoided.
      if (active) await active.catch(() => {})
      let pauseSent = pauseReceipts > pauseCountAtStop, released = false, error
      if(paused===false&&typeof options.readHud==='function'&&boundWindowId&&lastDimensions){
        try{
          const image=await invoke({command:'observe',...common()})
          if((image.windowId||image.window?.windowId)!==boundWindowId||image.width!==lastDimensions.expectedWidth||image.height!==lastDimensions.expectedHeight)throw new Error()
          const hud=await options.readHud(image)
          paused=typeof hud?.paused==='boolean'?hud.paused:'unknown'
        }catch{paused='unknown'}
      }
      if (paused === false) {
        if (!boundWindowId || !lastDimensions) {
          paused = 'unknown'; error = '缺少已绑定窗口或客户区尺寸，未盲发暂停。请手动暂停群星。'
        } else {
          try { await togglePause(true, lastDimensions); pauseSent = true }
          catch (failure) { error = failure.message }
        }
      }
      try { const result = await invoke({ command: 'release', ...(options.gamePath ? { gamePath: options.gamePath } : {}) }); released = result?.ok !== false }
      catch { /* Still report the pause outcome if releasing inputs failed. */ }
      if (!released && !error) error = '未确认按键释放，请手动检查群星。'
      if (paused === 'unknown' && !error) error = '暂停切换结果不明，未重试空格。请手动检查并暂停群星。'
      return { ok: !error, paused, pauseSent, released, ...(error ? { error } : {}), message: error || '玩家已停止；暂停状态按已完成的指令跟踪，仍须看图核验。' }
    })
    return stopping
  }
  return { observe, execute, setRunning, stop, info: () => ({ stopped, paused, hasObservation: !!latest, windowId:boundWindowId }) }
}
