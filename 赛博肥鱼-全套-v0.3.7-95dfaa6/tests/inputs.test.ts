import { afterEach, describe, expect, it, vi } from 'vitest'
import { once } from 'node:events'
import { createServer, request } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import { createLiveInputBridge } from '../apps/desktop/electron/live-input'
import { normalizeLivePayload, parseTransportJson, validateLocalUpstream } from '../packages/inputs/src/normalize'
import { createRuntime } from '../packages/core/src/runtime'
import type { LiveEvent } from '../packages/shared/src'

const event = (id = 'event-one'): LiveEvent => ({ id, kind: 'chat', user: { id: 'stable-user-one', name: '晚睡的猫' }, text: '点歌 晚安', at: 1780000000000 })
const bridges: ReturnType<typeof createLiveInputBridge>[] = []
const sockets: WebSocket[] = []
const sources: WebSocketServer[] = []
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.terminate()
  for (const source of sources.splice(0)) { for (const client of source.clients) client.terminate(); await new Promise<void>(resolve => source.close(() => resolve())) }
  await Promise.all(bridges.splice(0).map(bridge => bridge.stop()))
})
const make = (options: Partial<Parameters<typeof createLiveInputBridge>[0]> = {}) => { const bridge = createLiveInputBridge({ onEvent: () => ({ ok: true }), ...options }); bridges.push(bridge); return bridge }
async function post(bridge: ReturnType<typeof make>, payload: unknown, key = bridge.info().token) {
  return fetch(bridge.info().endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: typeof payload === 'string' ? payload : JSON.stringify(payload) })
}

describe('独立输入协议适配', () => {
  it('只监听端口与自检不报后台健康，认证健康请求和真实WS连接才报健康', async () => {
    const onHealth = vi.fn(), bridge = make({ onHealth })
    await bridge.start({port:0})
    expect(onHealth).not.toHaveBeenCalled()
    expect((await bridge.test()).ok).toBe(true); expect(onHealth).not.toHaveBeenCalled()
    const health = bridge.info().endpoint.replace('/events','/health')
    await fetch(health); expect(onHealth).not.toHaveBeenCalled()
    await fetch(health,{headers:{Authorization:`Bearer ${bridge.info().token}`}})
    expect(onHealth).toHaveBeenCalledWith({state:'heartbeat',heartbeatExpected:true})
    const socket = new WebSocket(bridge.info().websocketEndpoint!); sockets.push(socket); await once(socket,'open')
    expect(onHealth).toHaveBeenCalledWith({state:'connected',heartbeatExpected:true})
    socket.close(); await once(socket,'close'); await new Promise(resolve=>setTimeout(resolve,5))
    expect(onHealth).toHaveBeenLastCalledWith({state:'disconnected',heartbeatExpected:true})
    expect(bridge.info().received).toBe(0)
  })
  it('只接收稳定用户和事件 ID，不把外部价格、角色权限与声明礼物透传', () => {
    const [parsed] = normalizeLivePayload({ ...event(), claimed: { yuan: 999, gift: '火箭' }, User: { IsAdmin: true }, arbitrary: 'ignored' })
    expect(parsed).toEqual(event())
    expect(() => normalizeLivePayload({ ...event(), id: '' })).toThrow('事件 ID')
    expect(() => normalizeLivePayload({ ...event(), user: { name: '只给昵称' } })).toThrow('用户 ID')
    expect(() => normalizeLivePayload({ ...event(), user: { id: 'x'.repeat(201), name: '猫' } })).toThrow('不能超过')
  })
  it('64 位事件与用户 ID 在解析外层及 Data 字符串时保持精确', () => {
    const data = '{"MsgId":7338701468109681418,"RoomId":"room1","User":{"Id":7000000000000000101,"Nickname":"猫"},"Content":"你好"}'
    const [parsed] = normalizeLivePayload(JSON.stringify({ Type: 1, Data: data }))
    expect(parsed?.id).toBe('douyin:room1:7338701468109681418')
    expect(parsed?.user.id).toBe('douyin:7000000000000000101')
    expect(parseTransportJson('{"id":7338701468109681419,"text":"number 7338701468109681418 unchanged","amount":1.5}')).toEqual({ id: '7338701468109681419', text: 'number 7338701468109681418 unchanged', amount: 1.5 })
    expect(() => normalizeLivePayload({ ...event(), id: 7338701468109681000 })).toThrow('安全整数')
  })
  it('DouyinBarrageGrab 礼物累计数量与增量数量区分，重复快照幂等', () => {
    const packet = { Type: 5, Data: { MsgId: 'gift-msg', WebRoomId: 'room', User: { Id: 'user', Nickname: '猫', PayLevel: 16 }, GiftId: '685', GiftName: '小心心', GroupId: 'group-one', GiftCount: 1, RepeatCount: 5, Combo: true } }
    const first = normalizeLivePayload(packet)[0]!
    expect(first.count).toBe(5); expect(first.comboKey).toBe('douyin:room:group-one')
    expect(first.user.level).toBe(16)
    expect(normalizeLivePayload(packet, 'auto', first.at)[0]).toEqual(first)
    const next = normalizeLivePayload({ ...packet, Data: { ...packet.Data, RepeatCount: 6 } })[0]!
    expect(next.comboKey).toBe(first.comboKey); expect(next.id).not.toBe(first.id); expect(next.count).toBe(6)
    const incremental = normalizeLivePayload({ ...packet, Data: { ...packet.Data, Combo: false, GiftCount: 2 } })[0]!
    expect(incremental.count).toBe(2); expect(incremental.comboKey).toBeUndefined()
  })
  it('公开格式的弹幕/点赞/进场/关注和统计类型各自映射', () => {
    const base = { MsgId: '1', User: { Id: 'user', NickName: '猫' }, Content: '你好' }
    expect([1, 2, 3, 4].map(Type => normalizeLivePayload({ Type, Data: base })[0]?.kind)).toEqual(['chat', 'like', 'enter', 'follow'])
    expect(normalizeLivePayload({ Type: 6, Data: '{}' })).toEqual([])
    expect(normalizeLivePayload({ method: 'WebcastChatMessage', id: 'dy-1', user: { id: 'u', name: '猫' }, content: '点歌 月亮' })[0]?.text).toBe('点歌 月亮')
    expect(normalizeLivePayload({ method: 'WebcastSocialMessage', id: 'dy-2', user: { id: 'u', name: '猫' }, content: '分享了直播间' })).toEqual([])
    expect(normalizeLivePayload({ method: 'WebcastSocialMessage', id: 'dy-3', user: { id: 'u', name: '猫' }, content: '取消关注主播' })).toEqual([])
    expect(normalizeLivePayload({ method: 'WebcastSocialMessage', id: 'dy-4', user: { id: 'u', name: '猫' }, content: 'unfollowed' })).toEqual([])
    expect(normalizeLivePayload({ method: 'WebcastSocialMessage', id: 'dy-5', user: { id: 'u', name: '猫' }, content: '关注了主播' })[0]?.kind).toBe('follow')
  })
  it('dycast 礼物只接收明确最终快照，不能把连击中间值重复入账', () => {
    const packet = { method: 'WebcastGiftMessage', id: 'dy-gift', user: { id: 'u', name: '猫' }, gift: { id: '1', name: '小心心', count: 9, repeatEnd: 0 } }
    expect(normalizeLivePayload(packet)).toEqual([])
    expect(normalizeLivePayload({ ...packet, gift: { ...packet.gift, repeatEnd: 1 } })[0]?.count).toBe(9)
  })
  it('批次和大小有界，非法礼物计数不通过', () => {
    expect(() => normalizeLivePayload(Array.from({ length: 51 }, () => event()))).toThrow('50')
    expect(() => normalizeLivePayload([Array.from({ length: 30 }, () => event()), Array.from({ length: 21 }, () => event())])).toThrow('50')
    expect(() => normalizeLivePayload([[[[[[event()]]]]]])).toThrow('嵌套过深')
    expect(() => parseTransportJson(' '.repeat(65537))).toThrow('64 KiB')
    expect(() => normalizeLivePayload({ ...event(), kind: 'gift', giftId: '1', giftName: '心', count: -1 })).toThrow('整数')
  })
  it('上游仅连接本机，不接受远端、账号密码或令牌查询参数', () => {
    expect(validateLocalUpstream('ws://localhost:8888')).toBe('ws://127.0.0.1:8888/')
    expect(validateLocalUpstream('')).toBe('')
    for (const url of ['ws://example.com:8888', 'https://127.0.0.1', 'ws://127.0.0.1.evil.com', 'ws://name:password@127.0.0.1:8888', 'ws://127.0.0.1:8888?token=secret']) expect(() => validateLocalUpstream(url)).toThrow()
  })
})

describe('本机互动接收器', () => {
  it('本机 HTTP 认证、协议、回执、状态及真实接入自测完整可用', async () => {
    const onEvent = vi.fn(() => ({ ok: true })), onStatus = vi.fn()
    const bridge = make({ onEvent, onStatus }); const state = await bridge.start({ port: 0 })
    expect(state.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/events$/)
    expect(state.token.length).toBeGreaterThan(32)
    expect(JSON.stringify(onStatus.mock.calls)).not.toContain(state.token)
    expect((await post(bridge, event(), 'wrong-token')).status).toBe(401)
    expect(onEvent).not.toHaveBeenCalled()
    const response = await post(bridge, event()); expect(response.status).toBe(202)
    expect(onEvent).toHaveBeenCalledWith(event()); expect(bridge.info().received).toBe(1)
    expect((await bridge.test()).ok).toBe(true); expect(bridge.info().received).toBe(1); expect(onEvent).toHaveBeenCalledTimes(1)
    await bridge.stop(); expect(bridge.info().status).toBe('stopped'); expect(bridge.info().endpoint).toBe('')
  })
  it('错误 JSON、超大请求、错误 Content-Type 与过量批次明确拒绝', async () => {
    const bridge = make(); await bridge.start({ port: 0 })
    expect((await post(bridge, '{broken')).status).toBe(400)
    expect((await post(bridge, JSON.stringify({ text: 'x'.repeat(66000) }))).status).toBe(413)
    expect((await post(bridge, Array.from({ length: 51 }, () => event()))).status).toBe(422)
    const wrongType = await fetch(bridge.info().endpoint, { method: 'POST', headers: { Authorization: `Bearer ${bridge.info().token}`, 'Content-Type': 'text/plain' }, body: 'hello' })
    expect(wrongType.status).toBe(415)
    expect(bridge.info().rejected).toBe(4)
  })
  it('本机 DNS 重绑定 Host 不通过，令牌不出现在错误信息', async () => {
    const bridge = make(); const state = await bridge.start({ port: 0 })
    const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = request(state.endpoint, { method: 'POST', headers: { Host: 'evil.example', Authorization: `Bearer ${state.token}`, 'Content-Type': 'application/json' } }, res => { let body = ''; res.on('data', chunk => body += chunk); res.on('end', () => resolve({ status: res.statusCode!, body })) }); req.on('error', reject); req.end(JSON.stringify(event()))
    })
    expect(result.status).toBe(403); expect(result.body).not.toContain(state.token)
  })
  it('轮换令牌立即令旧 HTTP 凭据失效', async () => {
    const bridge = make(); const old = await bridge.start({ port: 0 }); const next = bridge.rotateToken()
    expect(next.token).not.toBe(old.token)
    expect((await post(bridge, event(), old.token)).status).toBe(401)
    expect((await post(bridge, event(), next.token)).status).toBe(202)
  })
  it('批次以整体限流，队列不会无限增长', async () => {
    const onEvent = vi.fn(() => ({ ok: true })), bridge = make({ onEvent, limits: { burst: 2, perSecond: 0 } }); await bridge.start({ port: 0 })
    expect((await post(bridge, [event('1'), event('2'), event('3')])).status).toBe(422)
    expect(onEvent).not.toHaveBeenCalled()
    expect((await post(bridge, [event('1'), event('2')])).status).toBe(202)
    expect((await post(bridge, event('4'))).status).toBe(422)
  })
  it('正在处理的输入计入队列上限，不会被慢消费者挤爆', async () => {
    let release!: () => void
    const started = Promise.withResolvers<void>(), latch = new Promise<void>(resolve => release = resolve)
    const bridge = make({ limits: { pending: 1 }, onEvent: async () => { started.resolve(); await latch; return { ok: true } } }); await bridge.start({ port: 0 })
    const first = post(bridge, event('first')); await started.promise
    expect((await post(bridge, event('second'))).status).toBe(422)
    release(); expect((await first).status).toBe(202)
  })
  it('端口已占用会退到空闲端口，不改动占用它的其他程序', async () => {
    const blocker = createServer(); blocker.listen(0, '127.0.0.1'); await once(blocker, 'listening')
    const address = blocker.address(); const requested = typeof address === 'object' && address ? address.port : 0
    try { const bridge = make(); const state = await bridge.start({ port: requested }); expect(new URL(state.endpoint).port).not.toBe(String(requested)); expect(blocker.listening).toBe(true) }
    finally { blocker.close() }
  })
  it('浏览器工具可按带令牌 WebSocket 地址转发实际协议，统计不透出令牌', async () => {
    const onEvent = vi.fn(() => ({ ok: true })), bridge = make({ onEvent }); const state = await bridge.start({ port: 0 })
    const socket = new WebSocket(state.websocketEndpoint!); sockets.push(socket); await once(socket, 'open')
    const reply = once(socket, 'message'); socket.send(JSON.stringify({ Type: 1, Data: JSON.stringify({ MsgId: 'ws-chat', User: { Id: 'user', Nickname: '猫' }, Content: '点歌 晚安' }) })); await reply
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ text: '点歌 晚安' })); expect(bridge.info().received).toBe(1)
    bridge.rotateToken(); await vi.waitFor(() => expect(socket.readyState).toBe(WebSocket.CLOSED))
    const old = new WebSocket(state.websocketEndpoint!); sockets.push(old)
    const [error] = await once(old, 'error'); expect(String(error)).toContain('401')
    expect(onEvent).toHaveBeenCalledTimes(1)
  })
  it('本机 WebSocket 上游可接入，64 位消息保持精度，停止后不再投递', async () => {
    const source = new WebSocketServer({ host: '127.0.0.1', port: 0 }); sources.push(source); await once(source, 'listening')
    const address = source.address(); if (typeof address === 'string') throw new Error('unexpected pipe')
    const onEvent = vi.fn(() => ({ ok: true })), bridge = make({ onEvent }); const connected = once(source, 'connection')
    await bridge.start({ port: 0, upstreamUrl: `ws://127.0.0.1:${address.port}`, upstreamFormat: 'douyin-barrage' }); const [sourceClient] = await connected
    sourceClient.send('{"Type":1,"Data":{"MsgId":7338701468109681418,"User":{"Id":10001,"Nickname":"猫"},"Content":"你好"}}')
    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledOnce())
    expect(onEvent.mock.calls[0]![0].id).toContain('7338701468109681418')
    await bridge.stop(); expect(bridge.info().status).toBe('stopped')
  })
  it('接收器重连后同一事件和连击快照不会让实际账本重复入账', async () => {
    const runtime = createRuntime()
    const bridge = make({ onEvent: e => runtime.command({ type: 'inject', event: e }) })
    const gift = { ...event('gift-one'), kind: 'gift' as const, text: undefined, giftId: 'heart', giftName: '小心心', count: 2, comboKey: 'combo-one' }
    try {
      await bridge.start({ port: 0 })
      expect((await post(bridge, gift)).status).toBe(202)
      expect((await post(bridge, gift)).status).toBe(202)
      expect(runtime.getState().shop.totalGifts).toBe(2)
      await bridge.stop(); await bridge.start({ port: 0 })
      expect((await post(bridge, gift)).status).toBe(202)
      expect((await post(bridge, { ...gift, id: 'gift-two', count: 5 })).status).toBe(202)
      expect(runtime.getState().shop.totalGifts).toBe(5)
      expect(runtime.getState().shop.points).toBe(5)
    } finally { runtime.dispose() }
  })
  it('停止接收后尚未投递的旧批次会作废，重开不会复活旧事件', async () => {
    const started = Promise.withResolvers<void>(), release = Promise.withResolvers<void>()
    const delivered: string[] = []
    const bridge = make({ onEvent: async e => {
      delivered.push(e.id)
      if (e.id === 'before-stop') { started.resolve(); await release.promise }
      return { ok: true }
    } })
    await bridge.start({ port: 0 })
    const oldRequest = post(bridge, [event('before-stop'), event('must-not-arrive')]).catch(() => undefined)
    await started.promise
    await bridge.stop(); release.resolve(); await oldRequest
    await bridge.start({ port: 0 })
    expect((await post(bridge, event('new-generation'))).status).toBe(202)
    expect(delivered).toEqual(['before-stop', 'new-generation'])
  })

})
