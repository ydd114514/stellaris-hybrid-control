import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import { createDouyinReceiver, parseDouyinRoom, parseDouyinRoomHtml, type DouyinReceiverOptions } from '../apps/desktop/electron/douyin-receiver'
import * as protocol from '../apps/desktop/electron/douyin-protocol'

class Socket extends EventEmitter {
  readyState = 0; replyPong = true
  send = vi.fn(); ping = vi.fn(() => { if (this.replyPong) this.emit('pong') })
  terminate = vi.fn(() => { this.readyState = 3 })
  open() { this.readyState = 1; this.emit('open') }
}
const receivers: ReturnType<typeof createDouyinReceiver>[] = []
afterEach(() => { for (const receiver of receivers.splice(0)) receiver.stop(); vi.restoreAllMocks(); vi.useRealTimers() })
function make(html = '<html></html>', extra: Partial<DouyinReceiverOptions> = {}) {
  const socket = new Socket(), signer = { sign: vi.fn(async () => 'offline-test-signature'), dispose: vi.fn() }, onStatus = vi.fn(), onEvent = vi.fn()
  const fetch = vi.fn(async () => new Response(html, { headers: { 'Set-Cookie': 'ttwid=offline-test-anonymous; Path=/' } }))
  const receiver = createDouyinReceiver({ fetch, signer, onStatus, onEvent, socket: () => socket as unknown as WebSocket, ...extra }); receivers.push(receiver)
  return { receiver, socket, signer, fetch, onStatus, onEvent }
}
describe('真实抖音接收器的离线传输边界', () => {
  it('内部uint64与公开web_rid明确区分，不损失19位整数，不接任意URL', () => {
    expect(parseDouyinRoom('7700000000000000001')).toBe('room_id:7700000000000000001')
    expect(parseDouyinRoom('room_id:18446744073709551615')).toBe('room_id:18446744073709551615')
    expect(parseDouyinRoom('123456789')).toBe('123456789')
    expect(parseDouyinRoom('https://live.douyin.com/7700000000000000001')).toBe('7700000000000000001')
    for (const value of ['18446744073709551616', 'https://evil.test/123', 'https://live.douyin.com.evil.test/123', 'http://live.douyin.com/123', 'https://user:pass@live.douyin.com/123', 'file:///tmp/123']) expect(() => parseDouyinRoom(value)).toThrow()
  })
  it('只从明确roomStore区域解析房间，不把推荐房间冒充目标', () => {
    expect(parseDouyinRoomHtml('推荐房间{"room":{"id_str":"99999"}}', '123')).not.toHaveProperty('roomId', '99999')
    expect(parseDouyinRoomHtml('"roomStore":{"roomInfo":{"room":{"id_str":"1234567891234567890","status":4}}},"user_unique_id":"2222222222222222222"', '123')).toMatchObject({ roomId: '1234567891234567890', uniqueId: '2222222222222222222', status: 4 })
  })
  it('内部模式不把room_id送作web_rid，安静但有服务端pong保持健康，自己发hb不计互动', async () => {
    vi.useFakeTimers(); vi.setSystemTime(100000)
    const { receiver, fetch, socket, onEvent } = make()
    expect((await receiver.start('7700000000000000001')).state).toBe('connecting')
    expect(fetch).toHaveBeenCalledOnce(); expect(fetch.mock.calls[0]![0]).toBe('https://live.douyin.com/')
    socket.open(); await vi.advanceTimersByTimeAsync(120000)
    expect(receiver.info()).toMatchObject({ state: 'connected', roomStatus: 'unknown', received: 0, lastPongAt: 220000 })
    expect(receiver.info().lastEventAt).toBeUndefined(); expect(onEvent).not.toHaveBeenCalled()
    expect(socket.send).toHaveBeenCalled(); expect(socket.terminate).not.toHaveBeenCalled()
  })
  it('没有服务端回应20秒后重连，不拿自己发出的心跳当接通证据', async () => {
    vi.useFakeTimers(); vi.setSystemTime(100000)
    const { receiver, socket } = make(); socket.replyPong = false
    await receiver.start('7700000000000000001'); socket.open()
    await vi.advanceTimersByTimeAsync(19999); expect(receiver.info().state).toBe('connected')
    await vi.advanceTimersByTimeAsync(1); expect(receiver.info()).toMatchObject({ state: 'reconnecting', reconnects: 1, received: 0 })
    expect(socket.terminate).toHaveBeenCalledOnce()
  })
  it('停止会取消准备中请求，迟到HTTP结果不能签名或打开socket', async () => {
    let resolve!: (response: Response) => void
    const delayed = vi.fn(() => new Promise<Response>(yes => { resolve = yes }))
    const { receiver, signer, socket } = make('', { fetch: delayed })
    const pending = receiver.start('7700000000000000001'); await Promise.resolve(); receiver.stop()
    resolve(new Response('<html/>', { headers: { 'Set-Cookie': 'ttwid=offline-only' } })); await pending
    expect(receiver.info().state).toBe('stopped'); expect(signer.sign).not.toHaveBeenCalled(); expect(socket.ping).not.toHaveBeenCalled()
  })
  it('明确下播不伪造接通，准备超时回调不会晚到覆盖下播状态', async () => {
    vi.useFakeTimers(); vi.setSystemTime(100000)
    const { receiver, signer } = make('"roomStore":{"roomInfo":{"room":{"id_str":"999999999","status":4}}}')
    expect((await receiver.start('123456')).state).toBe('ended')
    await vi.advanceTimersByTimeAsync(40000)
    expect(receiver.info().state).toBe('ended'); expect(signer.sign).not.toHaveBeenCalled()
  })
  it('socket收到但被拒绝的gift保留固定脱敏计数，深拷贝、饱和及重开清零', async () => {
    const { receiver, socket, onStatus, onEvent } = make()
    await receiver.start('7700000000000000001'); socket.open()
    const encode = protocol.encodeProto
    const gift = encode([[1, encode([[2, 22n]])], [2, 33n], [5, 1], [7, encode([[1, 44n], [3, '私人昵称不入诊断']])], [15, encode([[16, '私人礼物名']])]])
    const frame = Buffer.from(encode([[7, 'msg'], [8, encode([[1, encode([[1, 'WebcastGiftMessage'], [2, gift], [3, 22n]])]])]]))
    socket.emit('message', frame)
    expect(receiver.info()).toMatchObject({ received: 0, diagnostics: { methods: { gift: 1 }, giftRejections: { ambiguousCombo: 1 } } })
    expect(onEvent).not.toHaveBeenCalled()
    const snapshot = receiver.info(); snapshot.diagnostics!.methods.gift = 999
    const callbackSnapshot = onStatus.mock.calls.at(-1)![0]; callbackSnapshot.diagnostics!.giftRejections.ambiguousCombo = 999
    expect(receiver.info().diagnostics).toMatchObject({ methods: { gift: 1 }, giftRejections: { ambiguousCombo: 1 } })
    expect(JSON.stringify(receiver.info().diagnostics)).not.toMatch(/私人|signature|cookie|raw|payload|ttwid|22|33|44/)
    const saturated = structuredClone(receiver.info().diagnostics!)
    saturated.methods.gift = Number.MAX_SAFE_INTEGER; saturated.giftRejections.ambiguousCombo = Number.MAX_SAFE_INTEGER
    vi.spyOn(protocol, 'decodeDouyinFrame').mockReturnValueOnce({ events: [], ended: false, rawMessages: 0, diagnostics: saturated })
    socket.emit('message', Buffer.alloc(0)); socket.emit('message', frame)
    expect(receiver.info().diagnostics!.methods.gift).toBe(Number.MAX_SAFE_INTEGER)
    expect(receiver.info().diagnostics!.giftRejections.ambiguousCombo).toBe(Number.MAX_SAFE_INTEGER)
    const previous = receiver.info()
    await receiver.start('7700000000000000002')
    expect(receiver.info().diagnostics).toMatchObject({ methods: { gift: 0 }, giftRejections: { ambiguousCombo: 0 } })
    expect(previous.diagnostics!.methods.gift).toBe(Number.MAX_SAFE_INTEGER)
  })
})
