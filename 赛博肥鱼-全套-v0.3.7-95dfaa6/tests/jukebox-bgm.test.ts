import { afterEach, describe, expect, it, vi } from 'vitest'
import { createJukebox, restoreMusic, validateTracks } from '../packages/core/src/jukebox'
import { DEFAULT_BGM_TRACKS } from '../packages/core/src/music-defaults'
import { createDefaultState, defaultConfig } from '../packages/core/src/defaults'
import { createRuntime, validateConfig } from '../packages/core/src/runtime'
import type { LiveEvent, MusicTrack } from '../packages/shared/src'

const local: MusicTrack = { id: 'local-song', title: '观众点歌', artist: '测试', source: 'shop-media://track/local' }
const second: MusicTrack = { id: 'local-second', title: '另一首', artist: '测试', source: 'shop-media://track/second' }
const viewer = (id = 'a') => ({ id, name: `客人${id}`, visits: 3, blocked: false })
const gift = (userId = 'a', count = 5): LiveEvent => ({ id: `gift-${userId}`, kind: 'gift', giftId: 'heart', giftName: '小心心', count, user: viewer(userId), at: 1000 })
const disposers: (() => void)[] = []
afterEach(() => disposers.splice(0).forEach(dispose => dispose()))
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const online: MusicTrack = { id: 'qq:AudienceSong', title: '观众在线歌', artist: '歌手', source: 'shop-qqmusic://track/AudienceSong' }
function setup(resolve?: (query: string, signal: AbortSignal) => Promise<MusicTrack>) {
  const state = createDefaultState(1000).music, config = structuredClone(defaultConfig.music)
  config.globalCooldownSeconds = 0; config.userCooldownSeconds = 0
  let ids = 0, at = 1000, canStart = true
  const j = createJukebox({ state, config: () => config, now: () => at, id: () => `bgm-${++ids}`, canStart: () => canStart, resolve })
  j.setTracks([...DEFAULT_BGM_TRACKS, local, second]); disposers.push(() => j.dispose())
  return { state, config, j, ids: () => ids, advance(ms: number) { at += ms }, allow(value: boolean) { canStart = value } }
}

describe('用户选择的QQ背景歌单', () => {
  it('默认QQ歌单元数据按指定顺序，旧曲库保留并补入，不恢复播放状态', () => {
    expect(DEFAULT_BGM_TRACKS.map(track => track.id)).toEqual(['qq:003eSmBj1FaFRE', 'qq:003NpbMs1qMVr1', 'qq:003QdbX71sFUz3', 'qq:0037yEv437QIeZ'])
    expect(DEFAULT_BGM_TRACKS.map(track => track.duration)).toEqual([201, 183, 94, 244])
    expect(validateConfig({ music: {} }).music.bgmTrackIds).toEqual(DEFAULT_BGM_TRACKS.map(track => track.id))
    expect(validateConfig({ music: { bgmTrackIds: [] } }).music.bgmTrackIds).toEqual([])
    const restored = restoreMusic({ tracks: [local, DEFAULT_BGM_TRACKS[1]], current: { isBgm: true }, bgmError: '旧错误' }, createDefaultState().music)
    expect(restored.tracks.map(track => track.id)).toEqual([local.id, DEFAULT_BGM_TRACKS[1]!.id, ...DEFAULT_BGM_TRACKS.filter((_, index) => index !== 1).map(track => track.id)])
    expect(restored.current).toBeUndefined(); expect(restored.bgmError).toBeUndefined(); expect(restored.status).toBe('stopped')
    const full = Array.from({ length: 500 }, (_, index) => ({ ...local, id: `old-${index}` }))
    const once = restoreMusic({ tracks: full }, createDefaultState().music)
    expect(once.tracks).toHaveLength(500 + DEFAULT_BGM_TRACKS.length); expect(validateTracks(once.tracks)).toHaveLength(500 + DEFAULT_BGM_TRACKS.length)
    expect(restoreMusic(once, createDefaultState().music).tracks).toEqual(once.tracks)
  })
  it('无人点歌顺序循环默认QQ歌单，背景不占队列，迟到回执不推进新曲', () => {
    const { state, j } = setup(); j.maybeStart()
    const first = state.current!.generationId
    expect(state.current).toMatchObject({ trackId: DEFAULT_BGM_TRACKS[0]!.id, isBgm: true, heartCount: 0 }); expect(state.queue).toEqual([])
    j.started(first); expect(state.current!.consumedHearts).toBeUndefined()
    j.ended(first); const secondGeneration = state.current!.generationId
    expect(state.current!.trackId).toBe(DEFAULT_BGM_TRACKS[1]!.id)
    j.ended(first); j.started(first); expect(state.current!.generationId).toBe(secondGeneration)
    for (let index = 1; index < DEFAULT_BGM_TRACKS.length; index++) { expect(state.current!.trackId).toBe(DEFAULT_BGM_TRACKS[index]!.id); j.started(state.current!.generationId); j.ended(state.current!.generationId) }
    expect(state.current!.trackId).toBe(DEFAULT_BGM_TRACKS[0]!.id)
    expect(state.queue).toEqual([])
  })
  it('可播观众歌立即让背景让位，观众歌不中途抢，播完恢复背景顺序', () => {
    const { state, j } = setup(); j.maybeStart(); const background = state.current!.generationId; j.started(background)
    j.request(viewer('a'), local.title); const audience = state.current!.generationId
    expect(state.current).toMatchObject({ trackId: local.id, userId: 'a', heartCount: 0 }); expect(state.current!.isBgm).toBeUndefined()
    j.request(viewer('b'), second.title); j.gift(gift('b', 99)); expect(state.current!.generationId).toBe(audience)
    j.started(background); expect(state.current!.startedAt).toBeUndefined(); expect(state.queue[0]!.heartCount).toBe(99)
    j.started(audience); j.ended(audience); expect(state.current!.trackId).toBe(second.id)
    j.started(state.current!.generationId); expect(state.current!.consumedHearts).toBe(99)
    j.ended(state.current!.generationId); expect(state.current).toMatchObject({ isBgm: true, trackId: DEFAULT_BGM_TRACKS[1]!.id })
  })
  it('观众可明确点播当前背景同一首，成为自己的轮次而非被重复歌曲拒绝', () => {
    const { state, j } = setup(); j.maybeStart()
    expect(j.request(viewer(), DEFAULT_BGM_TRACKS[0]!.title).ok).toBe(true)
    expect(state.current).toMatchObject({ userId: 'a', trackId: DEFAULT_BGM_TRACKS[0]!.id }); expect(state.current!.isBgm).toBeUndefined()
  })
  it('店长关闭自动播放后，观众排队时背景立即安静，需店长显式播放', () => {
    const { state, j, config } = setup(); config.autoStart = false; j.maybeStart(); const background = state.current!.generationId
    expect(j.request(viewer(), local.title).ok).toBe(true)
    expect(state.current).toBeUndefined(); expect(state.queue[0]!.trackId).toBe(local.id)
    j.started(background); j.ended(background); j.maybeStart(); expect(state.current).toBeUndefined()
    expect(j.play().ok).toBe(true); expect(state.current!.trackId).toBe(local.id); expect(state.current!.isBgm).toBeUndefined()
  })
  it('待审批时背景安静，迟到背景开始不消费观众小心心，审批后正常消费', () => {
    const { state, j, config } = setup(); config.requestPolicy = 'approval'; j.maybeStart(); const background = state.current!.generationId
    j.request(viewer(), local.title); j.gift(gift())
    j.started(background); expect(state.current).toBeUndefined(); expect(state.queue[0]!.heartCount).toBe(5)
    expect(j.gift(gift('__bgm__', 99))).toBe(false)
    j.approve(state.queue[0]!.id); expect(state.current!.trackId).toBe(local.id)
    j.started(state.current!.generationId); expect(state.current).toMatchObject({ heartCount: 0, consumedHearts: 5 })
  })
  it('背景自己不使用个人冷却；观众歌曲保护时间和切歌独立人数保持', () => {
    const { state, j, advance } = setup(); j.maybeStart(); j.started(state.current!.generationId)
    expect(j.request(viewer(), local.title).ok).toBe(true)
    j.audience(['a', 'b', 'c']); j.started(state.current!.generationId)
    expect(j.chat(viewer('a'), '切歌').result?.message).toContain('听满')
    advance(45000); j.chat(viewer('a'), '切歌'); expect(state.current!.isBgm).toBeUndefined(); expect(state.skipVotes).toHaveLength(1)
    j.chat(viewer('b'), '切歌'); expect(state.current!.isBgm).toBeUndefined()
    j.chat(viewer('c'), '切歌'); expect(state.current!.isBgm).toBe(true)
  })
  it('失败每首最多自动试一次，全失败后反复maybeStart和开始营业不制造请求风暴', () => {
    const { state, j, ids } = setup(); j.maybeStart()
    for (const track of DEFAULT_BGM_TRACKS) {
      expect(state.current!.trackId).toBe(track.id)
      j.ended(state.current!.generationId, '离线模拟无播放权限')
    }
    expect(state.current).toBeUndefined(); expect(state.status).toBe('stopped'); expect(state.bgmError).toContain('QQ 背景曲')
    const attempts = ids()
    for (let n = 0; n < 20; n++) { j.maybeStart(); j.activate() }
    expect(ids()).toBe(attempts); expect(state.current).toBeUndefined()
    expect(state.lastMessage).toContain('本次运行已暂停该曲自动重试')
  })
  it('重新开启或店长显式重试能重新尝试，普通设置保存不解除失败挂起', () => {
    const { state, j, config } = setup(); j.maybeStart()
    for (let n = 0; n < DEFAULT_BGM_TRACKS.length; n++) j.ended(state.current!.generationId, '不可播')
    config.globalCooldownSeconds = 3; j.configurationChanged(); j.maybeStart(); expect(state.current).toBeUndefined()
    config.bgmEnabled = false; j.configurationChanged(); config.bgmEnabled = true; j.configurationChanged()
    expect(state.current!.trackId).toBe(DEFAULT_BGM_TRACKS[0]!.id); expect(state.bgmError).toBeUndefined()
    j.ended(state.current!.generationId, '仍不可播'); expect(state.current!.trackId).toBe(DEFAULT_BGM_TRACKS[1]!.id)
    expect(j.play(DEFAULT_BGM_TRACKS[0]!.id).ok).toBe(true); expect(state.current).toMatchObject({ trackId: DEFAULT_BGM_TRACKS[0]!.id, isBgm: true })
  })
  it('音乐stop与暂停不会自行恢复；显式开始营业或重新启用才能恢复背景', () => {
    const { state, j } = setup(); j.maybeStart(); const old = state.current!.generationId
    j.stop(); for (let n = 0; n < 3; n++) j.maybeStart(); j.started(old); j.ended(old)
    expect(state.current).toBeUndefined(); j.activate(); expect(state.current!.isBgm).toBe(true)
    const generation = state.current!.generationId; j.pause(); j.ended(generation); j.maybeStart()
    expect(state.status).toBe('paused'); expect(state.current!.generationId).toBe(generation)
  })
  it('空列表、BGM关闭、点歌台关闭或无法送音均不自动启动', () => {
    const { state, j, config, allow } = setup()
    config.bgmTrackIds = []; j.configurationChanged(); j.maybeStart(); expect(state.current).toBeUndefined()
    config.bgmTrackIds = DEFAULT_BGM_TRACKS.map(track => track.id); config.bgmEnabled = false; j.configurationChanged(); expect(state.current).toBeUndefined()
    config.bgmEnabled = true; config.enabled = false; j.configurationChanged(); expect(state.current).toBeUndefined()
    config.enabled = true; allow(false); j.configurationChanged(); j.maybeStart(); expect(state.current).toBeUndefined()
  })
  it('真实runtime紧急静音后设置保存/取消静音不自启，需店长再次开始营业', async () => {
    const fetch = vi.fn(async () => { throw new Error('离线测试禁止网络') })
    const rt = createRuntime({ fetch }); disposers.push(() => rt.dispose())
    await rt.command({ type: 'start' }); expect(rt.getState().music.current!.isBgm).toBe(true)
    await rt.command({ type: 'mute' }); await rt.command({ type: 'set-config', config: rt.getState().config }); await rt.command({ type: 'unmute' })
    expect(rt.getState().music.current).toBeUndefined(); await rt.command({ type: 'start' }); expect(rt.getState().music.current!.isBgm).toBe(true)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('在线检索一预约就停止背景，失败后恢复背景且保留未消费优先值', async () => {
    const pending = deferred<MusicTrack>(), { state, j } = setup(() => pending.promise)
    j.maybeStart(); const background = state.current!.generationId
    expect(j.request(viewer(), '在线新歌').ok).toBe(true)
    expect(state.searches).toHaveLength(1); expect(state.current).toBeUndefined()
    j.started(background); j.ended(background); j.maybeStart(); expect(state.current).toBeUndefined()
    j.gift(gift('a', 7)); pending.reject(new Error('QQ音乐本次未找到可播曲目')); await j.flush()
    expect(state.current!.isBgm).toBe(true); expect(state.searches).toEqual([]); expect(state.lastMessage).toContain('未找到可播曲目')
    j.request(viewer(), local.title); expect(state.current).toMatchObject({ trackId: local.id, heartCount: 7 }); expect(state.current!.isBgm).toBeUndefined()
  })
  it('在线检索成功开始观众轮次，检索不能打断已经播放的观众歌', async () => {
    const pending = deferred<MusicTrack>(), { state, j } = setup(() => pending.promise)
    j.maybeStart(); j.request(viewer(), '在线新歌'); expect(state.current).toBeUndefined()
    pending.resolve(online); await j.flush(); expect(state.current).toMatchObject({ trackId: online.id, userId: 'a' }); expect(state.current!.isBgm).toBeUndefined()
    const current = state.current!.generationId; j.started(current)
    j.request(viewer('b'), '另一首在线新歌'); expect(state.current!.generationId).toBe(current)
    await j.flush(); expect(state.current!.generationId).toBe(current)
  })
  it('正常取消最后一条检索或待审批后才恢复背景，旧检索迟到不重复恢复', async () => {
    const pending = deferred<MusicTrack>(), { state, j, config } = setup(() => pending.promise)
    j.maybeStart(); j.request(viewer(), '在线新歌'); await Promise.resolve(); expect(state.current).toBeUndefined()
    j.chat(viewer(), '取消点歌'); expect(state.current!.isBgm).toBe(true); const resumed = state.current!.generationId
    pending.resolve(online); await j.flush(); expect(state.current!.generationId).toBe(resumed)
    config.requestPolicy = 'approval'; j.request(viewer(), local.title); expect(state.current).toBeUndefined()
    j.reject(state.queue[0]!.id); expect(state.current!.isBgm).toBe(true)
  })
  it.each(['pause', 'stop'] as const)('%s取消检索后，finally和迟到结果不能短暂启动背景', async action => {
    const pending = deferred<MusicTrack>(), { state, j, ids } = setup(() => pending.promise)
    j.maybeStart(); j.request(viewer(), '在线新歌'); await Promise.resolve(); expect(state.current).toBeUndefined()
    j[action](); const before = ids(); pending.resolve(online); await j.flush(); j.maybeStart()
    expect(ids()).toBe(before); expect(state.current).toBeUndefined(); expect(state.searches).toEqual([])
  })
  it.each(['pause', 'mute', 'music-stop', 'music-pause'] as const)('runtime %s取消搜索，直到迟到回执结束都不重开QQ背景', async action => {
    const pending = deferred<MusicTrack>(), resolve = vi.fn(() => pending.promise), fetch = vi.fn(async () => { throw new Error('离线禁止网络') })
    const rt = createRuntime({ music: { resolve }, fetch }); disposers.push(() => rt.dispose())
    await rt.command({ type: 'start' }); await rt.command({ type: 'inject', event: { id: 'online-request', kind: 'chat', user: viewer(), text: '点歌 在线新歌', at: Date.now() } }); await Promise.resolve()
    expect(rt.getState().music.current).toBeUndefined(); expect(resolve).toHaveBeenCalledOnce()
    const snapshots: boolean[] = [], unsubscribe = rt.subscribe(state => snapshots.push(!!state.music.current?.isBgm))
    await rt.command({ type: action }); pending.resolve(online); await rt.flush(); unsubscribe()
    expect(snapshots.some(Boolean)).toBe(false); expect(rt.getState().music.current).toBeUndefined(); expect(fetch).not.toHaveBeenCalled()
  })
})
