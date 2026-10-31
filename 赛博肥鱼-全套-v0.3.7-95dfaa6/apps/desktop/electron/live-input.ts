import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { WebSocket, WebSocketServer, type RawData } from 'ws'
import type { CommandResult, LiveEvent, LiveInputInfo } from '../../../packages/shared/src/index'
import { normalizeLivePayload, parseTransportJson, validateLocalUpstream, type InputFormat } from '../../../packages/inputs/src/normalize'

export interface LiveInputOptions {
  onEvent(event: LiveEvent): Promise<CommandResult> | CommandResult
  onStatus?(state: Omit<LiveInputInfo, 'token' | 'websocketEndpoint'>): void
  onHealth?(signal: { state: 'connected' | 'heartbeat' | 'disconnected'; heartbeatExpected?: boolean }): void
  now?: () => number
  /** Small values are useful in offline transport tests. Production defaults are bounded. */
  limits?: { perSecond?: number; burst?: number; pending?: number }
}
export interface LiveInputStart { port?: number; upstreamUrl?: string; upstreamFormat?: 'normalized' | 'douyin-barrage' }

export function createLiveInputBridge(options: LiveInputOptions) {
  const now = options.now ?? Date.now
  const limit = { perSecond: options.limits?.perSecond ?? 60, burst: options.limits?.burst ?? 120, pending: options.limits?.pending ?? 200 }
  let token = randomBytes(32).toString('base64url'), server: Server | undefined, wss: WebSocketServer | undefined, upstream: WebSocket | undefined
  let active = false, generation = 0, actualPort = 0, received = 0, rejected = 0, lastEventAt: number | undefined
  let status: LiveInputInfo['status'] = 'stopped', message = '尚未开启本机互动接收器。', upstreamUrl = '', upstreamFormat: InputFormat = 'normalized'
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined, reconnectAttempt = 0
  let tokens = limit.burst, replenishedAt = now(), pending = 0
  let delivery = Promise.resolve()
  const clients = new Set<WebSocket>()
  const heartbeatSockets = new Map<WebSocket, number>()
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined
  const health = (state: 'connected' | 'heartbeat' | 'disconnected', heartbeatExpected = true) => options.onHealth?.({ state, heartbeatExpected })
  function watchHeartbeat(socket: WebSocket, run: number) {
    heartbeatSockets.set(socket, now()); health('connected')
    socket.on('pong', () => { if (active && generation === run) { heartbeatSockets.set(socket, now()); health('heartbeat') } })
    socket.on('close', () => { heartbeatSockets.delete(socket); if (active && generation === run && ![...heartbeatSockets.keys()].some(item => item.readyState === WebSocket.OPEN)) health('disconnected') })
  }
  let lastStatusSignature = ''
  const info = (): LiveInputInfo => ({ status, endpoint: actualPort ? `http://127.0.0.1:${actualPort}/events` : '', websocketEndpoint: actualPort ? `ws://127.0.0.1:${actualPort}/events?token=${token}` : '', token, received, rejected, lastEventAt, upstreamUrl: upstreamUrl || undefined, message })
  const notify = () => {
    const { token: _secret, websocketEndpoint: _secretUrl, ...state } = info()
    // Counters are read through info(); avoid serializing the whole app on every burst/rejection.
    const signature = JSON.stringify([state.status, state.endpoint, state.upstreamUrl, state.message])
    if (signature === lastStatusSignature) return
    lastStatusSignature = signature
    options.onStatus?.(state)
  }
  const update = (next: LiveInputInfo['status'], detail: string) => { status = next; message = detail; notify() }
  const reject = () => { rejected++; notify() }
  const authorized = (req: IncomingMessage, query = false) => {
    let supplied = req.headers.authorization?.replace(/^Bearer\s+/i, '') || ''
    if (query && !supplied) { try { supplied = new URL(req.url || '', 'http://127.0.0.1').searchParams.get('token') || '' } catch { return false } }
    const candidate = Buffer.from(supplied), expected = Buffer.from(token)
    return candidate.length === expected.length && timingSafeEqual(candidate, expected)
  }
  const localHost = (req: IncomingMessage) => {
    const host = req.headers.host || ''
    return ['127.0.0.1', 'localhost', '[::1]'].some(name => host === name || host === `${name}:${actualPort}`)
  }
  const allowance = (count: number) => {
    const current = now()
    tokens = Math.min(limit.burst, tokens + Math.max(0, current - replenishedAt) / 1000 * limit.perSecond); replenishedAt = current
    if (tokens < count || pending + count > limit.pending) return false
    tokens -= count
    return true
  }
  async function deliver(payload: unknown, format: InputFormat): Promise<CommandResult> {
    let events: LiveEvent[]
    try { events = normalizeLivePayload(payload, format, now()) } catch (error) { reject(); return { ok: false, message: error instanceof Error ? error.message : '输入消息格式不正确。' } }
    if (!events.length) return { ok: true, message: '已忽略不参与互动的统计消息。' }
    if (!allowance(events.length)) { reject(); return { ok: false, message: '互动消息过于密集，或本机接收队列已满。' } }
    const currentGeneration = generation
    pending += events.length
    let accepted = 0
    const work = async () => {
      for (const event of events) {
        try {
          if (!active || generation !== currentGeneration) continue
          const result = await options.onEvent(event)
          if (result.ok) { received++; accepted++; lastEventAt = now() }
          else rejected++
        } catch { rejected++ }
        finally { pending-- }
      }
      notify()
    }
    const current = delivery.then(work, work)
    delivery = current.catch(() => {})
    await current
    return { ok: accepted === events.length, message: accepted ? `已接收 ${accepted} 条互动。` : '事件未送入小店，请检查营业与输入设置。', data: { accepted } }
  }
  const respond = (res: ServerResponse, code: number, data: unknown) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    res.end(JSON.stringify(data))
  }
  async function handle(req: IncomingMessage, res: ServerResponse, run: number) {
    if (!active || generation !== run) { respond(res, 503, { ok: false, message: '该输入连接已关闭，请使用当前接入地址。' }); return }
    if (!localHost(req)) { reject(); respond(res, 403, { ok: false, message: '只接受本机地址。' }); return }
    const path = new URL(req.url || '/', 'http://127.0.0.1').pathname
    if (!['/events', '/health', '/test'].includes(path)) { respond(res, 404, { ok: false, message: '接收路径不存在。' }); return }
    if (!authorized(req)) { reject(); respond(res, 401, { ok: false, message: '接入令牌无效，请从小店重新复制。' }); return }
    if (req.method === 'GET' && path === '/health') { health('heartbeat'); respond(res, 200, { ok: true, received, rejected }); return }
    if (req.method !== 'POST' || !['/events', '/test'].includes(path)) { respond(res, 405, { ok: false, message: '请使用 POST /events 发送 JSON。' }); return }
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) { reject(); respond(res, 415, { ok: false, message: '输入需要 application/json。' }); return }
    if (Number(req.headers['content-length'] || 0) > 65536) { reject(); respond(res, 413, { ok: false, message: '单次输入超过 64 KiB。' }); req.resume(); return }
    let size = 0, aborted = false
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > 65536) { if (!aborted) { aborted = true; reject(); respond(res, 413, { ok: false, message: '单次输入超过 64 KiB。' }) }; chunks.length = 0 }
      else if (!aborted) chunks.push(chunk)
    })
    req.on('error', () => { if (!aborted) { aborted = true; reject(); if (!res.headersSent) respond(res, 400, { ok: false, message: '接收输入时连接中断。' }) } })
    req.on('end', () => {
      if (aborted) return
      if (!active || generation !== run) { respond(res, 503, { ok: false, message: '该输入连接已关闭，请使用当前接入地址。' }); return }
      if (!authorized(req)) { reject(); respond(res, 401, { ok: false, message: '接入令牌已更新，请重新复制。' }); return }
      let payload: unknown
      try { payload = parseTransportJson(Buffer.concat(chunks).toString('utf8')) } catch (error) { reject(); respond(res, 400, { ok: false, message: error instanceof Error ? error.message : '无法解析输入。' }); return }
      if (path === '/test') {
        try {
          const parsed = normalizeLivePayload(payload, 'auto', now())
          respond(res, parsed.length ? 200 : 422, { ok: parsed.length > 0, message: parsed.length ? '本机认证与消息解析测试通过，未触发模型或配音。' : '没有可测试的互动事件。' })
        } catch (error) { respond(res, 422, { ok: false, message: error instanceof Error ? error.message : '消息解析失败。' }) }
        return
      }
      void deliver(payload, 'auto').then(result => { if (!res.destroyed) respond(res, result.ok ? 202 : 422, result) })
    })
  }
  function connectUpstream(run: number) {
    if (!active || !upstreamUrl || generation !== run) return
    update('connecting', '正在连接本机弹幕工具；HTTP 接收器仍可使用。')
    let socket: WebSocket
    try { socket = new WebSocket(upstreamUrl, { maxPayload: 65536, handshakeTimeout: 5000, perMessageDeflate: false, followRedirects: false }) }
    catch { update('error', '本机弹幕工具地址无法连接，请检查工具是否启动。'); return }
    upstream = socket
    socket.on('open', () => { if (generation !== run) { socket.close(); return }; watchHeartbeat(socket, run); reconnectAttempt = 0; update('connected', '已连接本机弹幕工具，等候真实互动。') })
    socket.on('message', (data: RawData, binary: boolean) => {
      if (generation !== run || !active) return
      if (binary) { reject(); return }
      void deliver(data.toString(), upstreamFormat)
    })
    socket.on('error', () => { if (generation === run && active) update('error', '连接本机弹幕工具失败；正在等待重连，HTTP 接收器可继续使用。') })
    socket.on('close', () => {
      if (generation !== run || !active) return
      if (upstream === socket) upstream = undefined
      update('connecting', '本机弹幕工具连接已断开，正在自动重连。')
      const delay = Math.min(30000, 1000 * 2 ** Math.min(5, reconnectAttempt++))
      reconnectTimer = setTimeout(() => connectUpstream(run), delay); reconnectTimer.unref?.()
    })
  }
  async function stop() {
    const wasActive = active
    active = false; generation++
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    heartbeatSockets.clear(); if (wasActive) health('disconnected')
    if (reconnectTimer) clearTimeout(reconnectTimer)
    upstream?.terminate(); upstream = undefined
    for (const socket of clients) socket.terminate()
    clients.clear()
    const closingWs = wss; wss = undefined
    closingWs?.close()
    const closingServer = server; server = undefined
    if (closingServer) await new Promise<void>(resolve => { closingServer.close(() => resolve()); closingServer.closeAllConnections() })
    actualPort = 0; update('stopped', '本机互动接收器已关闭。')
  }
  async function start(config: LiveInputStart = {}): Promise<LiveInputInfo> {
    const checkedUrl = validateLocalUpstream(config.upstreamUrl || '')
    if (config.upstreamFormat && !['normalized', 'douyin-barrage'].includes(config.upstreamFormat)) throw new Error('不支持这种上游消息格式。')
    await stop()
    const requested = typeof config.port === 'number' && Number.isInteger(config.port) && config.port >= 1024 && config.port <= 65535 ? config.port : config.port === 0 ? 0 : 17831
    upstreamUrl = checkedUrl; upstreamFormat = config.upstreamFormat || 'normalized'
    const run = generation
    const opened = createServer((req, res) => { void handle(req, res, run).catch(() => { reject(); if (!res.headersSent) respond(res, 500, { ok: false, message: '本机互动接收暂时失败。' }) }) })
    opened.requestTimeout = 5000; opened.headersTimeout = 5000; opened.keepAliveTimeout = 1000; opened.maxHeadersCount = 32; opened.maxConnections = 16
    const bind = (port: number) => new Promise<void>((resolve, rejectListen) => {
      const onError = (error: NodeJS.ErrnoException) => { opened.off('listening', onListen); rejectListen(error) }
      const onListen = () => { opened.off('error', onError); resolve() }
      opened.once('error', onError); opened.once('listening', onListen); opened.listen(port, '127.0.0.1')
    })
    try { await bind(requested) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE' && requested) await bind(0)
      else { opened.close(); throw new Error('本机互动端口无法启动，请换一个端口重试。') }
    }
    server = opened; const address = opened.address(); actualPort = address && typeof address === 'object' ? address.port : 0
    active = true
    heartbeatTimer = setInterval(() => { for (const [socket, at] of heartbeatSockets) { if (socket.readyState !== WebSocket.OPEN) continue; if (now() - at > 20000) { socket.terminate(); continue }; try { socket.ping() } catch { socket.terminate() } } }, 5000)
    heartbeatTimer.unref?.()
    tokens = limit.burst; replenishedAt = now()
    const sockets = wss = new WebSocketServer({ noServer: true, maxPayload: 65536, perMessageDeflate: false, clientTracking: true })
    opened.on('upgrade', (req, socket, head) => {
      let path = ''
      try { path = new URL(req.url || '/', 'http://127.0.0.1').pathname } catch { /* Invalid URL is rejected. */ }
      if (!active || !localHost(req) || path !== '/events' || !authorized(req, true) || clients.size >= 4) { reject(); socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); socket.destroy(); return }
      sockets.handleUpgrade(req, socket, head, client => sockets.emit('connection', client, req))
    })
    sockets.on('connection', socket => {
      const connectionToken = token
      watchHeartbeat(socket, run)
      clients.add(socket); update('connected', '本机转发工具已接入，等候真实互动。')
      socket.on('error', () => { /* Socket failures must not terminate the application. */ })
      socket.on('message', (data, binary) => {
        if (!active || generation !== run || connectionToken !== token) return
        if (binary) { reject(); socket.close(1003, 'JSON text required'); return }
        void deliver(data.toString(), 'auto').then(result => {
          if (socket.readyState !== WebSocket.OPEN) return
          if (socket.bufferedAmount > 256 * 1024) { reject(); socket.terminate(); return }
          socket.send(JSON.stringify(result), error => { if (error) socket.terminate() })
        })
      })
      socket.on('close', () => { clients.delete(socket); if (active && generation === run && clients.size === 0 && upstream?.readyState !== WebSocket.OPEN) update(upstreamUrl ? 'connecting' : 'listening', '本机接收器已就绪，等候转发工具接入。') })
    })
    update('listening', requested && actualPort !== requested ? '原端口被占用，已使用新的本机端口；请重新复制接入地址。' : '本机互动接收器已就绪；尚未连接抖音数据来源。')
    if (upstreamUrl) connectUpstream(run)
    return info()
  }
  function rotateToken() {
    token = randomBytes(32).toString('base64url')
    for (const socket of clients) socket.close(1008, 'Token rotated')
    notify(); return info()
  }
  async function test(): Promise<CommandResult> {
    if (!active || !actualPort) return { ok: false, message: '请先开启本机互动接收器。' }
    const event: LiveEvent = { id: `bridge-test:${randomBytes(8).toString('hex')}`, kind: 'chat', user: { id: 'bridge-test-viewer', name: '接入测试客人' }, text: '这是本地接入测试，坐会儿吧。', at: now() }
    // Exercise loopback HTTP, authentication and parsing without spending money or injecting a fake live viewer.
    try {
      const response = await fetch(`http://127.0.0.1:${actualPort}/test`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(event), signal: AbortSignal.timeout(5000) })
      return await response.json() as CommandResult
    } catch { return { ok: false, message: '本机接入测试未完成，请重新连接后重试。' } }
  }
  return { start, stop, info, rotateToken, test }
}
