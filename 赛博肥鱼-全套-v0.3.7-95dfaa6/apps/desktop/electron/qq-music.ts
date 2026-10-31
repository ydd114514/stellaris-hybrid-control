import type { MusicTrack, QQMusicLogin, QQMusicSearch, QQMusicStatus } from '../../../packages/shared/src/index'
import { musicMatchScore as matchScore, musicSearchQueries } from '../../../packages/core/src/music-match'

export interface QQMusicVault {
  get(): string | undefined | Promise<string | undefined>
  set(value: string | undefined): void | Promise<void>
}
export interface QQMusicOptions {
  /** The embedded provider handles this Request directly; this is never an HTTP endpoint. */
  request(request: Request): Promise<Response>
  vault: QQMusicVault
  fetch?: typeof globalThis.fetch
  isAllowed(mid: string): boolean
  now?: () => number
}

const MID = /^[a-zA-Z0-9]{1,64}$/
const MAX_JSON = 2 * 1024 * 1024
const MAX_IMAGE = 1024 * 1024
const MAX_AUDIO = 256 * 1024 * 1024
const INTERNAL = 'https://qqmusic.internal.invalid'
const STOPPED = 'QQ音乐操作已取消，请重试。'
const LOGIN_REQUIRED = 'QQ音乐尚未登录或登录已失效，请重新扫码。'
const UNAVAILABLE = '这首歌暂时无法取得完整播放地址，请在QQ音乐核对账号权限或换一首。'
const NO_MATCH = '没有找到可确认的歌名和歌手，请发「点歌 歌名 歌手」。'
const BUSY = '正在核对前一首QQ歌曲，请稍后再点。'
const UNTRUSTED = 'QQ音乐返回的播放地址不可信，已停止。'
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const text = (value: unknown, max: number) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : ''
const abortError = () => new Error(STOPPED)
const aborted = (signal: AbortSignal) => { if (signal.aborted) throw abortError() }
const STREAM_CANCELLED = 'QQ_MUSIC_STREAM_CANCELLED'
function cancelledStreamError() { return Object.assign(new Error('QQ音乐音频播放已停止。'), { name: 'AbortError', code: STREAM_CANCELLED }) }
export function isQQMusicStreamCancellation(error: unknown): boolean { return error instanceof Error && (error as Error & { code?: string }).code === STREAM_CANCELLED }

/** Also handles providers that do not honour Request.signal. Late promises never mutate state. */
function cancellable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise<T>((resolve, reject) => {
    const stop = () => { signal.removeEventListener('abort', stop); reject(abortError()) }
    signal.addEventListener('abort', stop, { once: true })
    promise.then(value => { signal.removeEventListener('abort', stop); signal.aborted ? reject(abortError()) : resolve(value) }, () => {
      signal.removeEventListener('abort', stop)
      reject(signal.aborted ? abortError() : new Error('QQ音乐连接失败，请稍后重试。'))
    })
  })
}
async function limitedBody(response: Response, limit: number, signal: AbortSignal): Promise<Uint8Array> {
  const length = Number(response.headers.get('content-length'))
  if (length > limit) { void response.body?.cancel(); throw new Error('QQ音乐返回内容过大，请稍后重试。') }
  if (!response.body) return new Uint8Array()
  const reader = response.body.getReader(), parts: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await cancellable(reader.read(), signal)
      if (done) break
      size += value.byteLength
      if (size > limit) throw new Error('QQ音乐返回内容过大，请稍后重试。')
      parts.push(value)
    }
    const result = new Uint8Array(size)
    let offset = 0
    for (const part of parts) { result.set(part, offset); offset += part.byteLength }
    return result
  } finally { void reader.cancel().catch(() => undefined) }
}
function qrImage(value: unknown): string {
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_IMAGE * 4 / 3) + 100) throw new Error('QQ音乐二维码格式不支持，请重新扫码。')
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)
  if (!match || match[2]!.length % 4 !== 0) throw new Error('QQ音乐二维码格式不支持，请重新扫码。')
  const bytes = Buffer.from(match[2]!, 'base64')
  const valid = match[1] === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : match[1] === 'jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
      : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP'
  if (!valid || bytes.length > MAX_IMAGE) throw new Error('QQ音乐二维码格式不支持，请重新扫码。')
  return value
}
function cdnUrl(value: unknown): URL {
  let url: URL
  try { url = new URL(typeof value === 'string' ? value : '') } catch { throw new Error(UNTRUSTED) }
  const host = url.hostname.toLowerCase()
  const allowed = host.endsWith('.qqmusic.qq.com') || host.endsWith('.tc.qq.com')
  if (!allowed || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || url.hash || url.href.length > 16384 || !/\.(?:mp3|m4a|aac|flac)$/i.test(url.pathname)) throw new Error(UNTRUSTED)
  url.protocol = 'https:'
  return url
}
function validRange(value: string | null): boolean {
  if (value === null) return true
  const match = /^bytes=(\d{1,16})?-(\d{1,16})?$/.exec(value)
  if (!match || (!match[1] && !match[2])) return false
  const start = match[1] ? Number(match[1]) : undefined, end = match[2] ? Number(match[2]) : undefined
  return (start === undefined || Number.isSafeInteger(start)) && (end === undefined || Number.isSafeInteger(end)) && (start === undefined ? end! > 0 : end === undefined || end >= start)
}
const responseHeaders = () => new Headers({ 'cache-control': 'no-store', 'access-control-allow-origin': '*', 'access-control-expose-headers': 'Content-Length, Content-Range, Accept-Ranges', 'x-content-type-options': 'nosniff' })
const mediaError = (message: string, status = 502) => {
  const headers = responseHeaders()
  headers.set('content-type', 'text/plain; charset=utf-8')
  return new Response(message, { status, headers })
}

/** QQ credentials and signed audio URLs stay within this main-process module. */
export function createQQMusic(options: QQMusicOptions) {
  const now = options.now ?? Date.now, fetchAudio = options.fetch ?? globalThis.fetch
  let token = '', pending: { key: string; expiresAt: number } | undefined, generation = 0, disposed = false
  let message = '连接QQ音乐后，可搜索歌曲并加入小店曲库。'
  const controllers = new Set<AbortController>(), mediaIds = new Map<string, string>()
  const playUrls = new Map<string, { url: string; expiresAt: number }>()
  let resolving = false
  let persistence: Promise<void> = Promise.resolve()
  const initialGeneration = generation
  const ready = Promise.resolve().then(() => options.vault.get()).then(saved => {
    if (disposed || initialGeneration !== generation || !saved || saved.length > 65536) return
    let data: Record<string, unknown>
    try { data = object(JSON.parse(saved)) } catch { return }
    if (typeof data.token === 'string' && data.token.length > 0 && data.token.length <= 60000 && !/[\r\n]/.test(data.token)) {
      token = data.token
      message = '已保存QQ音乐登录，播放权限将在使用时核对。'
    }
  }, () => { message = 'QQ音乐登录信息读取失败，请重新扫码。' })
  const persist = (value: string | undefined, at: number) => {
    persistence = persistence.catch(() => undefined).then(async () => {
      if (disposed || at !== generation) return
      try { await options.vault.set(value) } catch { throw new Error('QQ音乐登录信息保存失败，请重新扫码。') }
    })
    return persistence
  }
  const ensure = (at = generation) => { if (disposed || at !== generation) throw abortError() }
  const invalidate = () => { generation++; for (const controller of controllers) controller.abort(); controllers.clear(); playUrls.clear() }
  async function api(path: string, auth = token, method = 'GET', timeoutMs = 25000, parentSignal?: AbortSignal): Promise<Record<string, unknown>> {
    ensure()
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs)
    const stop = () => controller.abort()
    parentSignal?.addEventListener('abort', stop, { once: true })
    if (parentSignal?.aborted) controller.abort()
    controllers.add(controller)
    try {
      aborted(controller.signal)
      const response = await cancellable(options.request(new Request(`${INTERNAL}${path}`, { method, headers: auth ? { 'X-QQ-Session': auth } : {}, signal: controller.signal })), controller.signal)
      if (response.status === 401) throw new Error(LOGIN_REQUIRED)
      if (response.status === 429) throw new Error('QQ音乐操作过于频繁，请稍后重试。')
      if (!response.ok) throw Object.assign(new Error('QQ音乐服务暂时不可用，请稍后重试。'), { qqServerError: response.status >= 500 })
      const bytes = await limitedBody(response, MAX_JSON, controller.signal)
      let data: Record<string, unknown>
      try { data = object(JSON.parse(new TextDecoder().decode(bytes))) } catch { throw new Error('QQ音乐返回内容异常，请稍后重试。') }
      if (data.code === 401) throw new Error(LOGIN_REQUIRED)
      if (data.code === 429) throw new Error('QQ音乐操作过于频繁，请稍后重试。')
      return data
    } finally { clearTimeout(timer); controllers.delete(controller); parentSignal?.removeEventListener('abort', stop) }
  }
  function cancelRemote(key?: string, auth?: string) {
    if (!key && !auth) return
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 2500)
    controllers.add(controller)
    const path = key ? `/login/qr/cancel?key=${encodeURIComponent(key)}` : '/logout'
    void cancellable(options.request(new Request(`${INTERNAL}${path}`, { headers: auth ? { 'X-QQ-Session': auth } : {}, signal: controller.signal })), controller.signal)
      .then(response => response.body?.cancel()).catch(() => undefined).finally(() => { clearTimeout(timer); controllers.delete(controller) })
  }
  async function status(): Promise<QQMusicStatus> { await ready; ensure(); return { loggedIn: Boolean(token), loginPending: Boolean(pending && pending.expiresAt > now()), message } }
  async function loginStart(channel: string = 'qq'): Promise<QQMusicLogin> {
    await ready; ensure()
    if (channel !== 'qq' && channel !== 'wechat') throw new Error('暂不支持QQ音乐App扫码，请选择手机QQ或微信扫码。')
    const old = pending?.key
    invalidate(); pending = undefined; polling = undefined; cancelRemote(old)
    const at = generation
    let key: string | undefined
    try {
      const result = await api(`/login/qr/key?channel=${channel}`, '')
      ensure(at)
      key = text(object(result.data).unikey, 60000)
      if (!key || result.code !== 200) throw new Error('QQ音乐二维码创建失败，请稍后重试。')
      const image = await api(`/login/qr/create?key=${encodeURIComponent(key)}`, '')
      ensure(at)
      const qrDataUrl = qrImage(object(image.data).qrimg)
      const expiresAt = now() + 120000
      pending = { key, expiresAt }; message = channel === 'wechat' ? '请用微信扫码，并在手机上确认登录。' : '请用手机QQ扫码，并在手机上确认登录。'
      return { qrDataUrl, expiresAt, message }
    } catch (error) {
      if (key) cancelRemote(key)
      if (at === generation) message = 'QQ音乐二维码创建失败，请重新获取。'
      throw safeError(error)
    }
  }
  let polling: Promise<QQMusicStatus> | undefined
  async function loginPoll(): Promise<QQMusicStatus> {
    await ready; ensure()
    if (polling) return polling
    const current = pending, at = generation
    if (!current) return status()
    if (current.expiresAt <= now()) { pending = undefined; message = 'QQ音乐二维码已过期，请重新获取。'; cancelRemote(current.key); return status() }
    const task = (async () => {
      try {
        const result = await api(`/login/qr/check?key=${encodeURIComponent(current.key)}`, '')
        ensure(at)
        if (pending !== current) throw abortError()
        if (result.code === 803) {
          // The provider's cookie holds its sealed token, never the upstream QQ Cookie.
          const cookie = typeof result.cookie === 'string' ? result.cookie : ''
          const found = /(?:^|;\s*)qqmusic_session=([^;\s]+)/.exec(cookie)?.[1]
          if (!found || found.length > 60000 || /[\r\n]/.test(found)) throw new Error('QQ音乐登录凭证无效，请重新扫码。')
          await persist(JSON.stringify({ token: found }), at)
          ensure(at)
          // An old account may still have resolved a song while its replacement
          // QR was waiting. Never carry that account's URL/stream into the new one.
          if (found !== token) invalidate()
          token = found; pending = undefined; message = 'QQ音乐已连接，可以搜索歌曲加入曲库。'
        } else if (result.code === 802) message = '已扫码，请在手机上确认QQ音乐登录。'
        else if (result.code === 801) message = '等待扫码，请使用二维码对应的手机App。'
        else if (result.code === 800) { pending = undefined; message = 'QQ音乐二维码已失效，请重新获取。' }
        else throw new Error('QQ音乐登录状态异常，请重新扫码。')
        return status()
      } catch (error) { throw safeError(error) }
    })()
    polling = task
    try { return await task } finally { if (polling === task) polling = undefined }
  }
  async function logout(): Promise<QQMusicStatus> {
    const oldToken = token, oldKey = pending?.key
    invalidate(); token = ''; pending = undefined; polling = undefined; mediaIds.clear(); message = 'QQ音乐已退出登录。'
    await ready; ensure()
    await persist(undefined, generation)
    cancelRemote(oldKey); cancelRemote(undefined, oldToken)
    return status()
  }
  async function search(query: string, signal?: AbortSignal, page = 1): Promise<QQMusicSearch & { more: boolean }> {
    await ready; ensure()
    if (signal) aborted(signal)
    const keyword = text(query, 61)
    if (!keyword || keyword.length > 60) throw new Error('请输入1至60个字的歌名或歌手。')
    const at = generation
    try {
      // Public catalog search is deliberately anonymous. The current QQ upstream
      // can return HTTP 200 with an empty catalog for a valid authenticated session,
      // while the same query anonymously returns songs. Playback still uses token.
      const path = `/search?keyword=${encodeURIComponent(keyword)}&type=song&page=${page}&limit=30`
      let result: Record<string, unknown>
      try { result = await api(path, '', 'GET', 25000, signal) }
      catch (error) {
        // A transient catalog 5xx must not abandon a viewer's request immediately.
        // Retry this anonymous, read-only operation once; never retry auth/429.
        if (!(error instanceof Error) || (error as Error & { qqServerError?: boolean }).qqServerError !== true) throw error
        ensure(at); if (signal) aborted(signal)
        const controller = new AbortController(), stop = () => controller.abort()
        signal?.addEventListener('abort', stop, { once: true }); controllers.add(controller)
        let timer: ReturnType<typeof setTimeout> | undefined
        try { await cancellable(new Promise<void>(done => { timer = setTimeout(done, 500) }), controller.signal) }
        finally { clearTimeout(timer); controllers.delete(controller); signal?.removeEventListener('abort', stop) }
        ensure(at); if (signal) aborted(signal)
        result = await api(path, '', 'GET', 25000, signal)
      }
      ensure(at)
      if (signal) aborted(signal)
      // Current search routes return fields at the root; older adapters may wrap them in data.
      const data = Array.isArray(result.items) ? result : object(result.data)
      if (result.code !== 200 || !Array.isArray(data.items)) throw new Error('QQ音乐搜索暂时不可用，请稍后重试。')
      const tracks: MusicTrack[] = [], seen = new Set<string>()
      for (const raw of data.items.slice(0, 60)) {
        const item = object(raw), mid = text(item.mid, 65), title = text(item.title || item.name, 200)
        if (!MID.test(mid) || !title || seen.has(mid)) continue
        const singers = Array.isArray(item.singer) ? item.singer : []
        const artist = singers.slice(0, 8).map(value => text(object(value).name, 60)).filter(Boolean).join(' / ').slice(0, 240) || '未知歌手'
        const duration = typeof item.interval === 'number' && Number.isFinite(item.interval) && item.interval > 0 && item.interval <= 86400 ? item.interval : undefined
        const mediaId = text(object(item.file).media_mid, 65)
        if (MID.test(mediaId)) { if (mediaIds.size >= 500) mediaIds.delete(mediaIds.keys().next().value!); mediaIds.set(mid, mediaId) }
        tracks.push({ id: `qq:${mid}`, title, artist, source: `shop-qqmusic://track/${mid}`, ...(duration ? { duration } : {}) })
        seen.add(mid)
        if (tracks.length === 30) break
      }
      return { tracks, more: data.more === true, ...(!tracks.length ? { message: '没有找到歌曲，请尝试完整歌名和歌手。' } : {}) }
    } catch (error) { throw safeError(error) }
  }
  async function playbackUrl(mid: string, signal: AbortSignal, at: number): Promise<URL> {
    ensure(at); aborted(signal)
    if (!token) throw new Error(LOGIN_REQUIRED)
    const cached = playUrls.get(mid)
    if (cached && cached.expiresAt > now()) return cdnUrl(cached.url)
    playUrls.delete(mid)
    let mediaId = mediaIds.get(mid)
    if (!mediaId) {
      try {
        const detail = await api(`/getSongInfo/${mid}`, token, 'GET', 10000, signal)
        const track = object(object(object(object(detail.response).songinfo).data).track_info)
        const candidate = text(object(track.file).media_mid, 65)
        ensure(at); aborted(signal)
        if (MID.test(candidate)) { mediaId = candidate; if (mediaIds.size >= 500) mediaIds.delete(mediaIds.keys().next().value!); mediaIds.set(mid, candidate) }
      } catch { ensure(at); aborted(signal) }
    }
    const data = await api(`/getMusicPlay/${mid}?quality=128${mediaId ? `&mediaId=${mediaId}` : ''}`, token, 'GET', 25000, signal)
    ensure(at); aborted(signal)
    const entry = object(object(object(data.data).playUrl)[mid])
    if (entry.error !== false || entry.preview === true || entry.trial === true || entry.isPreview === true || !entry.url) throw new Error(UNAVAILABLE)
    const url = cdnUrl(entry.url)
    if (/(?:^|\/)RS02[^/]*\.mp3$/i.test(url.pathname)) throw new Error(UNAVAILABLE)
    if (playUrls.size >= 20) playUrls.delete(playUrls.keys().next().value!)
    playUrls.set(mid, { url: url.toString(), expiresAt: now() + 60000 })
    return url
  }
  /** Read lyrics in the main process; never publish lyric bodies in AppState. */
  async function lyrics(mid: string, signal?: AbortSignal): Promise<string> {
    await ready; ensure()
    if (!MID.test(mid)) throw new Error(NO_MATCH)
    const result=await api(`/getLyric?songmid=${encodeURIComponent(mid)}&trans=1`,'','GET',25000,signal)
    const data=object(result.response)
    if(data.code!==0 || typeof data.lyric!=='string' || data.lyric.length>100000) throw new Error(UNAVAILABLE)
    let translated=typeof data.trans==='string'?data.trans:''
    if(translated && /^[A-Za-z0-9+/=\r\n]+$/.test(translated)) {
      try{translated=Buffer.from(translated,'base64').toString('utf8')}catch{translated=''}
    }
    return (data.lyric+'\n'+translated).slice(0,100000)
  }
  /** Main-process runtime hook. Resolves metadata; it never starts audio or changes a queue. */
  async function resolve(query: string, signal?: AbortSignal): Promise<MusicTrack> {
    if (resolving) throw new Error(BUSY)
    resolving = true
    const controller = new AbortController(), at = generation
    const stop = () => controller.abort()
    signal?.addEventListener('abort', stop, { once: true })
    if (signal?.aborted) controller.abort()
    const timer = setTimeout(() => controller.abort(), 45000)
    controllers.add(controller)
    try {
      await cancellable(ready, controller.signal)
      ensure(at); aborted(controller.signal)
      if (!token) throw new Error(LOGIN_REQUIRED)
      const keyword = text(query, 61)
      if (!keyword || keyword.length > 60 || /https?:\/\/|shop-(?:media|qqmusic):\/\//i.test(keyword)) throw new Error(NO_MATCH)
      const checked = new Set<string>()
      let pages = 0
      for (const query of musicSearchQueries(keyword)) {
        for (let page = 1; page <= 3 && pages < 6; page++) {
          ensure(at); aborted(controller.signal)
          const result = await search(query, controller.signal, page); pages++
          const candidates = result.tracks.map((track, index) => ({ track, index, score: matchScore(track, keyword) }))
            .filter(item => item.score >= 0 && !checked.has(item.track.id)).sort((a, b) => b.score - a.score || a.index - b.index)
          for (const { track } of candidates) {
            ensure(at); aborted(controller.signal)
            checked.add(track.id)
            try {
              await playbackUrl(track.id.slice(3), controller.signal, at)
              ensure(at); aborted(controller.signal)
              return { ...track }
            } catch (error) {
              ensure(at); aborted(controller.signal)
              if (error instanceof Error && [LOGIN_REQUIRED, 'QQ音乐操作过于频繁，请稍后重试。'].includes(error.message)) throw error
            }
            if (checked.size >= 6) throw new Error(UNAVAILABLE)
          }
          if (!result.more || !result.tracks.length) break
        }
      }
      throw new Error(checked.size ? UNAVAILABLE : NO_MATCH)
    } catch (error) { throw safeError(error) }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', stop); controllers.delete(controller); resolving = false }
  }
  async function stream(request: Request): Promise<Response> {
    let controller: AbortController | undefined, reader: ReadableStreamDefaultReader<Uint8Array> | undefined, timer: ReturnType<typeof setTimeout> | undefined
    const finish = () => { if (timer) clearTimeout(timer); if (controller) { controller.abort(); controllers.delete(controller) }; void reader?.cancel().catch(() => undefined) }
    let cleanup = finish, expectedStop = () => disposed || request.signal.aborted
    try {
      await ready; ensure()
      const url = new URL(request.url), match = /^\/([a-zA-Z0-9]{1,64})$/.exec(url.pathname)
      if (url.protocol !== 'shop-qqmusic:' || url.hostname !== 'track' || !match || url.search || url.hash || url.port || url.username || url.password) return mediaError('QQ音乐播放地址无效。', 400)
      if (request.method !== 'GET' && request.method !== 'HEAD') return mediaError('QQ音乐只支持读取音频。', 405)
      const mid = match[1]!
      if (!options.isAllowed(mid)) return mediaError('只能播放小店当前已允许的QQ音乐曲目。', 403)
      const range = request.headers.get('range')
      if (!validRange(range)) return mediaError('QQ音乐音频范围无效。', 416)
      if (!token) return mediaError(LOGIN_REQUIRED, 401)
      const at = generation
      expectedStop = () => disposed || request.signal.aborted || at !== generation || !options.isAllowed(mid)
      controller = new AbortController(); controllers.add(controller)
      const currentController = controller
      const stop = () => currentController.abort()
      request.signal.addEventListener('abort', stop, { once: true })
      cleanup = () => { request.signal.removeEventListener('abort', stop); finish() }
      if (request.signal.aborted) { cleanup(); return mediaError(STOPPED, 499) }
      let audioUrl: URL
      try { audioUrl = await playbackUrl(mid, controller.signal, at) }
      catch (error) { if (error instanceof Error && error.message === UNAVAILABLE) { cleanup(); return mediaError(UNAVAILABLE, 403) }; throw error }
      let response: Response | undefined
      for (let redirects = 0; redirects <= 3; redirects++) {
        aborted(controller.signal); ensure(at)
        if (!options.isAllowed(mid)) throw abortError()
        timer = setTimeout(() => currentController.abort(), 20000)
        try { response = await cancellable(fetchAudio(audioUrl, { method: request.method, headers: { Accept: 'audio/*', ...(range ? { Range: range } : {}) }, redirect: 'manual', signal: controller.signal }), controller.signal) }
        finally { clearTimeout(timer); timer = undefined }
        if (![301, 302, 303, 307, 308].includes(response.status)) break
        const location = response.headers.get('location')
        void response.body?.cancel().catch(() => undefined)
        if (!location || redirects === 3) throw new Error(UNAVAILABLE)
        audioUrl = cdnUrl(new URL(location, audioUrl).toString())
      }
      ensure(at); aborted(controller.signal)
      if (!response || ![200, 206, 416].includes(response.status)) { playUrls.delete(mid); throw new Error(UNAVAILABLE) }
      const headers = responseHeaders()
      for (const name of ['content-type', 'content-length', 'content-range', 'accept-ranges']) { const value = response.headers.get(name); if (value) headers.set(name, value) }
      const mime = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()
      if (mime && !mime.startsWith('audio/') && mime !== 'application/octet-stream' && response.status !== 416) throw new Error(UNAVAILABLE)
      if (Number(headers.get('content-length')) > MAX_AUDIO) throw new Error('QQ音乐音频文件过大，请换一首。')
      if (request.method === 'HEAD' || response.status === 416 || !response.body) { cleanup(); return new Response(null, { status: response.status, headers }) }
      reader = response.body.getReader()
      const currentReader = reader
      let size = 0, consumerCancelled = false
      const body = new ReadableStream<Uint8Array>({
        async pull(output) {
          timer = setTimeout(() => currentController.abort(), 20000)
          try {
            ensure(at); aborted(currentController.signal)
            if (!options.isAllowed(mid)) throw abortError()
            const next = await cancellable(currentReader.read(), currentController.signal)
            if (consumerCancelled) return
            ensure(at)
            if (!options.isAllowed(mid)) throw abortError()
            if (next.done) { output.close(); cleanup(); return }
            size += next.value.byteLength
            if (size > MAX_AUDIO) throw new Error('QQ音乐音频文件过大，请换一首。')
            output.enqueue(next.value)
          } catch {
            if (!consumerCancelled) output.error(expectedStop() ? cancelledStreamError() : new Error('QQ音乐音频读取中断，请检查连接或换一首。'))
            cleanup()
          }
          finally { if (timer) { clearTimeout(timer); timer = undefined } }
        },
        cancel() { consumerCancelled = true; cleanup() }
      })
      return new Response(body, { status: response.status, headers })
    } catch (error) { const cancelled = expectedStop(); cleanup(); return mediaError(cancelled ? STOPPED : safeError(error).message, cancelled ? 499 : 502) }
  }
  function dispose() { if (disposed) return; const old = pending?.key; invalidate(); pending = undefined; token = ''; mediaIds.clear(); cancelRemote(old); disposed = true }
  return { status, loginStart, loginPoll, logout, search, resolve, lyrics, stream, dispose }
}

/** Never return upstream exception messages, which may contain cookies or signed URLs. */
export function safeError(error: unknown): Error {
  const allowed = [STOPPED, LOGIN_REQUIRED, UNAVAILABLE, NO_MATCH, BUSY, UNTRUSTED, 'QQ音乐连接失败，请稍后重试。', 'QQ音乐服务暂时不可用，请稍后重试。', 'QQ音乐操作过于频繁，请稍后重试。', 'QQ音乐返回内容过大，请稍后重试。', 'QQ音乐返回内容异常，请稍后重试。', 'QQ音乐二维码创建失败，请稍后重试。', 'QQ音乐二维码格式不支持，请重新扫码。', 'QQ音乐登录凭证无效，请重新扫码。', 'QQ音乐登录状态异常，请重新扫码。', 'QQ音乐登录信息保存失败，请重新扫码。', 'QQ音乐搜索暂时不可用，请稍后重试。', 'QQ音乐音频文件过大，请换一首。']
  return new Error(error instanceof Error && allowed.includes(error.message) ? error.message : 'QQ音乐操作失败，请稍后重试。')
}
