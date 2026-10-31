import { afterEach, describe, expect, it } from 'vitest'
import { lookupGiftValue, SMALL_GIFT_REFERENCES } from '../packages/core/src/gift-values'
import { createInputStatistics, recordInputStatistics, restoreInputStatistics } from '../packages/core/src/input-statistics'
import { createRuntime } from '../packages/core/src/runtime'
import { normalizeLivePayload } from '../packages/inputs/src/normalize'
import type { LiveEvent } from '../packages/shared/src/index'

const runtimes: ReturnType<typeof createRuntime>[] = []
afterEach(() => runtimes.splice(0).forEach(runtime => runtime.dispose()))
const gift = (id = 'gift', extra: Partial<LiveEvent> = {}): LiveEvent => ({ id, kind: 'gift', user: { id: 'one', name: '客人' }, giftId: 'unlisted', giftName: '未列入的测试礼物', count: 1, origin: 'bridge', at: 1000, ...extra })
const packets = (price: unknown) => [
  { ...gift(), unitDiamonds: price, yuan: 999, price: 999, role: 'admin', token: 'SECRET' },
  { Type: 5, Data: { MsgId: 'gift', User: { Id: 'one', Nickname: '客人' }, GiftId: 'unlisted', GiftName: '未列入的测试礼物', GiftCount: 2, DiamondCount: price, Price: 999, Yuan: 999 } },
  { method: 'WebcastGiftMessage', id: 'gift', user: { id: 'one', name: '客人' }, price: 999, yuan: 999, gift: { id: 'unlisted', name: '未列入的测试礼物', count: 2, repeatEnd: 1, price, yuan: 999 } },
]

describe('礼物抖币单价白名单与参考口径', () => {
  it('三种协议只映射各自明确的单价字段，零价可用，任意元/角色字段仍丢弃', () => {
    for (const price of [0, 1, 10000000]) for (const packet of packets(price)) {
      const result = normalizeLivePayload(packet)[0]!
      expect(result.unitDiamonds).toBe(price)
      expect(result).not.toHaveProperty('price'); expect(result).not.toHaveProperty('yuan'); expect(result).not.toHaveProperty('role')
      expect(JSON.stringify(result)).not.toContain('SECRET')
    }
    expect(normalizeLivePayload({ ...gift(), price: 1, yuan: 1 })[0]).not.toHaveProperty('unitDiamonds')
  })
  it('非法单价只丢价格，不丢有效礼物，不把价格字符串或总价猜成单价', () => {
    for (const price of [-1, 0.1, NaN, Infinity, 10000001, Number.MAX_SAFE_INTEGER + 1, '1', null]) for (const packet of packets(price)) {
      const [result] = normalizeLivePayload(packet)
      expect(result?.kind).toBe('gift'); expect(result).not.toHaveProperty('unitDiamonds')
    }
  })
  it('事件单价优先，参考精确匹配且有来源日期，不将小灯笼猜成灯牌', () => {
    expect(lookupGiftValue({ giftName: '小心心', unitDiamonds: 0 })).toEqual({ unitDiamonds: 0, source: 'event' })
    expect(lookupGiftValue({ giftName: '小心心', unitDiamonds: 7 })).toEqual({ unitDiamonds: 7, source: 'event' })
    expect(lookupGiftValue({ giftName: '小心心' })).toMatchObject({ unitDiamonds: 1, source: 'reference', reference: { confidence: 'official-doc', checkedAt: '2026-10-26' } })
    expect(lookupGiftValue({ giftName: '灯牌' })).toMatchObject({ unitDiamonds: 1, source: 'reference', reference: { name: '粉丝团灯牌', confidence: 'web-reference' } })
    for (const name of ['小灯笼', '棒棒糖', '超级小心心', '小心心特别版']) expect(lookupGiftValue({ giftName: name })).toBeUndefined()
    expect(SMALL_GIFT_REFERENCES).toHaveLength(9)
    for (const entry of SMALL_GIFT_REFERENCES) { expect(entry.sourceURL).toMatch(/^https:\/\//); expect(entry.checkedAt).toBe('2026-10-26') }
  })
})

describe('净增礼物价格统计不改钱包或口粮', () => {
  it('上报与参考分列，未知按件数计，零价是已报告而非未知', () => {
    const statistics = createInputStatistics(1000)
    recordInputStatistics(statistics, gift('reference', { giftName: '小心心', count: 2 }), 1000)
    recordInputStatistics(statistics, gift('zero', { giftName: '小心心', unitDiamonds: 0 }), 1001)
    recordInputStatistics(statistics, gift('unknown', { count: 3 }), 1002)
    expect(statistics.counts.bridge).toEqual({ comments: 0, giftEvents: 3, giftCount: 6, reportedDiamonds: 0, refDiamonds: 2, unknownValueGiftCount: 3 })
    expect(statistics.recentGifts[0]).not.toHaveProperty('unitDiamonds')
    expect(statistics.recentGifts[1]).toMatchObject({ unitDiamonds: 0, diamonds: 0, valueSource: 'event' })
    expect(statistics.recentGifts[2]).toMatchObject({ unitDiamonds: 1, diamonds: 2, valueSource: 'reference' })
    expect(restoreInputStatistics(statistics, 2000)).toEqual(statistics)
  })
  it('直接注入同样校验价格，连击2到5只计新增3件，不重复计价或充值', async () => {
    const runtime = createRuntime({ now: () => 1000 }); runtimes.push(runtime)
    const before = runtime.getState(), first = gift('gift-2', { count: 2, comboKey: 'combo', unitDiamonds: 7 })
    await runtime.command({ type: 'inject', event: first }); await runtime.command({ type: 'inject', event: first })
    await runtime.command({ type: 'inject', event: { ...first, id: 'same-total' } })
    await runtime.command({ type: 'inject', event: { ...first, id: 'gift-5', count: 5 } })
    const after = runtime.getState()
    expect(after.inputStatistics.counts.bridge).toMatchObject({ giftEvents: 2, giftCount: 5, reportedDiamonds: 35, refDiamonds: 0, unknownValueGiftCount: 0 })
    expect(after.inputStatistics.recentGifts.map(row => row.diamonds)).toEqual([21, 14])
    expect(after.queue[0]?.unitDiamonds).toBe(7)
    expect(after.wallet).toEqual(before.wallet); expect(after.rations).toEqual(before.rations)
    await runtime.command({ type: 'inject', event: gift('invalid', { unitDiamonds: -3 }) })
    expect(runtime.getState().inputStatistics.recentGifts[0]).not.toHaveProperty('unitDiamonds')
    expect(runtime.getState().inputStatistics.counts.bridge.unknownValueGiftCount).toBe(1)
  })
  it('旧统计不补猜历史价格，保留未记标记；新的完整记录重启不误标', () => {
    const old = restoreInputStatistics({ startedAt: 1000, counts: { bridge: { comments: 1, giftEvents: 1, giftCount: 5 } }, recentGifts: [{ eventId: 'old', giftName: '小心心', userName: '旧客人', count: 5, origin: 'bridge', at: 1000 }] }, 2000)
    expect(old.legacyValueUnclassified).toBe(true)
    expect(old.counts.bridge).toMatchObject({ reportedDiamonds: 0, refDiamonds: 0, unknownValueGiftCount: 0 })
    expect(old.recentGifts[0]).not.toHaveProperty('diamonds')
    expect(createInputStatistics(2000, old.legacyUnclassified, old.legacyValueUnclassified).legacyValueUnclassified).toBe(true)
    expect(restoreInputStatistics(createInputStatistics(1000), 2000).legacyValueUnclassified).toBe(false)
  })
})
