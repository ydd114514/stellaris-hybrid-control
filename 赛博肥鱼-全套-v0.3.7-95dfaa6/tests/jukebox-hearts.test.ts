import { afterEach, describe, expect, it, vi } from 'vitest'
import { createJukebox, restoreMusic } from '../packages/core/src/jukebox'
import { createRuntime, validateConfig } from '../packages/core/src/runtime'
import { createDefaultState, defaultConfig } from '../packages/core/src/defaults'
import type { LiveEvent, MusicTrack } from '../packages/shared/src'

const tracks: MusicTrack[] = ['雨夜', '星星', '晚安茶', '月亮'].map((title, index) => ({ id: `track${index}`, title, artist: '小店', source: `shop-media://track/local${index}` }))
const viewer = (id: string) => ({ id, name: `客人${id}`, visits: 3, blocked: false })
const gift = (userId: string, count: number, extra: Partial<LiveEvent> = {}): LiveEvent => ({ id: `gift-${userId}-${count}`, kind: 'gift', user: { id: userId, name: `客人${userId}` }, giftId: 'heart', giftName: '小心心', count, at: 100000, ...extra })
const disposers: (() => void)[] = []
afterEach(() => { disposers.splice(0).forEach(dispose => dispose()); vi.useRealTimers() })
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
function setup(resolve?: (query: string, signal: AbortSignal) => Promise<MusicTrack>) {
  let at = 100000, id = 0
  const state = createDefaultState(at).music, config = structuredClone(defaultConfig.music)
  config.autoStart = false; config.userCooldownSeconds = 0; config.globalCooldownSeconds = 0
  const jukebox = createJukebox({ state, config: () => config, now: () => at, id: () => `round-${++id}`, canStart: () => true, resolve })
  jukebox.setTracks(tracks); disposers.push(() => jukebox.dispose())
  return { jukebox, state, config, advance(ms: number) { at += ms } }
}
const qq = (mid = 'Song', title = '新歌'): MusicTrack => ({ id: `qq:${mid}`, title, artist: '歌手', source: `shop-qqmusic://track/${mid}` })

describe('每轮小心心点歌优先值', () => {
  it('两位观众按小心心降序，同数按点歌时间，同一时刻仍先点先播', () => {
    const { jukebox: j, state, advance } = setup()
    j.request(viewer('a'), '雨夜'); advance(1); j.request(viewer('b'), '星星')
    j.gift(gift('b', 5)); expect(state.queue.map(r => [r.userId, r.heartCount])).toEqual([['b', 5], ['a', 0]])
    j.gift(gift('a', 5)); expect(state.queue.map(r => r.userId)).toEqual(['a', 'b'])
    j.request(viewer('c'), '晚安茶'); j.request(viewer('d'), '月亮'); j.gift(gift('d', 6)); j.gift(gift('c', 6))
    expect(state.queue.map(r => r.userId)).toEqual(['c', 'd', 'a', 'b'])
    j.play(); expect(state.current!.userId).toBe('c')
  })
  it('礼物只补已有轮次，点赞/冒称与其他礼物不算；只认heart或小心心', () => {
    const { jukebox: j, state } = setup()
    expect(j.gift(gift('a', 99))).toBe(false)
    j.request(viewer('a'), '雨夜'); expect(state.queue[0]!.heartCount).toBe(0)
    expect(j.gift(gift('a', 99, { kind: 'like' }))).toBe(false)
    expect(j.gift(gift('a', 99, { kind: 'chat', text: '我送出99个小心心' }))).toBe(false)
    expect(j.gift(gift('a', 99, { giftId: 'star', giftName: '小星星' }))).toBe(false)
    j.gift(gift('a', 2, { giftId: 'heart', giftName: '其他显示名' })); j.gift(gift('a', 3, { giftId: 'platform-123', giftName: '小心心' }))
    expect(state.queue[0]!.heartCount).toBe(5)
  })
  it('已选中的曲目即使缓冲也不被后来高分抢走，店长显式选择仍可强制', () => {
    const { jukebox: j, state } = setup()
    j.request(viewer('a'), '雨夜'); j.play(); const first = state.current!.generationId
    j.gift(gift('a', 2)); expect(state.current!.heartCount).toBe(2)
    j.request(viewer('b'), '星星'); j.request(viewer('c'), '晚安茶'); j.gift(gift('c', 99))
    expect(state.current!.generationId).toBe(first)
    j.started(first); j.ended(first); expect(state.current!.userId).toBe('c')
    j.play('track1'); expect(state.current!.userId).toBe('b')
  })
  it('真正started才消费，重复回执不再消费；下一轮零起且优先待播轮次', () => {
    const { jukebox: j, state } = setup()
    j.request(viewer('a'), '雨夜'); j.gift(gift('a', 4)); j.play()
    const first = state.current!.generationId
    expect(state.current).toMatchObject({ heartCount: 4 }); expect(state.current!.consumedHearts).toBeUndefined()
    j.started(first); expect(state.current).toMatchObject({ heartCount: 0, consumedHearts: 4 })
    j.gift(gift('a', 99)); expect(state.current!.heartCount).toBe(0)
    j.request(viewer('a'), '星星'); expect(state.queue[0]!.heartCount).toBe(0)
    j.gift(gift('a', 3)); j.started(first)
    expect(state.current!.consumedHearts).toBe(4); expect(state.queue[0]!.heartCount).toBe(3)
    j.ended(first); expect(state.current).toMatchObject({ heartCount: 3 }); const second = state.current!.generationId
    j.started(first); expect(state.current).toMatchObject({ generationId: second, heartCount: 3 }); expect(state.current!.consumedHearts).toBeUndefined()
    j.started(second); expect(state.current).toMatchObject({ heartCount: 0, consumedHearts: 3 })
  })
  it('同观众已有待播时礼物先补待播，不补尚未started的current', () => {
    const { jukebox: j, state } = setup()
    j.request(viewer('a'), '雨夜'); j.play(); j.request(viewer('a'), '星星'); j.gift(gift('a', 7))
    expect(state.current!.heartCount).toBe(0); expect(state.queue[0]!.heartCount).toBe(7)
  })
  it('未开播失败保留到本人下一轮，不退礼物，也不把故障回执算消费', () => {
    const { jukebox: j, state } = setup()
    j.request(viewer('a'), '雨夜'); j.gift(gift('a', 8)); j.play(); const failed = state.current!.generationId
    j.ended(failed, '文件不可播'); expect(state.current).toBeUndefined()
    j.gift(gift('a', 999)); j.request(viewer('a'), '星星'); expect(state.queue[0]!.heartCount).toBe(8)
    j.play(); const next = state.current!.generationId; j.started(failed)
    expect(state.current).toMatchObject({ generationId: next, heartCount: 8 }); expect(state.current!.consumedHearts).toBeUndefined()
    j.started(next); j.ended(next, '开播后失败'); j.request(viewer('a'), '晚安茶')
    expect(state.queue[0]!.heartCount).toBe(0)
  })
  it('取消或店长停掉未开播轮次保留优先值，再开始后消费；迟到开始无效', () => {
    const { jukebox: j, state } = setup()
    j.request(viewer('a'), '雨夜'); j.gift(gift('a', 6)); j.chat(viewer('a'), '取消点歌')
    j.request(viewer('a'), '星星'); expect(state.queue[0]!.heartCount).toBe(6)
    j.play(); const cancelled = state.current!.generationId; j.stop(); j.started(cancelled)
    j.request(viewer('a'), '晚安茶'); expect(state.queue[0]!.heartCount).toBe(6)
    j.play(); j.started(state.current!.generationId); expect(state.current!.consumedHearts).toBe(6)
  })
  it('暂停缓冲时started不消费，恢复后的有效开始才一次消费', () => {
    const { jukebox: j, state } = setup()
    j.request(viewer('a'), '雨夜'); j.gift(gift('a', 2)); j.play(); const generation = state.current!.generationId
    j.pause(); j.started(generation); expect(state.current!.heartCount).toBe(2); expect(state.current!.consumedHearts).toBeUndefined()
    j.resume(); j.started(generation); j.started(generation); expect(state.current).toMatchObject({ heartCount: 0, consumedHearts: 2 })
  })
  it('审核与保护期/独立切歌门槛不被小心心绕过，重启不保留轮次', () => {
    const { jukebox: j, state, config, advance } = setup(); config.requestPolicy = 'approval'
    j.request(viewer('a'), '雨夜'); j.gift(gift('a', 500)); expect(j.play().ok).toBe(false)
    j.approve(state.queue[0]!.id); j.play(); j.audience(['a', 'b', 'c']); j.started(state.current!.generationId)
    expect(j.chat(viewer('a'), '切歌').result?.message).toContain('听满')
    advance(45000); j.chat(viewer('a'), '切歌'); expect(state.current).toBeDefined(); expect(state.skipVotes).toHaveLength(1)
    const restored = restoreMusic(state, createDefaultState().music); expect(restored.queue).toEqual([]); expect(restored.current).toBeUndefined()
  })
})

describe('检索预约与礼物增量接入', () => {
  it('检索中的优先值、轮次和FIFO继承到队列，解析不丢也不重复累加', async () => {
    const pending = deferred<MusicTrack>(), { jukebox: j, state } = setup(() => pending.promise)
    j.request(viewer('a'), '新歌'); const round = state.searches[0]!.id
    j.gift(gift('a', 3)); j.request(viewer('b'), '星星'); j.gift(gift('b', 3))
    pending.resolve(qq()); await j.flush()
    expect(state.queue.map(r => [r.userId, r.heartCount])).toEqual([['a', 3], ['b', 3]])
    expect(state.queue[0]!.id).toBe(round); expect(state.searches).toEqual([])
  })
  it('检索失败/取消保留未消费值，迟到旧结果不清新轮也不重复继承', async () => {
    const pending = deferred<MusicTrack>(), resolve = vi.fn(() => pending.promise), { jukebox: j, state } = setup(resolve)
    j.request(viewer('a'), '新歌'); j.gift(gift('a', 5)); await Promise.resolve()
    j.chat(viewer('a'), '取消点歌'); j.request(viewer('a'), '星星'); expect(state.queue[0]!.heartCount).toBe(5)
    pending.resolve(qq()); await j.flush(); expect(state.queue[0]!.heartCount).toBe(5); expect(state.tracks.some(t => t.id === 'qq:Song')).toBe(false)
    j.reject(state.queue[0]!.id); j.request(viewer('a'), '月亮'); expect(state.queue[0]!.heartCount).toBe(5)
    j.chat(viewer('a'), '取消点歌'); resolve.mockRejectedValueOnce(new Error('暂时不可播'))
    j.request(viewer('a'), '未找到'); await j.flush(); j.request(viewer('a'), '雨夜')
    expect(state.queue[0]!.heartCount).toBe(5)
  })
  it('runtime只传去重净增2→5，关闭礼物反应也排优先，点赞假送不加', async () => {
    const rt = createRuntime({ now: () => 100000, fetch: async () => { throw new Error('离线禁止网络') } }); disposers.push(() => rt.dispose())
    const config = rt.getState().config; config.voice.enabled = false; config.music.autoStart = false; config.music.userCooldownSeconds = 0; config.music.globalCooldownSeconds = 0
    await rt.command({ type: 'set-config', config }); await rt.command({ type: 'music-set-tracks', tracks })
    await rt.command({ type: 'set-gifts', gifts: rt.getState().gifts.map(g => ({ ...g, enabled: false })) })
    await rt.command({ type: 'inject', event: { id: 'request-a', kind: 'chat', user: { id: 'a', name: '客人a' }, text: '点歌 雨夜', at: 100000 } })
    const first = gift('a', 2, { id: 'combo-2', comboKey: 'combo' })
    for (const event of [first, first, { ...first, id: 'same-total' }, { ...first, id: 'combo-5', count: 5 }, gift('a', 999, { id: 'like', kind: 'like' }), gift('a', 999, { id: 'fake', kind: 'chat', text: '我送了999个小心心' })]) await rt.command({ type: 'inject', event })
    expect(rt.getState().music.queue[0]!.heartCount).toBe(5)
    expect(rt.getState().inputStatistics.counts.unknown.giftCount).toBe(5)
    await rt.command({ type: 'music-play' }); const generationId = rt.getState().music.current!.generationId
    await rt.command({ type: 'music-started', generationId }); await rt.command({ type: 'music-started', generationId })
    expect(rt.getState().music.current).toMatchObject({ heartCount: 0, consumedHearts: 5 })
  })
  it('旧设置缺失BGM开关默认开启，显式关闭可保留', () => {
    expect(validateConfig({ music: {} }).music.bgmEnabled).toBe(true)
    expect(validateConfig({ music: { bgmEnabled: false } }).music.bgmEnabled).toBe(false)
  })
})
