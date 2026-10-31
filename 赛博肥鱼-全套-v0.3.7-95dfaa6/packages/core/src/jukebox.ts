import type { AppConfig, CommandResult, LiveEvent, MusicRequest, MusicSearchRequest, MusicState, MusicTrack, Viewer } from '../../shared/src/index'
import { DEFAULT_BGM_TRACKS } from './music-defaults'
import { MUSIC_LIBRARY_LIMIT } from '../../shared/src/music-limits'
import { musicMatchScore, normalizeMusicText } from './music-match'

const compact = (value: unknown, max: number) => typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, '').trim().slice(0, max) : ''
const normalized = normalizeMusicText
const defaultIds = new Set(DEFAULT_BGM_TRACKS.map(track => track.id))
export const musicLibraryFull = (tracks: Pick<MusicTrack, 'id'>[]) => tracks.filter(track => !defaultIds.has(track.id)).length >= MUSIC_LIBRARY_LIMIT
const failure = (message: string): CommandResult => ({ ok: false, message })

/** Sources are imported by the owner or a trusted QQ resolver; chat never supplies an audio URL. */
export function validateTracks(input: unknown): MusicTrack[] {
  if (!Array.isArray(input)) throw new Error('曲库格式不正确。')
  if (input.length > MUSIC_LIBRARY_LIMIT + defaultIds.size || input.filter(item => !defaultIds.has(item?.id)).length > MUSIC_LIBRARY_LIMIT) throw new Error(`曲库最多保存 ${MUSIC_LIBRARY_LIMIT} 首自选歌曲和 ${defaultIds.size} 首默认背景曲。`)
  const ids = new Set<string>()
  return input.map(item => {
    if (!item || typeof item !== 'object') throw new Error('歌曲资料不完整。')
    const id = compact(item.id, 100), title = compact(item.title, 100), artist = compact(item.artist, 100), source = compact(item.source, 2000)
    if (!id || !title || ids.has(id)) throw new Error('歌曲编号和歌名不能为空，编号不能重复。')
    let url: URL
    try { url = new URL(source) } catch { throw new Error('歌曲来源需要本机导入，或填写完整 HTTPS 音频地址。') }
    const local = /^shop-media:\/\/track\/[a-zA-Z0-9_-]+$/.test(source) && url.protocol === 'shop-media:' && url.hostname === 'track'
    const qq = /^shop-qqmusic:\/\/track\/[a-zA-Z0-9]{1,64}$/.test(source) && url.protocol === 'shop-qqmusic:' && url.hostname === 'track'
    if ((!local && !qq && url.protocol !== 'https:') || url.username || url.password) throw new Error('歌曲只支持本机安全导入、QQ 音乐曲目或 HTTPS 地址，不能填写任意本地路径。')
    ids.add(id)
    return { id, title, artist, source, ...(typeof item.duration === 'number' && Number.isFinite(item.duration) && item.duration > 0 && item.duration <= 14400 ? { duration: item.duration } : {}) }
  })
}

export function restoreMusic(stored: unknown, fallback: MusicState): MusicState {
  const next = { ...fallback, tracks: [] as MusicTrack[], queue: [] as MusicRequest[], searches: [] as MusicSearchRequest[], current: undefined, bgmError: undefined, status: 'stopped' as const, skipVotes: [] }
  if (stored && typeof stored === 'object' && 'tracks' in stored) {
    try { next.tracks = validateTracks(stored.tracks) } catch { /* A bad imported playlist must not stop the rest of the shop. */ }
  }
  for (const track of DEFAULT_BGM_TRACKS) if (!next.tracks.some(item => item.id === track.id)) next.tracks.push({ ...track })
  // Requests/playing state are deliberately ephemeral: a restart never resumes unattended sound.
  return next
}

export function createJukebox(options: {
  state: MusicState
  config: () => AppConfig['music']
  now: () => number
  id: () => string
  canStart: () => boolean
  resolve?: (query: string, signal: AbortSignal) => Promise<MusicTrack>
  viewer?: (id: string) => Pick<Viewer, 'id' | 'name' | 'visits' | 'blocked'> | undefined
  onChange?: () => void
}) {
  const state = options.state
  const cooldowns = new Map<string, number>()
  // Ephemeral song priority only, never a gift refund or a wallet balance.
  const unspentHearts = new Map<string, number>(), roundOrder = new Map<string, number>()
  let nextRoundOrder = 0
  let globalRequestedAt: number | undefined
  let lastRejectedNoticeAt: number | undefined
  let activeUsers = new Set<string>()
  let pausedAt: number | undefined, pausedMs = 0
  type SearchJob = { request: MusicSearchRequest; viewer: Pick<Viewer, 'id' | 'name' | 'visits' | 'blocked'>; controller: AbortController; resumeAfterCompletion: boolean; timer?: ReturnType<typeof setTimeout> }
  const searches = new Map<string, SearchJob>()
  let searchWorker: Promise<void> | undefined, searchDisposed = false
  const cfg = options.config
  const failedBgm = new Set<string>()
  let bgmStopped = false, nextBgmIndex = 0
  const bgmSignature = () => JSON.stringify([cfg().enabled, cfg().bgmEnabled, cfg().bgmTrackIds])
  let previousBgmSignature = bgmSignature()
  function notice(message: string) { state.lastMessage = message; state.messageAt = options.now() }
  function blocked(track: MusicTrack) {
    const fields = [normalized(track.id), normalized(track.title), normalized(`${track.title}${track.artist}`)]
    return cfg().blockedTracks.some(value => fields.includes(normalized(value)))
  }
  const hearts = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
  function order(request: MusicRequest | MusicSearchRequest) { if (!roundOrder.has(request.id)) roundOrder.set(request.id, ++nextRoundOrder) }
  function sortQueue() { state.queue.sort((a, b) => hearts(b.heartCount) - hearts(a.heartCount) || a.at - b.at || (roundOrder.get(a.id) ?? 0) - (roundOrder.get(b.id) ?? 0)) }
  function takeUnspent(userId: string) { const count = unspentHearts.get(userId) ?? 0; unspentHearts.delete(userId); return count }
  function priorityRound(userId: string, excluding?: string) {
    return state.queue.find(r => r.userId === userId && r.id !== excluding) || state.searches.find(r => r.userId === userId && r.id !== excluding) || (state.current?.userId === userId && !state.current.isBgm && state.current.id !== excluding && state.current.startedAt === undefined ? state.current : undefined)
  }
  function retainUnstarted(request: MusicRequest | MusicSearchRequest) {
    const count = hearts(request.heartCount); request.heartCount = 0
    if (count) {
      const next = priorityRound(request.userId, request.id)
      if (next) next.heartCount = Math.min(Number.MAX_SAFE_INTEGER, hearts(next.heartCount) + count)
      else {
        unspentHearts.set(request.userId, Math.min(Number.MAX_SAFE_INTEGER, (unspentHearts.get(request.userId) ?? 0) + count))
        while (unspentHearts.size > 5000) unspentHearts.delete(unspentHearts.keys().next().value!)
      }
      sortQueue()
    }
    roundOrder.delete(request.id)
  }
  function resetCurrent() {
    const previous = state.current
    state.current = undefined; state.status = 'stopped'; state.skipVotes = []; pausedAt = undefined; pausedMs = 0
    if (previous && !previous.isBgm) retainUnstarted(previous)
  }
  function begin(request: MusicRequest) {
    resetCurrent()
    request.heartCount = Math.min(Number.MAX_SAFE_INTEGER, hearts(request.heartCount) + takeUnspent(request.userId))
    state.current = { ...request, status: 'queued', generationId: options.id() }
    state.status = 'playing'; state.skipVotes = []; pausedAt = undefined; pausedMs = 0
    const track = state.tracks.find(t => t.id === request.trackId)!
    notice(`正在准备《${track.title}》 · ${request.userName}点播，歌曲真正开始播放后才消耗本轮优先值。`)
  }
  function beginBgm(preferred?: MusicTrack) {
    if (!preferred && (state.queue.length || state.searches.length || bgmStopped || !cfg().enabled || !cfg().bgmEnabled || !options.canStart())) return false
    const ids = cfg().bgmTrackIds
    if (!ids.length) return false
    let track = preferred
    if (!track) {
      for (let offset = 0; offset < ids.length; offset++) {
        const index = (nextBgmIndex + offset) % ids.length, id = ids[index]!
        const candidate = state.tracks.find(item => item.id === id)
        if (!candidate || blocked(candidate) || failedBgm.has(id)) continue
        track = candidate; nextBgmIndex = (index + 1) % ids.length; break
      }
    } else { failedBgm.delete(track.id); bgmStopped = false; state.bgmError = undefined; nextBgmIndex = (ids.indexOf(track.id) + 1) % ids.length }
    if (!track) {
      state.bgmError ||= '背景列表暂无可播放曲目；已失败的歌曲本次运行暂停重试，请检查 QQ 音乐连接后重新开启背景音乐或手动重试。'
      notice(state.bgmError); return false
    }
    resetCurrent()
    state.current = { id: options.id(), generationId: options.id(), trackId: track.id, userId: '__bgm__', userName: '背景音乐', at: options.now(), status: 'queued', heartCount: 0, isBgm: true }
    state.status = 'playing'
    notice(`正在准备${track.source.startsWith('shop-qqmusic:') ? ' QQ ' : ''}背景曲《${track.title}》；有人点歌或正在搜歌时就安静等待。`)
    return true
  }
  function playNext() {
    resetCurrent()
    sortQueue()
    const index = state.queue.findIndex(r => r.status === 'queued' && state.tracks.some(t => t.id === r.trackId && !blocked(t)))
    if (index < 0) return beginBgm()
    begin(state.queue.splice(index, 1)[0]!); return true
  }
  function maybeStart() {
    const paused = state.status === 'paused', waiting = state.queue.length > 0 || state.searches.length > 0
    if (state.current?.isBgm && waiting) { resetCurrent(); if (paused) state.status = 'paused' }
    if (paused || !options.canStart()) return
    const queued = state.queue.some(r => r.status === 'queued' && state.tracks.some(t => t.id === r.trackId && !blocked(t)))
    if (state.current) return
    if (queued) { if (cfg().autoStart) playNext(); return }
    if (waiting) return
    beginBgm()
  }
  function configurationChanged() {
    const signature = bgmSignature()
    if (signature === previousBgmSignature) return
    previousBgmSignature = signature; failedBgm.clear(); bgmStopped = false; state.bgmError = undefined
    nextBgmIndex = state.current?.isBgm ? (cfg().bgmTrackIds.indexOf(state.current.trackId) + 1) % Math.max(1, cfg().bgmTrackIds.length) : 0
    if (state.current?.isBgm && (!cfg().enabled || !cfg().bgmEnabled || !cfg().bgmTrackIds.includes(state.current.trackId))) resetCurrent()
    maybeStart()
  }
  function activate() { bgmStopped = false; if (state.status === 'paused' && !state.current) state.status = 'stopped'; configurationChanged(); maybeStart() }
  function retryBackground() {
    if(state.current||state.queue.length||state.searches.length||state.status==='paused'||!options.canStart()||!cfg().enabled||!cfg().bgmEnabled)return false
    failedBgm.clear();bgmStopped=false;state.bgmError=undefined
    return beginBgm()
  }
  function setTracks(input: unknown): CommandResult {
    const tracks = validateTracks(input)
    const oldCurrent = state.tracks.find(t => t.id === state.current?.trackId)
    const newCurrent = tracks.find(t => t.id === state.current?.trackId)
    state.tracks = tracks
    const removed = state.queue.filter(r => !tracks.some(t => t.id === r.trackId))
    state.queue = state.queue.filter(r => tracks.some(t => t.id === r.trackId))
    for (const request of removed) retainUnstarted(request)
    if (state.current && (!newCurrent || oldCurrent?.source !== newCurrent.source)) resetCurrent()
    return { ok: true, message: `曲库已保存，共 ${tracks.length} 首。` }
  }
  function audience(userIds: string[]) {
    activeUsers = new Set(userIds.slice(-5000))
    state.activeViewers = activeUsers.size
    state.skipRequired = Math.max(cfg().skipMinVotes, Math.ceil(activeUsers.size * cfg().skipRatio))
    state.skipVotes = state.skipVotes.filter(v => activeUsers.has(v.userId))
  }
  function findTrack(query: string) {
    const q = normalized(query)
    const versions = [/(?:live|现场|演唱会)/i, /(?:伴奏|伴唱|instrumental)/i, /(?:翻唱|cover)/i, /(?:remix|混音|dj版|加速版|铃声)/i]
    const candidates = state.tracks.filter(track => track.id === query || !versions.some(version => version.test(track.title) && !version.test(query)))
    const exact = candidates.filter(t => t.id === query || musicMatchScore(t, query) >= 0)
    if (exact.length === 1) return { track: exact[0] }
    if (exact.length > 1) return { message: '同名歌曲不止一首，请加上歌手名字再点。' }
    const fuzzy = candidates.filter(t => normalized(`${t.title}${t.artist}`).includes(q))
    if (fuzzy.length === 1) return { track: fuzzy[0] }
    return { message: fuzzy.length > 1 ? '找到多首相近歌曲，请填写更完整的歌名和歌手。' : '本地还没有这首歌。', missing: fuzzy.length === 0 }
  }
  function eligibility(viewer: Pick<Viewer, 'id' | 'name' | 'visits' | 'blocked'>, owner = false): CommandResult | undefined {
    if (viewer.blocked) return failure('已忽略屏蔽观众的点歌。')
    if (!cfg().enabled && !owner) return failure('点歌台暂时关闭，先听听店里正在放的歌吧。')
    if (!owner && cfg().requestPolicy === 'regular' && viewer.visits < 3) return failure('当前只接受熟客点歌，来过三场后就能加入。')
    if (!owner && (state.queue.some(r => r.userId === viewer.id) || state.searches.some(r => r.userId === viewer.id))) return failure('每人最多保留一首待播歌曲，先等上一首轮到。')
    if (state.queue.length + state.searches.length >= cfg().maxQueue) return failure('点歌队列已经满啦，听完几首再来。')
    const now = options.now(), last = cooldowns.get(viewer.id)
    if (!owner && last !== undefined && now - last < cfg().userCooldownSeconds * 1000) return failure(`点歌需要间隔 ${cfg().userCooldownSeconds} 秒，请稍后再来。`)
    if (!owner && globalRequestedAt !== undefined && now - globalRequestedAt < cfg().globalCooldownSeconds * 1000) return failure('大家点得太快啦，等几秒再试。')
  }
  function consume(viewer: Pick<Viewer, 'id'>, owner: boolean) {
    const now = options.now()
    if (!owner) { cooldowns.set(viewer.id, now); globalRequestedAt = now }
    while (cooldowns.size > 5000) cooldowns.delete(cooldowns.keys().next().value!)
  }
  function enqueue(track: MusicTrack, viewer: Pick<Viewer, 'id' | 'name'>, owner: boolean, original: { id?: string; eventId?: string; at?: number; heartCount?: number } = {}, automatic = false): CommandResult {
    if (blocked(track)) return failure('这首歌已被店长暂时屏蔽。')
    if (state.current?.trackId === track.id && !state.current.isBgm || state.queue.some(r => r.trackId === track.id)) return failure('这首歌已经在播放或队列里啦，不用重复点。')
    const status = !owner && !automatic && cfg().requestPolicy === 'approval' ? 'pending' : 'queued'
    const request: MusicRequest = { id: original.id || options.id(), trackId: track.id, userId: viewer.id, userName: viewer.name, ...(original.eventId ? { eventId: original.eventId } : {}), at: original.at ?? options.now(), status, heartCount: original.heartCount === undefined ? takeUnspent(viewer.id) : hearts(original.heartCount) }
    order(request); state.queue.push(request); sortQueue()
    notice(status === 'pending' ? `${viewer.name}点了《${track.title}》，等待店长确认。` : `${viewer.name}点了《${track.title}》，已排队，不打断当前歌曲。`)
    maybeStart()
    return { ok: true, message: status === 'pending' ? '点歌已提交，等待店长确认。' : '已加入点歌队列，按本轮小心心优先值排序；同数先点先播。' }
  }
  function cancelSearch(id: string) {
    const job = searches.get(id)
    if (!job) return false
    job.resumeAfterCompletion = false
    searches.delete(id); state.searches = state.searches.filter(request => request.id !== id)
    retainUnstarted(job.request)
    clearTimeout(job.timer); job.controller.abort(new DOMException('点歌检索已取消。', 'AbortError'))
    return true
  }
  function cancelSearches(message?: string) {
    const count = searches.size
    for (const id of searches.keys()) cancelSearch(id)
    if (count && message) notice(message)
    if (count && !searchDisposed) options.onChange?.()
    return count
  }
  function pumpSearch() {
    if (searchWorker || searchDisposed) return
    const job = searches.values().next().value as SearchJob | undefined
    if (!job) return
    job.request.status = 'searching'; options.onChange?.()
    job.timer = setTimeout(() => {
      if (cancelSearch(job.request.id)) { maybeStart(); notice('QQ 音乐检索超时，本次点歌已取消，请稍后再试。'); options.onChange?.() }
    }, 20000)
    ;(job.timer as any).unref?.()
    searchWorker = Promise.resolve().then(async () => {
      let failureNotice: string | undefined
      try {
        if (job.controller.signal.aborted) return
        const resolved = await options.resolve!(job.request.query, job.controller.signal)
        if (job.controller.signal.aborted || !searches.has(job.request.id) || searchDisposed) return
        const track = validateTracks([resolved])[0]!
        const mid = /^shop-qqmusic:\/\/track\/([A-Za-z0-9]{1,64})$/.exec(track.source)?.[1]
        if (!mid || track.id !== `qq:${mid}`) throw new Error('QQ 点歌返回的曲目来源不正确，请换首歌再试。')
        const viewer = options.viewer?.(job.request.userId) || job.viewer
        if (viewer.blocked || !cfg().enabled || !cfg().qqAutoSearch || !options.canStart()) return
        if (cfg().requestPolicy === 'regular' && viewer.visits < 3) throw new Error('当前只接受熟客点歌，来过三场后就能加入。')
        if (state.queue.length + state.searches.length > cfg().maxQueue) throw new Error('点歌队列已经满啦，听完几首再来。')
        if (state.queue.some(request => request.userId === viewer.id)) throw new Error('每人最多保留一首待播歌曲，先等上一首轮到。')
        if (blocked(track)) throw new Error('这首歌已被店长暂时屏蔽。')
        if (state.current?.trackId === track.id && !state.current.isBgm || state.queue.some(request => request.trackId === track.id)) throw new Error('这首歌已经在播放或队列里啦，不用重复点。')
        const existing = state.tracks.find(item => item.id === track.id)
        if (!existing && musicLibraryFull(state.tracks)) throw new Error(`曲库已满 ${MUSIC_LIBRARY_LIMIT} 首，请店长清理后再点新歌。`)
        if (existing && existing.source !== track.source) throw new Error('这首歌的来源已改变，请店长检查曲库。')
        if (!existing) state.tracks.push(track)
        const result = enqueue(existing || track, job.viewer, false, job.request, true)
        if (!result.ok) throw new Error(result.message)
        job.request.heartCount = 0 // Transferred intact to the same round in queue/current.
      } catch (error) {
        if (!job.controller.signal.aborted && searches.has(job.request.id) && !searchDisposed) {
          const message = error instanceof Error ? compact(error.message, 180) : ''
          failureNotice = `点歌提示：${/[\u4e00-\u9fff]/.test(message) && !/https?:\/\/|authorization|cookie|token|vkey|sk-/i.test(message) ? message : 'QQ 音乐暂时无法找到或播放这首歌，请填写完整歌名和歌手。'}`
          notice(failureNotice)
        }
      } finally {
        clearTimeout(job.timer); searches.delete(job.request.id); state.searches = state.searches.filter(request => request.id !== job.request.id)
        if (!state.queue.some(request => request.id === job.request.id) && state.current?.id !== job.request.id) retainUnstarted(job.request)
        if (job.resumeAfterCompletion && !searchDisposed) { maybeStart(); if (failureNotice) notice(failureNotice) }
        if (!searchDisposed) options.onChange?.()
      }
    }).finally(() => { searchWorker = undefined; pumpSearch() })
  }
  function request(viewer: Pick<Viewer, 'id' | 'name' | 'visits' | 'blocked'>, query: string, owner = false, eventId?: string): CommandResult {
    const rejected = eligibility(viewer, owner)
    if (rejected) return rejected
    if (query.length > 100) return failure('歌名和歌手请控制在 100 字以内。')
    const clean = compact(query, 100)
    if (!clean || /(?:https?|file|data|shop-media|shop-qqmusic):/i.test(clean)) return failure('请填写歌名和歌手，不接受弹幕音频地址。')
    if (cfg().blockedTracks.some(item => normalized(item) && normalized(item) === normalized(clean))) return failure('这首歌已被店长暂时屏蔽。')
    const found = findTrack(clean)
    if (found.track) {
      const result = enqueue(found.track, viewer, owner, { eventId }, found.track.source.startsWith('shop-qqmusic:'))
      if (result.ok) consume(viewer, owner)
      return result
    }
    if (!found.missing) return failure(found.message!)
    if (owner || !cfg().qqAutoSearch || !options.resolve) return failure('曲库里还没有这首歌；QQ 自动点歌尚未启用或未连接，请店长检查点歌设置。')
    if (!options.canStart()) return failure('小店已暂停，请恢复营业后再用 QQ 音乐在线点歌。')
    if (state.searches.length >= Math.min(4, cfg().maxQueue)) return failure('QQ 点歌正在检索，请等前面的客人查完再试。')
    if (state.searches.some(request => normalized(request.query) === normalized(clean))) return failure('已经在查找这首歌啦，不用重复点。')
    if (musicLibraryFull(state.tracks)) return failure(`曲库已满 ${MUSIC_LIBRARY_LIMIT} 首，请店长清理后再点新歌。`)
    const reservation: MusicSearchRequest = { id: options.id(), query: clean, userId: viewer.id, userName: viewer.name, ...(eventId ? { eventId } : {}), at: options.now(), status: 'waiting', heartCount: takeUnspent(viewer.id) }
    order(reservation)
    consume(viewer, false); state.searches.push(reservation); searches.set(reservation.id, { request: reservation, viewer: { ...viewer }, controller: new AbortController(), resumeAfterCompletion: true })
    maybeStart()
    notice(`${viewer.name}点了《${clean}》，正在 QQ 音乐查找可播放版本，找到后自动排队。`)
    pumpSearch()
    return { ok: true, message: '正在 QQ 音乐查找，确认可播放后自动加入队列，不打断当前歌曲。', data: { requestId: reservation.id } }
  }
  function skip(viewer: Pick<Viewer, 'id' | 'name' | 'blocked'>): CommandResult {
    if (viewer.blocked) return failure('已忽略屏蔽观众的操作。')
    if (!cfg().enabled) return failure('点歌台当前没有开放观众操作。')
    if (!state.current || state.status !== 'playing') return failure('当前没有正在播放的歌曲。')
    if (state.current.startedAt === undefined) return failure('歌曲还在准备播放，请开始听歌后再投票切歌。')
    const elapsed = options.now() - state.current.startedAt - pausedMs
    if (elapsed < cfg().minPlaySeconds * 1000) return failure(`先听满 ${cfg().minPlaySeconds} 秒再投票切歌，让每首歌都有被听见的机会。`)
    if (!activeUsers.has(viewer.id)) return failure('请先参与现场互动，再投票切歌。')
    if (state.skipVotes.some(v => v.userId === viewer.id)) return { ok: true, message: '你这首歌已经投过一次，重复发送不会增加票数。' }
    state.skipVotes.push({ userId: viewer.id, at: options.now() })
    if (state.skipVotes.length >= state.skipRequired) {
      const votes = state.skipVotes.length
      playNext(); notice(`${votes} 位客人共同投票切歌，${state.current ? '开始下一首。' : '队列已播完。'}`)
      return { ok: true, message: '独立观众票数达到门槛，已切换下一首。' }
    }
    notice(`切歌投票 ${state.skipVotes.length}/${state.skipRequired}，每位现场客人一票。`)
    return { ok: true, message: `已记录切歌投票（${state.skipVotes.length}/${state.skipRequired}）。` }
  }
  function chat(viewer: Pick<Viewer, 'id' | 'name' | 'visits' | 'blocked'>, line: string, eventId?: string): { handled: boolean; result?: CommandResult } {
    const value = line.trim()
    const handled = (result: CommandResult) => {
      if (!result.ok && result.message && (lastRejectedNoticeAt === undefined || options.now() - lastRejectedNoticeAt >= 15000)) { lastRejectedNoticeAt = options.now(); notice(`点歌提示：${result.message}`) }
      return { handled: true, result }
    }
    const match = value.match(/^[#!！/]?(?:点歌|点一首)\s*[:：]?\s*([\s\S]*)$/)
    if (match) return handled(match[1]?.trim() ? request(viewer, match[1].trim(), false, eventId) : failure('发「点歌 歌名 歌手」即可自动查找并加入队列；按本轮小心心优先值排序，同数先点先播。'))
    if (/^[#!！/]?(?:切歌|投票切歌|下一首|skip)[!！。\s]*$/i.test(value)) return handled(skip(viewer))
    if (/^取消点歌[!！。\s]*$/.test(value)) {
      const removed = state.queue.filter(r => r.userId === viewer.id), before = state.queue.length; state.queue = state.queue.filter(r => r.userId !== viewer.id)
      for (const request of removed) retainUnstarted(request)
      let cancelled = 0; for (const job of searches.values()) if (job.request.userId === viewer.id && cancelSearch(job.request.id)) cancelled++
      if (before > state.queue.length || cancelled) maybeStart()
      return { handled: true, result: { ok: true, message: before > state.queue.length || cancelled ? '已取消你的待播歌曲和检索。' : '你没有等待播放的歌曲。' } }
    }
    return { handled: false }
  }
  /** Runtime has already deduplicated event IDs and converted combo totals to a delta. */
  function gift(event: LiveEvent) {
    if (event.kind !== 'gift' || event.giftId !== 'heart' && event.giftName !== '小心心') return false
    const count = hearts(event.count), request = priorityRound(event.user.id)
    if (!count || !request) return false
    request.heartCount = Math.min(Number.MAX_SAFE_INTEGER, hearts(request.heartCount) + count)
    sortQueue()
    notice(`${event.user.name}的本轮点歌优先值 +${count}，共 ${request.heartCount} 颗小心心；歌曲真正开始播放才消耗，不打断当前歌曲。`)
    return true
  }
  function approve(requestId: string): CommandResult {
    const request = state.queue.find(r => r.id === requestId)
    if (!request || request.status !== 'pending') return failure('这条点歌申请已处理或不存在。')
    const track = state.tracks.find(t => t.id === request.trackId)
    if (!track || blocked(track)) return failure('歌曲已移除或屏蔽，请拒绝这条申请。')
    request.status = 'queued'; maybeStart(); return { ok: true, message: '已通过，按本轮小心心优先值排序；同数先点先播。' }
  }
  function reject(requestId: string): CommandResult {
    if (cancelSearch(requestId)) { maybeStart(); return { ok: true, message: '已取消这条点歌检索。' } }
    const index = state.queue.findIndex(r => r.id === requestId)
    if (index < 0) return failure('点歌申请已处理或不存在。')
    retainUnstarted(state.queue.splice(index, 1)[0]!); maybeStart(); return { ok: true, message: '已移除这条点歌；尚未开始播放的小心心优先值保留至下次点歌。' }
  }
  function play(trackId?: string): CommandResult {
    if (!trackId) {
      // A failed play request must not stop a song that was already playing.
      if (!state.queue.some(r => r.status === 'queued' && state.tracks.some(t => t.id === r.trackId && !blocked(t)))) return failure('没有已通过的待播歌曲。')
      playNext(); return { ok: true }
    }
    const track = state.tracks.find(t => t.id === trackId)
    if (!track || blocked(track)) return failure('找不到这首歌曲，或歌曲已屏蔽。')
    const index = state.queue.findIndex(r => r.trackId === trackId)
    if (index < 0 && cfg().enabled && cfg().bgmEnabled && cfg().bgmTrackIds.includes(trackId)) { beginBgm(track); return { ok: true, message: '正在手动重试背景曲。' } }
    const request: MusicRequest = index >= 0 ? state.queue.splice(index, 1)[0]! : { id: options.id(), trackId, userId: '__owner__', userName: '店长', at: options.now(), status: 'queued', heartCount: 0 }
    begin(request); return { ok: true }
  }
  function pause(): CommandResult {
    bgmStopped = true
    const cancelled = cancelSearches('音乐已暂停，待完成的 QQ 点歌检索已取消。')
    if (cancelled && !state.current) { state.status = 'paused'; return { ok: true, message: '已暂停音乐并取消正在检索的点歌。' } }
    if (state.status !== 'playing' || !state.current) return failure('当前没有正在播放的歌曲。')
    state.status = 'paused'; pausedAt = state.current.startedAt === undefined ? undefined : options.now(); return { ok: true }
  }
  function resume(): CommandResult {
    if (state.status === 'paused' && !state.current) { state.status = 'stopped'; bgmStopped = false; maybeStart(); return { ok: true } }
    if (state.status !== 'paused' || !state.current) return failure('当前没有暂停的歌曲。')
    if (pausedAt !== undefined) pausedMs += Math.max(0, options.now() - pausedAt)
    pausedAt = undefined; state.status = 'playing'; bgmStopped = false; return { ok: true }
  }
  function stop() { bgmStopped = true; cancelSearches(); resetCurrent(); return { ok: true } }
  function started(generationId: string): CommandResult {
    if (!state.current || generationId !== state.current.generationId || state.status !== 'playing' || state.current.startedAt !== undefined) return { ok: true, message: '已忽略过期或重复的歌曲开始回执。' }
    state.current.startedAt = options.now(); pausedAt = undefined; pausedMs = 0
    if (state.current.isBgm) { notice(`正在播放背景曲《${state.tracks.find(t => t.id === state.current!.trackId)?.title || '背景音乐'}》；不占观众点歌轮次。`); return { ok: true } }
    state.current.consumedHearts = hearts(state.current.heartCount); state.current.heartCount = 0
    const track = state.tracks.find(t => t.id === state.current!.trackId)
    notice(`正在播放《${track?.title || '歌曲'}》 · ${state.current.userName}点播，本轮已消耗 ${state.current.consumedHearts} 颗小心心优先值。`)
    return { ok: true }
  }
  function ended(generationId: string, error?: string): CommandResult {
    if (!state.current || generationId !== state.current.generationId) return { ok: true, message: '已忽略过期的歌曲播放回执。' }
    // A native ended callback can already be queued when the owner presses pause.
    // It must not advance the queue and unexpectedly resume sound.
    if (state.status === 'paused' && !error) return { ok: true, message: '歌曲已暂停，已忽略迟到的结束回执。' }
    const title = state.tracks.find(t => t.id === state.current!.trackId)?.title || '当前歌曲'
    const wasBgm = state.current.isBgm
    if (wasBgm && error) {
      failedBgm.add(state.current.trackId)
      const qq = state.tracks.find(t => t.id === state.current!.trackId)?.source.startsWith('shop-qqmusic:')
      state.bgmError = `${qq ? 'QQ ' : ''}背景曲《${title}》暂时不可播放；本次运行已暂停该曲自动重试，请检查连接、账号权限或歌曲来源。`
      if (state.status === 'paused') bgmStopped = true
    }
    if (state.status !== 'paused' && options.canStart()) playNext(); else resetCurrent()
    if (error) notice(wasBgm ? state.bgmError! : `《${title}》播放失败，已跳过；请店长检查歌曲来源。`)
    return { ok: true }
  }
  return { setTracks, audience, request, chat, gift, approve, reject, play, pause, resume, stop, started, cancelSearches, next: () => { playNext(); return { ok: true } }, ended, maybeStart, activate, retryBackground, configurationChanged, async flush() { while (searchWorker) await searchWorker }, dispose() { searchDisposed = true; cancelSearches(); unspentHearts.clear(); roundOrder.clear(); failedBgm.clear() } }
}
