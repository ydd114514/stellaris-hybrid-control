import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { decodeDouyinFrame, encodeProto, heartbeatFrame, readProto } from '../apps/desktop/electron/douyin-protocol'

type WireField = [number, bigint | number | string | Uint8Array]
const ROOM = '9012345678901234567', USER = 9223372036854775807n, MESSAGE = 18446744073709551614n, LOG = 18446744073709551615n
const AT = 1793000000123
const user = (id = USER, name = '小周') => encodeProto([[1, id], [3, name]])
const common = (id = MESSAGE) => encodeProto([[2, id]])
const message = (method: string, body: Uint8Array, id = MESSAGE) => encodeProto([[1, method], [2, body], [3, id]])
function frame(messages: Uint8Array[], options: { gzip?: boolean; ack?: boolean; log?: bigint; ext?: string } = {}) {
  const response = encodeProto([...messages.map(row => [1, row] as WireField), ...(options.ack ? [[9, 1], [5, options.ext ?? 'offline-ext']] as WireField[] : [])])
  return encodeProto([[2, options.log ?? LOG], [6, options.gzip ? 'gzip' : ''], [7, 'msg'], [8, options.gzip ? gzipSync(response) : response]])
}
const chat = (text = '木书架做好了', id = MESSAGE, fields: WireField[] = []) => message('WebcastChatMessage', encodeProto([[1, common(id)], [2, user()], [3, text], ...fields]), id)
function gift(count: number, options: { group?: bigint; final?: boolean; price?: number; name?: string; id?: bigint; giftId?: bigint; comboCount?: number; combo?: boolean; type?: number; sendType?: number } = {}) {
  const id = options.id ?? MESSAGE, details: WireField[] = [[16, options.name ?? '小心心']]
  if (options.price !== undefined) details.push([12, options.price])
  if (options.combo !== undefined) details.push([10, options.combo ? 1 : 0])
  if (options.type !== undefined) details.push([11, options.type])
  const body: WireField[] = [[1, common(id)], [2, options.giftId ?? 1234n], [5, count], [7, user()], [9, options.final ? 1 : 0], [15, encodeProto(details)]]
  if (options.group !== undefined) body.push([11, options.group])
  if (options.comboCount !== undefined) body.push([6, options.comboCount])
  if (options.sendType !== undefined) body.push([17, options.sendType])
  return message('WebcastGiftMessage', encodeProto(body), id)
}

describe('抖音后台二进制协议：真正wire fixtures，完全离线', () => {
  it('protobuf无损保留64位无符号值，心跳只携带hb类型', () => {
    const decoded = readProto(encodeProto([[1, LOG], [2, USER], [3, '离线测试']]))
    expect(decoded.get(1)?.[0]).toBe(LOG); expect(decoded.get(2)?.[0]).toBe(USER)
    const heartbeat = readProto(heartbeatFrame())
    expect(new TextDecoder().decode(heartbeat.get(7)![0] as Uint8Array)).toBe('hb')
    expect(decodeDouyinFrame(heartbeatFrame(), ROOM, AT)).toEqual({ events: [], ended: false, rawMessages: 0 })
  })

  it.each([false, true])('gzip=%s的评论携带原始稳定ID与接收时间，文本只清控制字符', gzip => {
    const result = decodeDouyinFrame(frame([chat('木书架\u0000做好了')], { gzip }), ROOM, AT)
    expect(result.rawMessages).toBe(1); expect(result.ack).toBeUndefined()
    expect(result.events).toEqual([{ id: `douyin:${ROOM}:${MESSAGE}`, kind: 'chat', user: { id: USER.toString(), name: '小周' }, text: '木书架做好了', at: AT }])
  })

  it('ack精确保留64位logId与internalExt，不改成数值或假事件', () => {
    const result = decodeDouyinFrame(frame([chat()], { gzip: true, ack: true, log: LOG, ext: 'offline-opaque-ext' }), ROOM, AT)
    expect(result.ack).toEqual(encodeProto([[2, LOG], [7, 'ack'], [8, 'offline-opaque-ext']]))
    expect(readProto(result.ack!).get(2)?.[0]).toBe(LOG)
    expect(result.events).toHaveLength(1)
  })

  it('同一礼物连击2→5使用相同comboKey、不同累计快照事件ID，重复快照ID稳定', () => {
    const group = 9223372036854775806n
    const result = decodeDouyinFrame(frame([gift(2, { group }), gift(5, { group }), gift(5, { group })]), ROOM, AT)
    expect(result.events.map(event => event.count)).toEqual([2, 5, 5])
    expect(new Set(result.events.map(event => event.comboKey))).toEqual(new Set([`douyin:${ROOM}:${group}`]))
    expect(result.events.map(event => event.id)).toEqual([`douyin:${ROOM}:${MESSAGE}:2`, `douyin:${ROOM}:${MESSAGE}:5`, `douyin:${ROOM}:${MESSAGE}:5`])
    expect(result.events[0]).toMatchObject({ kind: 'gift', user: { id: USER.toString(), name: '小周' }, giftId: '1234', giftName: '小心心' })
  })

  it('没有连击group时仅显式final可记账；未完结、零数量和超限数量不猜', () => {
    const result = decodeDouyinFrame(frame([gift(2), gift(5, { final: true, id: 123n }), gift(0, { final: true }), gift(100001, { final: true })]), ROOM, AT)
    expect(result.rawMessages).toBe(4)
    expect(result.events).toHaveLength(1); expect(result.events[0]).toMatchObject({ id: `douyin:${ROOM}:123`, count: 5 })
    expect(result.events[0]?.comboKey).toBeUndefined()
  })

  it('repeatCount为零可回退有效comboCount，非零越界数量仍拒绝', () => {
    const result = decodeDouyinFrame(frame([gift(0, { comboCount: 1, group: 44n }), gift(0, { comboCount: 0, final: true }), gift(100001, { comboCount: 1, final: true })]), ROOM, AT)
    expect(result.events).toHaveLength(1); expect(result.events[0]).toMatchObject({ count: 1, comboKey: `douyin:${ROOM}:44` })
    expect(result.diagnostics?.giftRejections.count).toBe(2)
  })

  it('明确普通非连击无group礼物接收初始/缺省通知，最终通知不重复计入，独立礼物不按昵称吞并', () => {
    const result = decodeDouyinFrame(frame([gift(1, { combo: false, id: 11n }), gift(1, { combo: false, final: true, id: 12n }), gift(1, { type: 2, id: 13n }), gift(1, { sendType: 5, id: 14n }), gift(1, { combo: false, id: 11n })]), ROOM, AT)
    expect(result.events.map(event => event.id)).toEqual([`douyin:${ROOM}:11`, `douyin:${ROOM}:13`, `douyin:${ROOM}:14`, `douyin:${ROOM}:11`])
    // Existing receiver deduplicates identical event IDs, while distinct single gifts survive.
    expect(new Set(result.events.map(event => event.id)).size).toBe(3)
    expect(result.events.every(event => event.count === 1 && event.comboKey === undefined)).toBe(true)
    expect(result.diagnostics?.giftRejections.nonComboFinal).toBe(1)
  })

  it('type1/4或明确combo的无group仍等final，矛盾single标记不能放行连击中间帧', () => {
    const result = decodeDouyinFrame(frame([gift(1, { type: 1, combo: false, id: 21n }), gift(2, { type: 4, sendType: 5, id: 22n }), gift(3, { combo: true, id: 23n }), gift(4, { sendType: 1, combo: false, id: 24n }), gift(5, { type: 1, final: true, id: 25n })]), ROOM, AT)
    expect(result.events).toHaveLength(1); expect(result.events[0]).toMatchObject({ id: `douyin:${ROOM}:25`, count: 5 })
    expect(result.diagnostics?.giftRejections.ambiguousCombo).toBe(4)
  })

  it('脱敏诊断只计固定method及拒绝原因，未知方法名和原消息内容不写进计数', () => {
    const result = decodeDouyinFrame(frame([chat('不应进入诊断'), gift(1), gift(1, { final: true, name: '' }), message('FuturePrivateMethod', new Uint8Array()), message('WebcastGiftMessage', Uint8Array.of(0x0a, 0x05, 0x01))]), ROOM, AT)
    expect(result.diagnostics?.methods).toEqual({ chat: 1, enter: 0, follow: 0, like: 0, gift: 3, control: 0, other: 1 })
    expect(result.diagnostics?.giftRejections).toMatchObject({ ambiguousCombo: 1, details: 1, malformed: 1 })
    expect(JSON.stringify(result.diagnostics)).not.toMatch(/不应进入诊断|小周|小心心|FuturePrivateMethod/)
  })

  it('官方字段价格0和未提供价格明确区分；不从礼物名字或别的字段臆测金额', () => {
    const result = decodeDouyinFrame(frame([gift(1, { final: true, price: 0, id: 11n }), gift(1, { final: true, id: 12n }), gift(1, { final: true, price: 10000001, id: 13n })]), ROOM, AT)
    expect(result.events[0]?.unitDiamonds).toBe(0)
    expect(result.events[1]).not.toHaveProperty('unitDiamonds'); expect(result.events[2]).not.toHaveProperty('unitDiamonds')
    expect(result.events.every(event => !('yuan' in event))).toBe(true)
  })

  it('社交action只有1为关注；统计/未知消息只增加原始消息数，不伪造观众事件', () => {
    const social = (action: number) => message('WebcastSocialMessage', encodeProto([[1, common(BigInt(action + 100))], [2, user()], [4, action]]))
    const result = decodeDouyinFrame(frame([social(1), social(2), social(4), message('WebcastRoomStatsMessage', encodeProto([[1, common()], [2, 999]])), message('UnknownFutureMessage', encodeProto([[1, common()], [2, user()]]))]), ROOM, AT)
    expect(result.rawMessages).toBe(5); expect(result.events).toHaveLength(1)
    expect(result.events[0]?.kind).toBe('follow')
  })

  it('成员/点赞使用各自的user字段，下播control只置ended标记', () => {
    const member = message('WebcastMemberMessage', encodeProto([[1, common(201n)], [2, user()]]))
    const like = message('WebcastLikeMessage', encodeProto([[1, common(202n)], [5, user()]]))
    const ended = message('WebcastControlMessage', encodeProto([[2, 3]]))
    const result = decodeDouyinFrame(frame([member, like, ended]), ROOM, AT)
    expect(result.events.map(event => event.kind)).toEqual(['enter', 'like']); expect(result.ended).toBe(true); expect(result.rawMessages).toBe(3)
  })

  it('单条损坏UTF-8/消息体不能吞掉同帧有效评论；缺少稳定ID或昵称的消息不生成', () => {
    const malformed = message('WebcastChatMessage', Uint8Array.of(0x0a, 0x05, 0x01))
    const badUTF = message('WebcastChatMessage', encodeProto([[1, common()], [2, user()], [3, Uint8Array.of(0xff)]]))
    const noId = message('WebcastChatMessage', encodeProto([[2, user(0n)], [3, '不能用昵称补ID']]), 0n)
    const noName = message('WebcastChatMessage', encodeProto([[1, common()], [2, user(USER, '')], [3, '无昵称']]))
    const result = decodeDouyinFrame(frame([malformed, badUTF, noId, noName, chat('完整消息仍保留')]), ROOM, AT)
    expect(result.rawMessages).toBe(5); expect(result.events).toHaveLength(1); expect(result.events[0]?.text).toBe('完整消息仍保留')
  })

  it('损坏帧、越界varint、字段风暴与消息风暴有界拒绝，不挂循环', () => {
    for (const bytes of [Uint8Array.of(0), Uint8Array.of(0x80), Uint8Array.of(0x0a, 0x05, 0x01), Uint8Array.of(0x0b, 0), Uint8Array.of(0x09, 1), Uint8Array.of(0x0d, 1), Uint8Array.of(0x08, ...Array(10).fill(0xff))]) expect(() => readProto(bytes)).toThrow()
    expect(() => readProto(new Uint8Array(4 * 1024 * 1024 + 1))).toThrow('大小限制')
    expect(() => readProto(Uint8Array.from({ length: 40002 }, (_, index) => index % 2 ? 0 : 8))).toThrow('字段过多')
    expect(() => decodeDouyinFrame(frame(Array.from({ length: 1001 }, () => chat())), ROOM, AT)).toThrow('消息过多')
  })

  it('gzip解压也有4MiB硬上限，避免小压缩包膨胀占用内存', () => {
    const bomb = encodeProto([[6, 'gzip'], [7, 'msg'], [8, gzipSync(Buffer.alloc(4 * 1024 * 1024 + 1))]])
    expect(() => decodeDouyinFrame(bomb, ROOM, AT)).toThrow()
  })
})
