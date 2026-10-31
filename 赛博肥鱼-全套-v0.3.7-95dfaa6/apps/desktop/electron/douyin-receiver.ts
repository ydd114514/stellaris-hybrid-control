import { createHash, randomBytes } from 'node:crypto'
import WebSocket from 'ws'
import type { LiveEvent } from '../../../packages/shared/src/index'
import { decodeDouyinFrame, heartbeatFrame, type DouyinFrameDiagnostics } from './douyin-protocol'

export interface DouyinSigner { sign(stub: string, signal: AbortSignal, sdkUrls?: readonly string[]): Promise<string>; dispose(): void }
export interface DouyinReceiverStatus {
  state: 'stopped' | 'connecting' | 'connected' | 'reconnecting' | 'ended' | 'error'
  room: string; message: string; received: number; reconnects: number
  lastFrameAt?: number; lastEventAt?: number; lastPongAt?: number
  roomStatus?: 'unknown' | 'offline' | 'live'
  diagnostics?: DouyinFrameDiagnostics
}
export interface DouyinReceiverOptions {
  onEvent(event: LiveEvent): unknown | Promise<unknown>; onStatus(info: DouyinReceiverStatus): void
  signer: DouyinSigner; fetch?: typeof fetch; now?: () => number
  socket?: (url: string, options: WebSocket.ClientOptions) => WebSocket
}
export const DOUYIN_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36'
export function parseDouyinRoom(value: string): string {
  const text = value.trim()
  const internal = /^(?:room_id[:=]|room[:=])(\d{3,20})$/i.exec(text)?.[1] || (/^\d{17,20}$/.test(text) ? text : undefined)
  if (internal) { if (BigInt(internal) <= 0xffffffffffffffffn && BigInt(internal) > 0n) return `room_id:${internal}`; throw new Error('内部 room_id 超出 uint64 范围。') }
  if (/^\d{3,16}$/.test(text)) return text
  let url: URL
  try { url = new URL(text) } catch { throw new Error('请填写公开抖音直播间地址或房间号。') }
  if (url.protocol !== 'https:' || url.hostname !== 'live.douyin.com' || url.username || url.password || url.port || url.hash || !/^\/\d{3,32}\/?$/.test(url.pathname)) throw new Error('只接受 https://live.douyin.com/房间号 的公开地址。')
  return url.pathname.replace(/\//g, '')
}
/** Room-page parsing only; no browser profile, account cookie, stream key or user filesystem access. */
export function parseDouyinRoomHtml(html: string, room: string): { roomId?: string; uniqueId?: string; status?: number; sdkUrls: string[] } {
  const source = html.replace(/\\"/g, '"').replace(/\\u0026/g, '&').replace(/\\\//g, '/')
  const marker = source.indexOf('"roomStore"'), webRid = source.indexOf(`"web_rid":"${room}"`)
  const region = marker >= 0 ? source.slice(marker, marker + 300000) : webRid >= 0 ? source.slice(Math.max(0, webRid - 100000), webRid + 200000) : ''
  const roomId = /"room":\{"id_str":"(\d{3,32})"/.exec(region)?.[1] || /"roomId":"(\d{3,32})","web_rid":"\d+"/.exec(region)?.[1]
  const uniqueId = /"user_unique_id":"(\d{3,32})"/.exec(source)?.[1]
  const status = /"room":\{[\s\S]{0,5000}?"status":([1-4])/.exec(region)?.[1]
  const sdkUrls = [...source.matchAll(/(?:https?:)?\/\/[^\s"'<>\\]{1,250}(?:webmssdk|mssdk)[^\s"'<>\\]{0,200}\.js(?:\?[^\s"'<>\\]*)?/gi)].map(match => match[0]!.startsWith('//') ? 'https:' + match[0] : match[0]!).slice(0, 8)
  return { roomId, uniqueId, ...(status ? { status: Number(status) } : {}), sdkUrls }
}
const MAX_HTTP = 4 * 1024 * 1024
async function body(response: Response): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0
  try { for (;;) { const item = await reader.read(); if (item.done) break; length += item.value.byteLength; if (length > MAX_HTTP) throw new Error('抖音房间响应超过大小限制。'); chunks.push(item.value) } }
  finally { await reader.cancel().catch(() => {}) }
  return Buffer.concat(chunks).toString('utf8')
}
export function createDouyinReceiver(options: DouyinReceiverOptions) {
  const fetcher = options.fetch || globalThis.fetch, now = options.now || Date.now
  const emptyDiagnostics = (): DouyinFrameDiagnostics => ({ methods: { chat: 0, enter: 0, follow: 0, like: 0, gift: 0, control: 0, other: 0 }, giftRejections: { identity: 0, details: 0, count: 0, ambiguousCombo: 0, nonComboFinal: 0, malformed: 0 } })
  let diagnostics = emptyDiagnostics()
  let status: DouyinReceiverStatus = { state: 'stopped', room: '', message: '真实抖音接收器尚未连接。', received: 0, reconnects: 0 }
  let generation = 0, controller: AbortController | undefined, ws: WebSocket | undefined, heartbeat: ReturnType<typeof setInterval> | undefined, reconnect: ReturnType<typeof setTimeout> | undefined
  let connectedAt = 0, pending = 0, delivery = Promise.resolve(), room = '', anonymousCookie = ''
  const seen = new Set<string>()
  const info = (): DouyinReceiverStatus => ({ ...status, diagnostics: { methods: { ...diagnostics.methods }, giftRejections: { ...diagnostics.giftRejections } } })
  function addDiagnostics(value: DouyinFrameDiagnostics | undefined) {
    if (!value) return
    for (const group of ['methods', 'giftRejections'] as const) {
      const target = diagnostics[group] as Record<string, number>, incoming = value[group] as Record<string, number>
      for (const key of Object.keys(target)) { const increment = incoming[key]; if (Number.isFinite(increment) && increment! > 0) target[key] = Math.min(Number.MAX_SAFE_INTEGER, target[key]! + Math.min(Number.MAX_SAFE_INTEGER, Math.floor(increment!))) }
    }
  }
  function update(patch: Partial<DouyinReceiverStatus>) { status = { ...status, ...patch }; try { options.onStatus(info()) } catch { /* Diagnostics cannot tear down a live transport. */ } }
  function clearSocket() { if (heartbeat) clearInterval(heartbeat); heartbeat = undefined; if (ws) { ws.removeAllListeners(); ws.terminate(); ws = undefined } }
  function stop() { generation++; controller?.abort(); controller = undefined; if (reconnect) clearTimeout(reconnect); reconnect = undefined; clearSocket(); anonymousCookie = ''; pending = 0; delivery = Promise.resolve(); seen.clear(); options.signer.dispose(); update({ state: 'stopped', message: '真实抖音接收器已停止。' }) }
  async function request(url: string, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted()
    const response = await fetcher(url, { signal, redirect: 'error', headers: { 'User-Agent': DOUYIN_USER_AGENT, Referer: 'https://live.douyin.com/', ...(anonymousCookie ? { Cookie: anonymousCookie } : {}) } })
    if (!response.ok) throw new Error(`抖音公开房间请求返回 HTTP ${response.status}。`)
    const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie().join('; ') : response.headers.get('set-cookie') || ''
    const ttwid = /(?:^|[;,]\s*)ttwid=([^;\s,]+)/.exec(cookies)?.[1]
    if (ttwid) anonymousCookie = `ttwid=${ttwid}`
    const result = await body(response); signal.throwIfAborted(); return result
  }
  function failed(run: number, message: string) {
    if (generation !== run || controller?.signal.aborted) return
    clearSocket()
    if (status.reconnects >= 3) { update({ state: 'error', message: `${message} 自动重连已用尽，请使用画面识别备用。` }); return }
    const count = status.reconnects + 1
    update({ state: 'reconnecting', reconnects: count, message: `${message} 正在有限重连；画面识别可继续工作。` })
    if (reconnect) clearTimeout(reconnect)
    reconnect = setTimeout(() => { reconnect = undefined; void connect(run) }, [2000, 5000, 10000][count - 1]); reconnect.unref?.()
  }
  async function connect(run: number) {
    const signal = controller!.signal
    const timeout = setTimeout(() => { if (generation === run && status.state !== 'connected') { controller?.abort(); clearSocket(); update({ state: 'error', message: '真实抖音连接准备超时，请使用画面识别备用。' }) } }, 30000); timeout.unref?.()
    try {
      const home = await request('https://live.douyin.com/', signal), internalId = room.startsWith('room_id:') ? room.slice(8) : undefined
      const html = internalId ? home : await request(`https://live.douyin.com/${room}`, signal), parsed = parseDouyinRoomHtml(html, room)
      let roomId = internalId || parsed.roomId, roomStatus = internalId ? undefined : parsed.status
      if (!roomId) {
        const params = new URLSearchParams({ aid: '6383', app_name: 'douyin_web', live_id: '1', device_platform: 'web', language: 'zh-CN', enter_from: 'web_live', cookie_enabled: 'true', web_rid: room })
        const raw = JSON.parse(await request(`https://live.douyin.com/webcast/room/web/enter/?${params}`, signal)) as { data?: { enter_room_id?: string; data?: { id_str?: string; status?: number }[] } }
        const candidate = raw.data?.enter_room_id || raw.data?.data?.[0]?.id_str
        if (typeof candidate === 'string' && /^\d{3,32}$/.test(candidate)) roomId = candidate
        roomStatus = raw.data?.data?.[0]?.status
      }
      if (!roomId) throw new Error('公开页面未提供可核验的房间标识，可能未开播或需要登录。')
      update({ roomStatus: roomStatus === 2 ? 'live' : roomStatus === 4 ? 'offline' : 'unknown' })
      if (roomStatus === 4) { clearTimeout(timeout); update({ state: 'ended', message: '公开房间资料显示已下播；没有伪造接通。' }); return }
      if (!anonymousCookie) throw new Error('未取得本轮匿名网页标识，不能建立真实弹幕连接。')
      const unique = parsed.uniqueId || (7300000000000000000n + BigInt('0x' + randomBytes(6).toString('hex'))).toString(), version = '1.0.15', timestamp = now()
      const stub = createHash('md5').update(`live_id=1,aid=6383,version_code=180800,webcast_sdk_version=${version},room_id=${roomId},sub_room_id=,sub_channel_id=,did_rule=3,user_unique_id=${unique},device_platform=web,device_type=,ac=,identity=audience`).digest('hex')
      const signature = await options.signer.sign(stub, signal, [...parsed.sdkUrls, ...parseDouyinRoomHtml(home, '').sdkUrls])
      if (!/^[A-Za-z0-9_+\/=.-]{1,512}$/.test(signature)) throw new Error('抖音匿名签名未能生成。')
      signal.throwIfAborted(); if (run !== generation) return
      const params = new URLSearchParams({ app_name: 'douyin_web', version_code: '180800', webcast_sdk_version: version, update_version_code: version, compress: 'gzip', device_platform: 'web', cookie_enabled: 'true', browser_language: 'zh-CN', browser_platform: 'Win32', browser_name: 'Mozilla', browser_version: DOUYIN_USER_AGENT, browser_online: 'true', tz_name: 'Asia/Shanghai', screen_width: '1920', screen_height: '1080', host: 'https://live.douyin.com', aid: '6383', live_id: '1', did_rule: '3', endpoint: 'live_pc', support_wrds: '1', user_unique_id: unique, im_path: '/webcast/im/fetch/', identity: 'audience', need_persist_msg_count: '15', room_id: roomId, heartbeatDuration: '0', cursor: `d-1_u-1_fh-${unique}_t-${timestamp}_r-1`, internal_ext: `internal_src:dim|wss_push_room_id:${roomId}|wss_push_did:${unique}|first_req_ms:${timestamp}|fetch_time:${timestamp}|seq:1|wss_info:0-${timestamp}-0-0`, signature })
      const socket = (options.socket || ((url, config) => new WebSocket(url, config)))(`wss://webcast100-ws-web-lq.douyin.com/webcast/im/push/v2/?${params}`, { headers: { 'User-Agent': DOUYIN_USER_AGENT, Origin: 'https://live.douyin.com', Cookie: anonymousCookie }, maxPayload: MAX_HTTP, handshakeTimeout: 10000, followRedirects: false, perMessageDeflate: false })
      ws = socket
      socket.on('open', () => {
        if (generation !== run || ws !== socket) return
        clearTimeout(timeout); connectedAt = now()
        update({ state: 'connected', message: internalId ? '内部 room_id 传输握手已建立，尚未核验开播或收到互动；匿名模式不保证全部礼物可见。' : '已建立抖音网页连接，正在等候真实互动；匿名模式不保证全部礼物可见。' })
        socket.send(heartbeatFrame()); socket.ping()
        heartbeat = setInterval(() => {
          if (generation !== run || ws !== socket || socket.readyState !== WebSocket.OPEN) return
          if (now() - Math.max(connectedAt, status.lastFrameAt || 0, status.lastPongAt || 0) >= 20000) { failed(run, '抖音连接未收到帧或心跳回应。'); return }
          socket.send(heartbeatFrame()); socket.ping()
        }, 5000); heartbeat.unref?.()
      })
      socket.on('pong', () => { if (generation === run && ws === socket) update({ lastPongAt: now() }) })
      socket.on('message', raw => {
        if (generation !== run || ws !== socket) return
        const data = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer)
        try {
          const decoded = decodeDouyinFrame(data, roomId!, now()); addDiagnostics(decoded.diagnostics); update({ lastFrameAt: now() })
          if (decoded.ack && socket.readyState === WebSocket.OPEN) socket.send(decoded.ack)
          if (decoded.ended) { clearSocket(); update({ state: 'ended', message: '抖音服务发送下播状态，后台接收已停止。' }); return }
          for (const event of decoded.events) {
            if (seen.has(event.id)) continue
            seen.add(event.id); while (seen.size > 10000) seen.delete(seen.values().next().value!)
            if (pending >= 256) { update({ message: '真实互动接收较密集，已丢弃超出本机有界队列的消息。' }); continue }
            pending++
            const work = async () => { try { if (generation !== run || controller?.signal.aborted) return; status.received++; update({ lastEventAt: now(), message: '已收到并解码真实抖音互动；匿名模式部分礼物可能不可见。' }); await options.onEvent(event) } catch { if (generation === run) update({ message: '一条真实互动未被工作台接受，请查看输入诊断。' }) } finally { if (generation === run) pending = Math.max(0, pending - 1) } }
            delivery = delivery.then(work, work)
          }
        } catch { update({ message: '收到的抖音消息帧无法安全解析，已跳过该帧。' }) }
      })
      socket.on('error', () => { clearTimeout(timeout); if (ws === socket) failed(run, '真实抖音网页连接发生错误。') })
      socket.on('close', () => { clearTimeout(timeout); if (ws === socket) failed(run, '真实抖音网页连接已断开。') })
    } catch (error) {
      clearTimeout(timeout)
      if (generation !== run || signal.aborted) return
      const message = error instanceof Error && /^(?:抖音|公开|未取得|未能)/.test(error.message) ? error.message : '真实抖音连接准备失败，可能遇到网络或网页验证。'
      failed(run, message)
    }
  }
  return {
    info, stop,
    async start(value: string): Promise<DouyinReceiverStatus> { const parsed = parseDouyinRoom(value); stop(); room = parsed; diagnostics = emptyDiagnostics(); controller = new AbortController(); const run = generation; status = { state: 'connecting', room, message: '正在请求公开抖音房间并准备匿名直连。', received: 0, reconnects: 0 }; update({}); await connect(run); return info() },
  }
}
