import { afterEach, describe, expect, it } from 'vitest'
import { createRuntime } from '../packages/core/src/runtime'
import { createDefaultState } from '../packages/core/src/defaults'
import { restoreInputStatistics } from '../packages/core/src/input-statistics'
import type { InputOrigin, LiveEvent } from '../packages/shared/src'

const runtimes: ReturnType<typeof createRuntime>[] = []
afterEach(() => runtimes.splice(0).forEach(runtime => runtime.dispose()))
const make = (options: Parameters<typeof createRuntime>[0] = {}) => { const runtime = createRuntime({ now: () => 1000, fetch: async () => { throw new Error('离线测试禁止网络') }, ...options }); runtimes.push(runtime); return runtime }
const event = (id: string, kind: LiveEvent['kind'], origin?: InputOrigin, extra: Partial<LiveEvent> = {}): LiveEvent => ({ id, kind, origin, user: { id: 'audience-one', name: '小猫' }, at: 900, ...(kind === 'chat' ? { text: `留言${id}` } : kind === 'gift' ? { giftId: 'heart', giftName: '小心心', count: 1 } : {}), ...extra })
const inject = (runtime: ReturnType<typeof createRuntime>, value: LiveEvent) => runtime.command({ type: 'inject', event: value })
const totals = (comments: number, giftEvents: number, giftCount: number) => ({ comments, giftEvents, giftCount, reportedDiamonds: 0, refDiamonds: giftCount, unknownValueGiftCount: 0 })

describe('去重后的本场消息来源统计', () => {
  it('屏幕识别独立计数、只用参考价，不授予已核验关注送礼或增加元钱包', async () => {
    const runtime = make(); const before = runtime.getState()
    await inject(runtime, event('ocr-follow', 'follow', 'screen'))
    await inject(runtime, event('ocr-gift', 'gift', 'screen', { count: 2, unitDiamonds: 999 }))
    const state = runtime.getState(), viewer = state.viewers[0]!
    expect(state.inputStatistics.counts.screen).toMatchObject({ giftCount: 2, reportedDiamonds: 0, refDiamonds: 2 })
    expect(viewer.gifts).toBe(2); expect(viewer.verifiedGiftCount).toBe(0); expect(viewer.followedAt).toBeUndefined()
    expect(state.wallet.balance).toBe(before.wallet.balance)
    expect(state.inputStatistics.recentGifts[0]).toMatchObject({ origin: 'screen', valueSource: 'reference', unitDiamonds: 1 })
    const beforeConfirm = runtime.getState()
    expect(runtime.confirmDuplicateGift(event('late-a', 'gift', 'bridge', { count: 2 }))).toBe(true)
    expect(runtime.confirmDuplicateGift(event('late-a', 'gift', 'bridge', { count: 2 }))).toBe(true)
    const confirmed = runtime.getState()
    expect(confirmed.viewers[0]?.verifiedGiftCount).toBe(1)
    expect(confirmed.inputStatistics).toEqual(beforeConfirm.inputStatistics); expect(confirmed.rations).toEqual(beforeConfirm.rations); expect(confirmed.wallet).toEqual(beforeConfirm.wallet)
    expect(confirmed.history).toEqual(beforeConfirm.history)
  })
  it('模拟、本机接入和未标来源分别计数，不把未标记录称真实', async () => {
    const runtime = make()
    for (const origin of ['simulator', 'bridge', undefined] as const) {
      await inject(runtime, event(`c-${origin}`, 'chat', origin))
      await inject(runtime, event(`g-${origin}`, 'gift', origin, { count: 2 }))
    }
    const statistics = runtime.getState().inputStatistics
    expect(statistics.counts).toEqual({ simulator: totals(1, 1, 2), bridge: totals(1, 1, 2), screen: totals(0, 0, 0), unknown: totals(1, 1, 2) })
    expect(statistics.recentGifts.map(gift => gift.origin)).toEqual(['unknown', 'bridge', 'simulator'])
    expect(statistics.lastEvent).toEqual({ origin: 'unknown', kind: 'gift', at: 1000 })
    expect(runtime.getState().queue.every(value => ['simulator', 'bridge', 'unknown'].includes(value.origin!))).toBe(true)
  })
  it('同ID和相同累计值不重复统计，连击2到5只新增3件', async () => {
    let clock = 1000
    const runtime = make({ now: () => clock })
    const gift = event('gift-2', 'gift', 'bridge', { count: 2, comboKey: 'combo-one' })
    await inject(runtime, gift); clock++
    await inject(runtime, gift); clock++
    await inject(runtime, { ...gift, id: 'gift-same-total' }); clock++
    await inject(runtime, { ...gift, id: 'gift-5', count: 5 })
    const statistics = runtime.getState().inputStatistics
    expect(statistics.counts.bridge).toEqual(totals(0, 2, 5))
    expect(statistics.recentGifts.map(gift => gift.count)).toEqual([3, 2])
    expect(statistics.lastEvent?.at).toBe(clock)
    expect(runtime.getState().shop.totalGifts).toBe(5)
  })
  it('重复评论和刷屏合并不虚增独立评论，投票提前返回也只记录一次', async () => {
    const runtime = make()
    const line = event('comment', 'chat', 'simulator', { text: '你好' })
    await inject(runtime, line); await inject(runtime, line); await inject(runtime, { ...line, id: 'spam-other-id' })
    const config = runtime.getState().config
    await runtime.command({ type: 'set-config', config: { ...config, vote: { ...config.vote, enabled: true } } })
    await runtime.command({ type: 'vote-open', title: '明晚做什么', options: [{ id: 'a', title: '泡茶', about: '泡一杯茶', kind: 'activity' }, { id: 'b', title: '看星星', about: '数星星', kind: 'activity' }], minutes: 1 })
    const vote = event('vote', 'chat', 'bridge', { text: '投1' })
    await inject(runtime, vote); await inject(runtime, vote)
    expect(runtime.getState().inputStatistics.counts.simulator.comments).toBe(1)
    expect(runtime.getState().inputStatistics.counts.bridge.comments).toBe(1)
    expect(runtime.getState().inputStatistics.lastEvent).toEqual({ origin: 'bridge', kind: 'chat', at: 1000 })
  })
  it('最后有效消息可显示进场或关注，重复事件不刷新时间', async () => {
    let clock = 1000
    const runtime = make({ now: () => clock })
    const follow = event('follow', 'follow', 'bridge')
    await inject(runtime, follow); clock += 1000; await inject(runtime, follow)
    expect(runtime.getState().inputStatistics.lastEvent).toEqual({ origin: 'bridge', kind: 'follow', at: 1000 })
    expect(runtime.getState().inputStatistics.counts.bridge).toEqual(totals(0, 0, 0))
  })
  it('reset只清本场来源统计，玩法暖心和钱包行为保持', async () => {
    const runtime = make()
    const state = runtime.getState()
    await runtime.command({ type: 'set-config', config: { ...state.config, wallet: { ...state.config.wallet, enabled: true, share: .5 } } })
    await runtime.command({ type: 'set-gifts', gifts: state.gifts.map(gift => gift.id === 'heart' ? { ...gift, yuan: 2 } : gift) })
    const before = runtime.getState().wallet.balance
    const gift = event('sim-gift', 'gift', 'simulator', { count: 2 })
    await inject(runtime, gift)
    expect(runtime.getState().wallet.balance).toBe(before + 2)
    const game = runtime.getState().shop
    await runtime.command({ type: 'reset-session' })
    const statistics = runtime.getState().inputStatistics
    expect(statistics.counts.simulator).toEqual(totals(0, 0, 0))
    expect(statistics.recentGifts).toEqual([]); expect(statistics.lastEvent).toBeUndefined()
    expect(runtime.getState().wallet.balance).toBe(before + 2)
    expect(runtime.getState().shop).toEqual(game)
    await inject(runtime, gift)
    expect(runtime.getState().inputStatistics.counts.simulator.giftCount).toBe(0)
  })
  it('旧累计不臆测分配，新未标事件才进入unknown，重启保留本场分列', async () => {
    const old: any = createDefaultState(500)
    delete old.inputStatistics; old.shop.totalGifts = 27; old.wallet.earned = 12
    let saved = old
    const store = { load: () => saved, save: (state: unknown) => { saved = structuredClone(state) } }
    const first = make({ store })
    expect(first.getState().inputStatistics.legacyUnclassified).toBe(true)
    expect(first.getState().inputStatistics.counts.unknown.giftCount).toBe(0)
    await inject(first, event('new-unknown', 'gift', undefined, { count: 3 }))
    const second = make({ store })
    expect(second.getState().inputStatistics.counts.unknown.giftCount).toBe(3)
    expect(second.getState().shop.totalGifts).toBe(30)
    await inject(second, event('new-unknown', 'gift', undefined, { count: 3 }))
    expect(second.getState().inputStatistics.counts.unknown.giftCount).toBe(3)
    await second.command({ type: 'reset-session' })
    expect(second.getState().inputStatistics.legacyUnclassified).toBe(true)
  })
  it('最近礼物始终有界，恢复时丢弃无效字段与敏感附加项', async () => {
    const runtime = make()
    for (let i = 0; i < 25; i++) await inject(runtime, event(`gift-${i}`, 'gift', 'bridge'))
    const statistics = runtime.getState().inputStatistics
    expect(statistics.recentGifts).toHaveLength(20)
    expect(statistics.counts.bridge.giftCount).toBe(25)
    const restored = restoreInputStatistics({ ...statistics, token: 'SECRET', counts: { bridge: { comments: -1, giftEvents: Infinity, giftCount: NaN } }, recentGifts: Array.from({ length: 30 }, () => ({ ...statistics.recentGifts[0], cookie: 'SECRET' })) }, 2000)
    expect(restored.recentGifts).toHaveLength(20)
    expect(restored.counts.bridge).toEqual(totals(0, 0, 0))
    expect(JSON.stringify(restored)).not.toContain('SECRET')
  })
})
