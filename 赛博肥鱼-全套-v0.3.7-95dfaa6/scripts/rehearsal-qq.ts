/** Read-only QQ authorization snapshot for an explicitly started live rehearsal. */
import { existsSync } from 'node:fs'
import { readFile, realpath, stat } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import type { MusicTrack } from '../packages/shared/src/index'
import { createQQMusic, isQQMusicStreamCancellation } from '../apps/desktop/electron/qq-music'
import { createQQVault } from '../apps/desktop/electron/qq-vault'

export interface RehearsalQQOptions {
  project: string
  /** A user-selected, non-secret JSON under this project's .local directory. */
  tracksFile?: string
  isAllowed(mid: string): boolean
}
export interface RehearsalQQMetadata {
  available: boolean
  state: 'skipped' | 'not-tested' | 'failed' | 'audio-read' | 'played'
  reason: string
  authorizationMode: 'snapshot-read-only'
  selectedTracks: number
  apiRequests: { search: number; details: number; play: number }
  blockedAccountChanges: number
  sourceVaultWrites: number
  streamRequests: number
  audioReadResponses: number
  audioBytesRead: number
  failedStreams: number
  cancelledStreams: number
  resolverRequests: number
  resolvedTracks: number
  failedResolves: number
  playbackStarted: { id: string; title: string }[]
}
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const clean = (value: unknown, limit: number) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, limit) : ''
const midOf = (source: string) => /^shop-qqmusic:\/\/track\/([A-Za-z0-9]{1,64})$/.exec(source)?.[1]
const unavailable = (message: string, status = 503) => new Response(message, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'access-control-allow-origin': '*' } })

async function chosenTracks(project: string, filename?: string): Promise<MusicTrack[]> {
  if (!filename) return []
  const root = await realpath(join(project, '.local'))
  const file = await realpath(resolve(project, filename))
  if (!file.startsWith(`${root}${sep}`) || !file.endsWith('.json') || (await stat(file)).size > 1024 * 1024) throw new Error('点歌曲目文件必须是本项目.local目录下的小型JSON。')
  const raw = JSON.parse(await readFile(file, 'utf8'))
  const items = Array.isArray(raw) ? raw : object(raw).tracks
  if (!Array.isArray(items)) throw new Error('点歌曲目文件没有可用曲目。')
  const tracks: MusicTrack[] = [], seen = new Set<string>()
  for (const raw of items.slice(0, 100)) {
    const item = object(raw), source = clean(item.source, 100), mid = midOf(source), title = clean(item.title, 200)
    if (!mid || !title || item.id !== `qq:${mid}` || seen.has(mid)) continue
    const duration = typeof item.duration === 'number' && Number.isFinite(item.duration) && item.duration > 0 && item.duration <= 86400 ? item.duration : undefined
    tracks.push({ id: `qq:${mid}`, title, artist: clean(item.artist, 240) || '未知歌手', source, ...(duration ? { duration } : {}) })
    seen.add(mid)
    if (tracks.length === 20) break
  }
  return tracks
}

/** Call after Electron app.whenReady(), using the app's own safeStorage name. */
export async function createRehearsalQQ(options: RehearsalQQOptions) {
  const project = resolve(options.project)
  let tracks: MusicTrack[] = [], available = false, disposed = false
  let reason = 'QQ音乐未登录，真实QQ点歌未测。'
  const counters = { apiRequests: { search: 0, details: 0, play: 0 }, blockedAccountChanges: 0, sourceVaultWrites: 0, streamRequests: 0, audioReadResponses: 0, audioBytesRead: 0, failedStreams: 0, cancelledStreams: 0, resolverRequests: 0, resolvedTracks: 0, failedResolves: 0 }
  const started = new Set<string>()
  let service: ReturnType<typeof createQQMusic> | undefined
  try { tracks = await chosenTracks(project, options.tracksFile) }
  catch { reason = '没有取得店长选定的QQ曲目，真实QQ点歌未测。' }
  const selected = new Set(tracks.map(track => midOf(track.source)!))
  // Never construct a source vault for another app, another profile, or a missing file.
  const sourceDirectory = join(project, '.local', 'user-data')
  if (existsSync(join(sourceDirectory, 'qq-music-session.enc.json'))) {
    try {
      const sourceVault = createQQVault(sourceDirectory)
      const secret = sourceVault.secret
      let snapshot = sourceVault.get()
      const parsed = snapshot ? object(JSON.parse(snapshot)) : {}
      if (typeof parsed.token === 'string' && parsed.token.length > 0 && parsed.token.length <= 60000 && !/[\r\n]/.test(parsed.token)) {
        {
          const previous = process.env.LOG_LEVEL
          let provider: typeof import('@yakult-green-tea/qq-music-api/serverless')
          try { process.env.LOG_LEVEL = 'silent'; provider = await import('@yakult-green-tea/qq-music-api/serverless') }
          finally { if (previous === undefined) delete process.env.LOG_LEVEL; else process.env.LOG_LEVEL = previous }
          service = createQQMusic({
            vault: {
              get: () => snapshot,
              // Intentionally memory-only. This can never call sourceVault.set().
              set(value) { snapshot = value },
            },
            isAllowed: mid => !disposed && selected.has(mid) && options.isAllowed(mid),
            request: async request => {
              const url = new URL(request.url)
              // Serverless sealed sessions do not refresh on reads. Explicitly deny every
              // login/refresh/logout/write route, even if the provider changes later.
              let operation: keyof typeof counters.apiRequests | undefined
              if (request.method === 'GET' && url.pathname === '/search') operation = 'search'
              else if (request.method === 'GET' && /^\/getSongInfo\/[A-Za-z0-9]{1,64}$/.test(url.pathname)) operation = 'details'
              else if (request.method === 'GET' && /^\/getMusicPlay\/[A-Za-z0-9]{1,64}$/.test(url.pathname)) operation = 'play'
              if (!operation || disposed) {
                counters.blockedAccountChanges++
                return new Response(JSON.stringify({ code: 403, message: '本次排练只读复用QQ授权，不登录、刷新或退出真实账号。' }), { status: 403, headers: { 'content-type': 'application/json' } })
              }
              counters.apiRequests[operation]++
              return provider.handleRequest(request, { QQ_SESSION_SECRET: secret })
            },
          })
          const status = await service.status()
          available = status.loggedIn
          reason = available ? '已只读复用保存的QQ授权，可接收自动QQ点歌；实际播放以舞台回执为准。' : '保存的QQ授权不可用，真实QQ点歌未测。'
        }
      }
    } catch { reason = '本项目QQ授权无法读取或解密，真实QQ点歌未测。' }
  }

  function metadata(): RehearsalQQMetadata {
    const state = !available ? 'skipped' : started.size ? 'played' : counters.audioBytesRead > 0 ? 'audio-read' : counters.failedStreams > 0 || counters.failedResolves > 0 ? 'failed' : 'not-tested'
    return {
      available, state, reason, authorizationMode: 'snapshot-read-only', selectedTracks: tracks.length,
      ...counters, apiRequests: { ...counters.apiRequests },
      playbackStarted: tracks.filter(track => started.has(midOf(track.source)!)).map(track => ({ id: track.id, title: track.title })),
    }
  }
  async function handle(request: Request): Promise<Response> {
    if (disposed || !available || !service) return unavailable(disposed ? '本次QQ点歌排练已结束。' : reason)
    counters.streamRequests++
    const mid = midOf(request.url)
    let consumerCancelled = false, cancellationCounted = false
    const expectedStop = (error?: unknown) => consumerCancelled || disposed || request.signal.aborted || isQQMusicStreamCancellation(error) || !!mid && !options.isAllowed(mid)
    const cancelled = () => { if (!cancellationCounted) { cancellationCounted = true; counters.cancelledStreams++ } }
    let response: Response
    try { response = await service.stream(request) }
    catch (error) { if (expectedStop(error)) { cancelled(); return unavailable('本次QQ音频请求已取消。', 499) }; counters.failedStreams++; reason = 'QQ音频请求未完成，本次尚未验证实际播放。'; return unavailable(reason) }
    if (!response.ok) {
      if (response.status === 499 || expectedStop()) { cancelled(); return response }
      if (response.status === 416 && /^bytes \*\/\d+$/.test(response.headers.get('content-range') || '')) return response
      counters.failedStreams++
      reason = 'QQ音频读取失败，请核对登录有效期与歌曲权限；失败不算播放成功。'
      return response
    }
    if (request.method === 'HEAD' || !response.body) return response
    const reader = response.body.getReader()
    let counted = false
    const body = new ReadableStream<Uint8Array>({
      async pull(output) {
        try {
          if (disposed) throw new Error('排练结束')
          const next = await reader.read()
          if (consumerCancelled) return
          if (next.done) { output.close(); reader.releaseLock(); return }
          if (next.value.byteLength > 0) {
            if (!counted) { counted = true; counters.audioReadResponses++; reason = 'QQ音频读取正常，实际播放以舞台回执为准。' }
            counters.audioBytesRead += next.value.byteLength
          }
          output.enqueue(next.value)
        } catch (error) {
          if (expectedStop(error)) { cancelled(); if (!consumerCancelled) output.error(Object.assign(new Error('本次QQ音频请求已取消。'), { name: 'AbortError' })) }
          else { counters.failedStreams++; reason = 'QQ音频流读取中断，请结合舞台实际播放回执核对。'; output.error(new Error('本次QQ音频流读取中断。')) }
          await reader.cancel().catch(() => undefined)
        }
      },
      async cancel() { consumerCancelled = true; cancelled(); await reader.cancel().catch(() => undefined) },
    })
    return new Response(body, { status: response.status, headers: response.headers })
  }
  function markPlaybackStarted(mid: string) {
    if (available && !disposed && selected.has(mid) && options.isAllowed(mid)) { started.add(mid); reason = 'QQ音乐已收到舞台实际播放回执；历史失败仍保留在计数中。' }
  }
  async function resolveTrack(query: string, signal?: AbortSignal): Promise<MusicTrack> {
    counters.resolverRequests++
    if (!available || !service || disposed) { counters.failedResolves++; throw new Error(disposed ? '本次QQ点歌排练已结束。' : reason) }
    try {
      const track = await service.resolve(query, signal)
      if (disposed || signal?.aborted) throw new Error('本次QQ点歌已取消。')
      const mid = midOf(track.source)
      if (!mid) throw new Error('QQ点歌未返回有效曲目。')
      selected.add(mid)
      if (!tracks.some(existing => existing.id === track.id)) tracks.push({ ...track })
      counters.resolvedTracks++
      return track
    } catch (error) { if (!disposed && !signal?.aborted) { counters.failedResolves++; reason = 'QQ自动点歌未能确认完整可播音源，未把失败当作成功。' }; throw error }
  }
  function dispose() { if (disposed) return; disposed = true; service?.dispose() }
  return { get available() { return available }, get reason() { return reason }, tracks, handle, resolve: resolveTrack, metadata, markPlaybackStarted, dispose }
}
