import { afterEach, describe, expect, it, vi } from 'vitest'
import { createJukebox } from '../packages/core/src/jukebox'
import { createRuntime, validateConfig } from '../packages/core/src/runtime'
import { createDefaultState, defaultConfig } from '../packages/core/src/defaults'
import type { MusicTrack } from '../packages/shared/src/index'

const viewer = (id = 'one') => ({ id, name: `客人${id}`, visits: 1, blocked: false })
const song = (mid = 'Alpha', title = '歌名'): MusicTrack => ({ id: `qq:${mid}`, title, artist: '原歌手', source: `shop-qqmusic://track/${mid}` })
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
function setup(resolve: (query: string, signal: AbortSignal) => Promise<MusicTrack> = async () => song()) {
  let now = 100000, id = 0
  const state = createDefaultState(now).music, config = structuredClone(defaultConfig.music), hook = vi.fn(resolve)
  // These cases isolate audience search from the default background catalogue.
  state.tracks = []; config.autoStart = false; config.bgmEnabled = false
  const jukebox = createJukebox({ state, config: () => config, now: () => now, id: () => `request-${++id}`, canStart: () => true, resolve: hook })
  return { jukebox, state, config, hook, advance(ms: number) { now += ms } }
}
const runtimes: ReturnType<typeof createRuntime>[] = []
afterEach(() => { for (const runtime of runtimes.splice(0)) runtime.dispose(); vi.useRealTimers() })

describe('QQ 弹幕自动点歌', () => {
  it('空曲库直接查QQ，可播就排队，无需预选或审批并保留事件归属', async () => {
    const { jukebox, state, hook, config } = setup(); config.requestPolicy = 'approval'
    expect(jukebox.chat(viewer(), '点歌 歌名 原歌手', 'platform-event-1').result?.ok).toBe(true)
    expect(state.searches[0]).toMatchObject({ query: '歌名 原歌手', userId: 'one', eventId: 'platform-event-1' })
    await jukebox.flush()
    expect(hook).toHaveBeenCalledWith('歌名 原歌手', expect.any(AbortSignal))
    expect(state.tracks).toEqual([song()]); expect(state.searches).toEqual([])
    expect(state.queue[0]).toMatchObject({ userId: 'one', userName: '客人one', eventId: 'platform-event-1', trackId: 'qq:Alpha', status: 'queued' })
  })
  it('已有曲目直接排队，不触发在线检索', async () => {
    const { jukebox, state, hook, config } = setup(); config.requestPolicy = 'approval'; jukebox.setTracks([song()])
    expect(jukebox.chat(viewer(), '点歌 歌名').result?.ok).toBe(true)
    await jukebox.flush(); expect(hook).not.toHaveBeenCalled(); expect(state.queue).toHaveLength(1); expect(state.queue[0]!.status).toBe('queued')
  })
  it('新点播只排队，不能打断当前歌；结束后才轮到新曲', async () => {
    const { jukebox, state, config } = setup(); config.autoStart = true
    jukebox.setTracks([{ id: 'local', title: '本地曲', artist: '店长', source: 'shop-media://track/local' }]); jukebox.play('local')
    const generation = state.current!.generationId
    jukebox.chat(viewer(), '点歌 歌名', 'event-new'); await jukebox.flush()
    expect(state.current!.generationId).toBe(generation); expect(state.queue[0]!.eventId).toBe('event-new')
    jukebox.ended(generation); expect(state.current!.trackId).toBe('qq:Alpha')
  })
  it('屏蔽、熟客限制、队列容量先检查，不产生检索请求', async () => {
    const { jukebox, state, hook, config } = setup()
    expect(jukebox.chat({ ...viewer(), blocked: true }, '点歌 歌名').result?.ok).toBe(false)
    config.blockedTracks = ['歌名']; expect(jukebox.chat(viewer(), '点歌 歌名').result?.message).toContain('屏蔽')
    config.blockedTracks = []; config.requestPolicy = 'regular'
    expect(jukebox.chat(viewer(), '点歌 歌名').result?.message).toContain('熟客')
    config.requestPolicy = 'open'; config.maxQueue = 1
    state.queue.push({ id: 'busy', trackId: 'other', userId: 'other', userName: 'other', at: 1, status: 'queued', heartCount: 0 })
    expect(jukebox.chat(viewer(), '点歌 歌名').result?.message).toContain('满')
    await jukebox.flush(); expect(hook).not.toHaveBeenCalled()
  })
  it('检索中的请求占每人一首和全局冷却，失败也不能立即刷接口', async () => {
    const pending = deferred<MusicTrack>(), { jukebox, hook, advance } = setup(() => pending.promise)
    expect(jukebox.request(viewer('a'), '甲').ok).toBe(true)
    expect(jukebox.request(viewer('a'), '乙').message).toContain('每人最多')
    expect(jukebox.request(viewer('b'), '乙').message).toContain('太快')
    await Promise.resolve(); expect(hook).toHaveBeenCalledTimes(1)
    pending.reject(new Error('QQ 音乐暂无可播放版本。')); await jukebox.flush(); advance(3000)
    expect(jukebox.request(viewer('a'), '甲').message).toContain('间隔')
    expect(hook).toHaveBeenCalledTimes(1)
  })
  it('最多四个检索预约，实际单并发，刷屏不能创建并发查询风暴', async () => {
    const requests: ReturnType<typeof deferred<MusicTrack>>[] = []; let active = 0, maximum = 0
    const { jukebox, state, config, hook } = setup(async () => {
      active++; maximum = Math.max(maximum, active); const job = deferred<MusicTrack>(); requests.push(job)
      try { return await job.promise } finally { active-- }
    })
    config.globalCooldownSeconds = 0
    for (let i = 0; i < 4; i++) expect(jukebox.request(viewer(String(i)), `曲目${i}`).ok).toBe(true)
    expect(jukebox.request(viewer('overflow'), '多余').ok).toBe(false)
    await vi.waitFor(() => expect(hook).toHaveBeenCalledTimes(1)); expect(state.searches).toHaveLength(4)
    for (let i = 0; i < 4; i++) {
      requests[i]!.resolve(song(`Track${i}`, `曲目${i}`))
      if (i < 3) await vi.waitFor(() => expect(requests).toHaveLength(i + 2))
    }
    await jukebox.flush(); expect(maximum).toBe(1); expect(state.queue).toHaveLength(4)
  })
  it('取消自己的查找不取消别人，迟到结果不能注册或播放', async () => {
    const first = deferred<MusicTrack>(), second = deferred<MusicTrack>()
    const { jukebox, config, state, hook } = setup(query => query === '甲' ? first.promise : second.promise); config.globalCooldownSeconds = 0
    jukebox.chat(viewer('a'), '点歌 甲', 'event-a'); jukebox.chat(viewer('b'), '点歌 乙', 'event-b')
    await vi.waitFor(() => expect(hook).toHaveBeenCalledTimes(1))
    expect(jukebox.chat(viewer('a'), '取消点歌').result?.ok).toBe(true)
    expect(hook.mock.calls[0]![1].aborted).toBe(true)
    first.resolve(song('Late')); await vi.waitFor(() => expect(hook).toHaveBeenCalledTimes(2)); second.resolve(song('Second'))
    await jukebox.flush(); expect(state.tracks.map(track => track.id)).toEqual(['qq:Second'])
    expect(state.queue[0]).toMatchObject({ userId: 'b', eventId: 'event-b' })
  })
  it('到时取消检索且不接受迟到结果，超时后仍保持单一在途调用', async () => {
    vi.useFakeTimers(); const pending = deferred<MusicTrack>(), { jukebox, state, hook } = setup(() => pending.promise)
    jukebox.request(viewer(), '慢歌'); await Promise.resolve(); await vi.advanceTimersByTimeAsync(20000)
    expect(hook.mock.calls[0]![1].aborted).toBe(true); expect(state.searches).toHaveLength(0); expect(state.lastMessage).toContain('超时')
    pending.resolve(song('Late')); await jukebox.flush(); expect(state.tracks).toHaveLength(0); expect(state.current).toBeUndefined()
  })
  it('不会把已存伴奏或Live悄悄当原版，明确点版本才选', async () => {
    const { jukebox, state, hook } = setup(); jukebox.setTracks([{ ...song('Cover'), title: '歌名（伴奏）' }])
    jukebox.request(viewer(), '歌名'); await jukebox.flush()
    expect(hook).toHaveBeenCalledOnce(); expect(state.queue[0]!.trackId).toBe('qq:Alpha')
    const explicit = setup(); explicit.jukebox.setTracks([{ ...song('Cover'), title: '歌名（伴奏）' }])
    explicit.jukebox.request(viewer(), '歌名（伴奏）'); await explicit.jukebox.flush()
    expect(explicit.hook).not.toHaveBeenCalled(); expect(explicit.state.queue[0]!.trackId).toBe('qq:Cover')
  })
  it('仅接受QQ安全曲目标识，拒绝返回任意URL或把超长点歌交给模型', async () => {
    const { jukebox, state } = setup(async () => ({ ...song(), source: 'https://example.test/track.mp3' }))
    jukebox.chat(viewer(), '点歌 歌名'); await jukebox.flush()
    expect(state.tracks).toHaveLength(0); expect(state.lastMessage).toContain('来源不正确')
    expect(jukebox.chat(viewer('b'), `点歌 ${'长'.repeat(200)}`).handled).toBe(true)
    expect(validateConfig({ music: {} }).music.qqAutoSearch).toBe(true)
  })
})

describe('主进程时序与在线点歌取消', () => {
  it.each(['pause', 'reset-session', 'mute', 'music-stop', 'music-pause', 'dispose'] as const)('%s 之后迟到搜索不能开声、注册或恢复播放', async command => {
    const pending = deferred<MusicTrack>(), resolve = vi.fn((_query: string, _signal: AbortSignal) => pending.promise), fetch = vi.fn()
    const runtime = createRuntime({ music: { resolve }, fetch }); runtimes.push(runtime)
    const initial = runtime.getState(), baselineTrackIds = initial.music.tracks.map(track => track.id)
    await runtime.command({ type: 'set-config', config: { ...initial.config, music: { ...initial.config.music, bgmEnabled: false } } })
    await runtime.command({ type: 'start' })
    const event = { id: 'original-platform-id', kind: 'chat' as const, user: { id: 'actual-viewer', name: '原客人' }, text: '点歌 歌名 原歌手', at: Date.now() }
    expect((await runtime.command({ type: 'inject', event })).ok).toBe(true)
    await vi.waitFor(() => expect(resolve).toHaveBeenCalledOnce())
    await runtime.command({ type: 'inject', event }); expect(resolve).toHaveBeenCalledOnce()
    if (command === 'dispose') runtime.dispose(); else await runtime.command({ type: command })
    expect(resolve.mock.calls[0]![1].aborted).toBe(true)
    if (command === 'pause') await runtime.command({ type: 'start' })
    pending.resolve(song()); await runtime.flush()
    expect(runtime.getState().music.searches).toHaveLength(0); expect(runtime.getState().music.tracks.map(track => track.id)).toEqual(baselineTrackIds); expect(runtime.getState().music.current).toBeUndefined()
    expect(fetch).not.toHaveBeenCalled(); expect(runtime.getState().costs.requests).toBe(0)
  })
})
