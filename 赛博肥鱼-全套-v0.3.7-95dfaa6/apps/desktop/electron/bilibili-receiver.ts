import WebSocket, { type RawData } from 'ws'
import type { LiveEvent } from '../../../packages/shared/src/index'
import { BILIBILI_MAX_FRAME, decodeBilibiliFrame, encodeBilibiliPacket, normalizeBilibiliMessage, signBilibiliRequest } from './bilibili-protocol'

export interface BilibiliCredentials { accessKeyId: string; accessKeySecret: string; appId: string; identityCode: string }
export interface BilibiliReceiverStatus {
  state: 'stopped' | 'connecting' | 'connected' | 'reconnecting' | 'ended' | 'error'
  message: string; received: number; reconnects: number; roomId?: string
  lastFrameAt?: number; lastEventAt?: number; lastHeartbeatAt?: number; lastAppHeartbeatAt?: number
}
export interface BilibiliReceiverOptions {
  credentials(): BilibiliCredentials | undefined
  onEvent(event: LiveEvent): unknown | Promise<unknown>
  onStatus(status: BilibiliReceiverStatus): void
  fetch?: typeof fetch; now?: () => number
  socket?: (url: string, options: WebSocket.ClientOptions) => WebSocket
}
type Timer = ReturnType<typeof setTimeout>
interface Session {
  credentials: BilibiliCredentials; controller: AbortController; gameId?: string; authBody?: string; urls: string[]; socket?: WebSocket
  authTimer?: Timer; heartbeat?: Timer; appHeartbeat?: Timer; reconnect?: Timer
  authenticated: boolean; authenticatedAt: number; appFailures: number; appPending: boolean
  pending: number; delivery: Promise<void>; seen: Set<string>; closing?: Promise<void>
}
const record = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const decimalId = (value: unknown) => typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n ? value : typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? String(value) : ''
const safeString = (value: unknown, maximum: number) => typeof value === 'string' && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f]/.test(value)
class ApiError extends Error { constructor(readonly code: number) { super('B站官方接口未接受请求。') } }

export function validateBilibiliCredentials(value: BilibiliCredentials | undefined): BilibiliCredentials {
  if (!value || !safeString(value.accessKeyId, 256) || !safeString(value.accessKeySecret, 512) || !safeString(value.identityCode, 256) || !decimalId(value.appId)) throw new Error('请先配置B站官方 Access Key、项目 ID 和主播身份码。')
  return { accessKeyId: value.accessKeyId.trim(), accessKeySecret: value.accessKeySecret.trim(), appId: decimalId(value.appId), identityCode: value.identityCode.trim() }
}
export function validateBilibiliSocketUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('B站返回的长连接地址无效。')
  const url = new URL(value)
  if (url.protocol !== 'wss:' || !url.hostname.endsWith('.chat.bilibili.com') || url.username || url.password || url.hash || url.port && url.port !== '443' || url.pathname !== '/sub') throw new Error('B站返回的长连接地址不在官方服务器范围内。')
  return url.toString()
}

export function createBilibiliReceiver(options: BilibiliReceiverOptions) {
  const fetcher = options.fetch || globalThis.fetch, now = options.now || Date.now
  let session: Session | undefined, generation = 0
  let status: BilibiliReceiverStatus = { state: 'stopped', message: 'B站官方互动接收器尚未连接。', received: 0, reconnects: 0 }
  const cleanups = new Set<Promise<void>>()
  const info = (): BilibiliReceiverStatus => ({ ...status })
  const active = (current: Session) => session === current && !current.controller.signal.aborted
  function update(patch: Partial<BilibiliReceiverStatus>) { status = { ...status, ...patch }; try { options.onStatus(info()) } catch { /* Presentation errors cannot break transport cleanup. */ } }
  function clearSocket(current: Session) {
    clearTimeout(current.authTimer); clearInterval(current.heartbeat); current.authTimer = undefined; current.heartbeat = undefined; current.authenticated = false
    const socket = current.socket; current.socket = undefined
    if (socket) { socket.removeAllListeners(); socket.on('error', () => {}); socket.terminate() }
  }
  function detach(current: Session) {
    current.controller.abort(); clearSocket(current); clearInterval(current.appHeartbeat); clearTimeout(current.reconnect)
    current.appHeartbeat = undefined; current.reconnect = undefined; current.pending = 0; current.seen.clear()
  }
  async function request(current: Session, path: '/start' | '/heartbeat' | '/end', body: string, independent = false): Promise<Record<string, unknown>> {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000); timer.unref?.()
    try {
      const signal = independent ? controller.signal : AbortSignal.any([controller.signal, current.controller.signal])
      signal.throwIfAborted()
      const response = await fetcher(`https://live-open.biliapi.com/v2/app${path}`, { method: 'POST', body, signal, redirect: 'error', headers: signBilibiliRequest(body, current.credentials.accessKeyId, current.credentials.accessKeySecret, now()) })
      if (!response.ok) throw new Error('B站官方接口网络请求未完成。')
      if (Number(response.headers.get('content-length') || 0) > 256 * 1024) throw new Error('B站官方接口响应过大。')
      const reader = response.body?.getReader(), chunks: Uint8Array[] = []; let length = 0
      try {
        if (reader) for (;;) { const part = await reader.read(); if (part.done) break; length += part.value.length; if (length > 256 * 1024) throw new Error('B站官方接口响应过大。'); chunks.push(part.value) }
      } finally { await reader?.cancel().catch(() => {}) }
      const result = record(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      if (!result || typeof result.code !== 'number' || !Number.isSafeInteger(result.code)) throw new Error('B站官方接口返回格式无效。')
      // Never forward the server's free-form message: it may contain supplied credentials.
      if (result.code !== 0) throw new ApiError(result.code)
      return record(result.data) || {}
    } finally { clearTimeout(timer) }
  }
  function end(current: Session): Promise<void> {
    if (!current.gameId) return Promise.resolve()
    if (current.closing) return current.closing
    const body = `{"app_id":${current.credentials.appId},"game_id":${JSON.stringify(current.gameId)}}`
    const closing = request(current, '/end', body, true).then(() => {}, () => {})
    current.closing = closing; cleanups.add(closing); void closing.finally(() => cleanups.delete(closing))
    return closing
  }
  function finish(current: Session, state: 'ended' | 'error', message: string) {
    if (!active(current)) return
    session = undefined; generation++; detach(current); update({ state, message }); void end(current)
  }
  function failed(current: Session, message: string) {
    if (!active(current)) return
    clearSocket(current)
    if (status.reconnects >= 5) { finish(current, 'error', 'B站官方长连接重试已用尽，请检查网络后重新连接。'); return }
    const count = status.reconnects + 1
    update({ state: 'reconnecting', reconnects: count, message })
    clearTimeout(current.reconnect)
    current.reconnect = setTimeout(() => { current.reconnect = undefined; connect(current) }, [1000, 2000, 5000, 10000, 20000][count - 1]); current.reconnect.unref?.()
  }
  function send(current: Session, socket: WebSocket, packet: Buffer) {
    if (!active(current) || current.socket !== socket || socket.readyState !== WebSocket.OPEN) return
    if (socket.bufferedAmount > 256 * 1024) { failed(current, 'B站长连接发送缓冲已满，正在重连。'); return }
    try { socket.send(packet, error => { if (error && current.socket === socket) failed(current, 'B站长连接发送失败，正在重连。') }) }
    catch { failed(current, 'B站长连接发送失败，正在重连。') }
  }
  function deliver(current: Session, event: LiveEvent) {
    if (current.seen.has(event.id) || current.pending >= 256) return
    current.seen.add(event.id); while (current.seen.size > 10000) current.seen.delete(current.seen.values().next().value!)
    current.pending++
    const work = async () => {
      try {
        if (!active(current)) return
        update({ received: Math.min(Number.MAX_SAFE_INTEGER, status.received + 1), lastEventAt: now(), message: '已接收B站官方真实互动。' })
        await options.onEvent(event)
      } catch { if (active(current)) update({ message: '一条B站互动未被工作台接受，请检查输入诊断。' }) }
      finally { if (active(current)) current.pending = Math.max(0, current.pending - 1) }
    }
    current.delivery = current.delivery.then(work, work)
  }
  function connect(current: Session) {
    if (!active(current)) return
    let socket: WebSocket
    try {
      const url = current.urls[status.reconnects % current.urls.length]!
      socket = (options.socket || ((address, config) => new WebSocket(address, config)))(url, { maxPayload: BILIBILI_MAX_FRAME, handshakeTimeout: 10000, followRedirects: false, perMessageDeflate: false })
    } catch { failed(current, 'B站官方长连接创建失败，正在重连。'); return }
    current.socket = socket
    current.authTimer = setTimeout(() => { if (current.socket === socket && active(current)) failed(current, 'B站长连接鉴权超时，正在重连。') }, 10000); current.authTimer.unref?.()
    socket.on('open', () => { if (active(current) && current.socket === socket) send(current, socket, encodeBilibiliPacket(7, current.authBody!)) })
    socket.on('message', (raw: RawData) => {
      if (!active(current) || current.socket !== socket) return
      try {
        const frame = decodeBilibiliFrame(Array.isArray(raw) ? Buffer.concat(raw) : Buffer.isBuffer(raw) ? raw : new Uint8Array(raw))
        update({ lastFrameAt: now() })
        if (frame.authCode !== undefined) {
          if (frame.authCode !== 0) { finish(current, 'error', 'B站长连接鉴权被拒绝，请检查项目授权后重新连接。'); return }
          if (!current.authenticated) {
            current.authenticated = true; current.authenticatedAt = now(); clearTimeout(current.authTimer); current.authTimer = undefined
            update({ state: 'connected', message: 'B站官方长连接鉴权成功，等候真实互动。' })
            send(current, socket, encodeBilibiliPacket(2))
            current.heartbeat = setInterval(() => {
              if (!active(current) || current.socket !== socket) return
              if (now() - Math.max(current.authenticatedAt, status.lastHeartbeatAt || 0) >= 45000) { failed(current, 'B站服务端未回应心跳，正在重连。'); return }
              send(current, socket, encodeBilibiliPacket(2))
            }, 20000); current.heartbeat.unref?.()
          }
        }
        if (!current.authenticated) return
        if (frame.heartbeat) update({ lastHeartbeatAt: now() })
        for (const message of frame.messages) {
          const data = record(record(message)?.data), command = record(message)?.cmd
          if (command === 'LIVE_OPEN_PLATFORM_INTERACTION_END' && data?.game_id === current.gameId) { finish(current, 'ended', 'B站官方场次已失效，请重新连接。'); return }
          if (command === 'LIVE_OPEN_PLATFORM_LIVE_END' && decimalId(data?.room_id) === status.roomId) { finish(current, 'ended', 'B站房间已下播，互动接收已停止。'); return }
          for (const event of normalizeBilibiliMessage(message, status.roomId!, now())) deliver(current, event)
        }
      } catch { update({ message: '收到的B站消息帧无法安全解析，已跳过。' }) }
    })
    socket.on('error', () => { if (current.socket === socket) failed(current, 'B站官方长连接发生错误，正在重连。') })
    socket.on('close', () => { if (current.socket === socket) failed(current, 'B站官方长连接已断开，正在重连。') })
  }
  async function appHeartbeat(current: Session) {
    if (!active(current) || current.appPending) return
    current.appPending = true
    try {
      await request(current, '/heartbeat', JSON.stringify({ game_id: current.gameId }))
      if (!active(current)) return
      current.appFailures = 0; update({ lastAppHeartbeatAt: now() })
    } catch (error) {
      if (!active(current)) return
      if (error instanceof ApiError && [7000, 7003].includes(error.code)) finish(current, 'ended', 'B站官方场次心跳已过期，请重新连接。')
      else if (++current.appFailures >= 2) finish(current, 'error', 'B站官方场次心跳连续失败，互动接收已停止。')
      else update({ message: 'B站官方场次心跳暂未成功，将在下一周期重试。' })
    } finally { current.appPending = false }
  }
  function stop(): Promise<void> {
    const current = session, run = ++generation; session = undefined
    if (current) { detach(current); void end(current) }
    update({ state: 'stopped', message: 'B站官方互动接收器已停止。' })
    return Promise.all([...cleanups]).then(() => { if (run === generation && !session) update({ state: 'stopped', message: 'B站官方互动接收器已停止。' }) })
  }
  async function start(): Promise<BilibiliReceiverStatus> {
    const previous = session; session = undefined; const run = ++generation
    if (previous) { detach(previous); void end(previous) }
    let credentials: BilibiliCredentials
    try { credentials = validateBilibiliCredentials(options.credentials()) }
    catch { status = { state: 'error', message: '请先配置B站官方 Access Key、项目 ID 和主播身份码。', received: 0, reconnects: 0 }; update({}); return info() }
    const current: Session = { credentials, controller: new AbortController(), urls: [], authenticated: false, authenticatedAt: 0, appFailures: 0, appPending: false, pending: 0, delivery: Promise.resolve(), seen: new Set() }
    session = current; status = { state: 'connecting', message: '正在开启B站官方授权互动场次。', received: 0, reconnects: 0 }; update({})
    try {
      await Promise.all([...cleanups]); if (!active(current) || run !== generation) return info()
      const data = await request(current, '/start', `{"code":${JSON.stringify(credentials.identityCode)},"app_id":${credentials.appId}}`)
      const game = record(data.game_info), websocket = record(data.websocket_info), anchor = record(data.anchor_info)
      if (safeString(game?.game_id, 256)) current.gameId = game!.game_id as string
      // A cancelled /start can still finish server-side. Close its late-created scene without reconnecting.
      if (!active(current) || run !== generation) { await end(current); return info() }
      const roomId = decimalId(anchor?.room_id)
      if (!current.gameId || !roomId || !safeString(websocket?.auth_body, 16384) || !Array.isArray(websocket?.wss_link) || !websocket.wss_link.length || websocket.wss_link.length > 8) throw new Error('B站官方启动响应缺少必要字段。')
      current.authBody = websocket.auth_body as string; current.urls = websocket.wss_link.map(validateBilibiliSocketUrl)
      update({ roomId, message: 'B站授权场次已开启，正在验证官方消息长连接。' })
      current.appHeartbeat = setInterval(() => { void appHeartbeat(current) }, 20000); current.appHeartbeat.unref?.()
      connect(current)
    } catch (error) {
      if (active(current)) {
        const detail = error instanceof ApiError ? `B站官方接口拒绝连接（错误码 ${error.code}），请检查应用权限、密钥和主播身份码。` : 'B站官方连接准备失败，请检查网络与开放平台配置。'
        finish(current, 'error', detail)
      }
    }
    return info()
  }
  return { info, start, stop }
}
