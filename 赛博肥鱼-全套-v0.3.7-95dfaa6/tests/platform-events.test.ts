import { afterEach, describe, expect, it } from 'vitest'
import { namespaceLiveEvent, normalizeLivePayload } from '../packages/inputs/src/normalize'
import { lookupGiftValue } from '../packages/core/src/gift-values'
import { createInputStatistics, recordInputStatistics, restoreInputStatistics } from '../packages/core/src/input-statistics'
import { createRuntime } from '../packages/core/src/runtime'
import type { LiveEvent, LivePlatform } from '../packages/shared/src/index'

const gift = (platform?: LivePlatform): LiveEvent => ({
  id: 'message-1', kind: 'gift', user: { id: '10001', name: '同名观众' }, at: 1000,
  giftId: 'heart', giftName: '小心心', count: 2, comboKey: 'combo-1', unitDiamonds: 7,
  ...(platform ? { platform } : {}),
})
const runtimes: ReturnType<typeof createRuntime>[] = []
afterEach(() => runtimes.splice(0).forEach(runtime => runtime.dispose()))

describe('直播平台身份隔离', () => {
  it('原生适配器和runtime可复用同一命名空间边界，礼物规则ID保持原值', () => {
    const first = namespaceLiveEvent(gift(), 'bilibili')
    expect(first).toMatchObject({ platform: 'bilibili', id: 'bilibili:message-1', user: { id: 'bilibili:10001' }, comboKey: 'bilibili:combo-1', giftId: 'heart' })
    expect(first).not.toHaveProperty('unitDiamonds')
    expect(namespaceLiveEvent(first, 'bilibili')).toEqual(first)
    expect(() => namespaceLiveEvent({ ...gift(), id: '' }, 'douyin')).toThrow('事件 ID')
  })

  it('同用户/事件/连击原始ID按平台隔离，重复归一化不累加前缀', () => {
    const [douyin] = normalizeLivePayload(gift('douyin'))
    const [bilibili] = normalizeLivePayload(gift('bilibili'))
    expect(douyin).toMatchObject({ platform: 'douyin', id: 'douyin:message-1', user: { id: 'douyin:10001' }, comboKey: 'douyin:combo-1', unitDiamonds: 7 })
    expect(bilibili).toMatchObject({ platform: 'bilibili', id: 'bilibili:message-1', user: { id: 'bilibili:10001' }, comboKey: 'bilibili:combo-1' })
    expect(bilibili).not.toHaveProperty('unitDiamonds')
    expect(normalizeLivePayload(douyin)[0]).toEqual(douyin)
    expect(normalizeLivePayload(bilibili)[0]).toEqual(bilibili)
  })

  it('B站开放ID内的冒号保持完整，其他平台的前缀不能跨平台冒用', () => {
    const raw = { ...gift('bilibili'), user: { id: 'open:opaque:viewer', name: '观众' } }
    const [parsed] = normalizeLivePayload(raw)
    expect(parsed?.user.id).toBe('bilibili:open:opaque:viewer')
    expect(normalizeLivePayload(parsed)[0]).toEqual(parsed)
    expect(normalizeLivePayload({ ...raw, user: { id: 'douyin:10001', name: '观众' } })[0]?.user.id).toBe('bilibili:douyin:10001')
    expect(() => normalizeLivePayload({ ...raw, user: { id: 'x'.repeat(200), name: '观众' } })).toThrow('200')
  })

  it('旧无平台协议的ID和单价保持兼容，无效平台字段不透传', () => {
    const raw = gift()
    expect(normalizeLivePayload(raw)[0]).toEqual(raw)
    expect(normalizeLivePayload({ ...raw, platform: 'unknown-platform' })[0]).toEqual(raw)
  })

  it('两种抖音工具协议明确标平台并隔离观众ID', () => {
    const [barrage] = normalizeLivePayload({ Type: 5, Data: { MsgId: 'm', RoomId: 'r', User: { Id: '10001', Nickname: '观众' }, GiftId: 'heart', GiftName: '小心心', Combo: true, GroupId: 'g', RepeatCount: 2 } })
    expect(barrage).toMatchObject({ platform: 'douyin', id: 'douyin:r:m:2', user: { id: 'douyin:10001' }, comboKey: 'douyin:r:g' })
    expect(normalizeLivePayload(barrage)[0]).toEqual(barrage)
    const [dycast] = normalizeLivePayload({ method: 'WebcastChatMessage', id: 'm', user: { id: 'douyin:10001', name: '观众' }, content: '你好' })
    expect(dycast).toMatchObject({ platform: 'douyin', id: 'douyin:dycast:m', user: { id: 'douyin:10001' } })
    expect(normalizeLivePayload(dycast)[0]).toEqual(dycast)
  })

  it('同数字用户、事件和连击在实际账本不互相去重或合并熟客', async () => {
    const runtime = createRuntime({ now: () => 1000, fetch: async () => { throw new Error('离线测试禁止网络') } })
    runtimes.push(runtime)
    const douyin = normalizeLivePayload(gift('douyin'))[0]!
    const bilibili = normalizeLivePayload(gift('bilibili'))[0]!
    await runtime.command({ type: 'inject', event: douyin })
    await runtime.command({ type: 'inject', event: bilibili })
    await runtime.command({ type: 'inject', event: bilibili })
    const state = runtime.getState()
    expect(state.shop.totalGifts).toBe(4)
    expect(state.viewers.map(viewer => viewer.id).sort()).toEqual(['bilibili:10001', 'douyin:10001'])
    expect(state.viewers.every(viewer => viewer.gifts === 2)).toBe(true)
    expect(state.inputStatistics.counts.unknown).toMatchObject({ giftEvents: 2, giftCount: 4, reportedDiamonds: 14, refDiamonds: 0, unknownValueGiftCount: 2 })
  })
})

describe('礼物货币按平台区分', () => {
  it('B站同名礼物及伪造单价均不能套用抖音价格', () => {
    for (const unitDiamonds of [undefined, 0, 7]) expect(lookupGiftValue({ platform: 'bilibili', giftName: '小心心', unitDiamonds })).toBeUndefined()
    expect(lookupGiftValue({ platform: 'douyin', giftName: '小心心' })).toMatchObject({ unitDiamonds: 1, source: 'reference' })
    expect(lookupGiftValue({ giftName: '小心心' })).toMatchObject({ unitDiamonds: 1, source: 'reference' })
    const [event] = normalizeLivePayload({ ...gift('bilibili'), gold: 10000, total_coin: 10000, coin_type: 'gold' })
    expect(event).not.toHaveProperty('unitDiamonds')
    expect(event).not.toHaveProperty('total_coin')
  })

  it('最近礼物与最后事件保存并恢复平台，B站计件但不计抖钻石', () => {
    const statistics = createInputStatistics(1000)
    recordInputStatistics(statistics, { ...gift('douyin'), origin: 'bridge' }, 1001)
    recordInputStatistics(statistics, { ...gift('bilibili'), origin: 'bridge' }, 1002)
    expect(statistics.counts.bridge).toMatchObject({ giftEvents: 2, giftCount: 4, reportedDiamonds: 14, refDiamonds: 0, unknownValueGiftCount: 2 })
    expect(statistics.recentGifts[0]).toMatchObject({ platform: 'bilibili', count: 2 })
    expect(statistics.recentGifts[0]).not.toHaveProperty('diamonds')
    expect(statistics.recentGifts[1]).toMatchObject({ platform: 'douyin', diamonds: 14 })
    expect(statistics.lastEvent).toEqual({ platform: 'bilibili', origin: 'bridge', kind: 'gift', at: 1002 })
    expect(restoreInputStatistics(statistics, 2000)).toEqual(statistics)
    recordInputStatistics(statistics, { ...gift('bilibili'), kind: 'chat', text: '你好', origin: 'bridge' }, 1003)
    expect(statistics.lastEvent).toMatchObject({ platform: 'bilibili', kind: 'chat' })
    expect(restoreInputStatistics(statistics, 2000).lastEvent).toEqual(statistics.lastEvent)
  })

  it('恢复存档也拒绝B站钻石价格，非法平台字段不会留在状态', () => {
    const statistics = createInputStatistics(1000)
    const recent = { eventId: 'bilibili:m', userName: '观众', giftName: '小心心', count: 2, origin: 'bridge', at: 1001, platform: 'bilibili', unitDiamonds: 7, diamonds: 14, valueSource: 'event' }
    const restored = restoreInputStatistics({ ...statistics, lastEvent: { platform: 'unknown-platform', kind: 'gift', origin: 'bridge', at: 1001 }, recentGifts: [recent] }, 2000)
    expect(restored.recentGifts[0]).toMatchObject({ platform: 'bilibili' })
    expect(restored.recentGifts[0]).not.toHaveProperty('diamonds')
    expect(restored.recentGifts[0]).not.toHaveProperty('unitDiamonds')
    expect(restored.legacyValueUnclassified).toBe(true)
    expect(restored.lastEvent).not.toHaveProperty('platform')
  })
})
