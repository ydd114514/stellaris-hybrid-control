import { constants } from 'node:fs'
import { lstat, open, readdir, realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'

export interface DiscoveredDouyinRoom { roomId: string; field: 'web_rid' | 'room_id' | 'roomID'; discoveredAt: number; source: 'companion-log'; candidate: true }
export interface DouyinRoomDiscoveryInfo { state: 'idle' | 'watching' | 'candidate' | 'stale' | 'unavailable'; message: string; lastCheckedAt?: number; lastCandidate?: DiscoveredDouyinRoom; updates: number }
interface Options { folder?: string; onRoom(room: DiscoveredDouyinRoom): void; onStatus?(info: DouyinRoomDiscoveryInfo): void; now?: () => number; intervalMs?: number }
const DEFAULT_FOLDER = join(homedir(), 'Library', 'Logs', 'Douyin Webcast Mate'), LIMIT = 256 * 1024, FRESH = 12 * 3600000
/** Only public room-number fields leave this function; no other log values are parsed. */
export function publicRoomFromTail(value: string): { roomId: string; field: DiscoveredDouyinRoom['field'] } | undefined {
  const found = new Map<DiscoveredDouyinRoom['field'], string>()
  const pattern = /(?:^|[^\w])(?:["']?)(web_rid|room_id|roomID)["']?\s*[:=]\s*["']?(\d{6,20})(?:["'])?(?![\dA-Za-z_.-])/gu
  for (const match of value.matchAll(pattern)) if (!/^0+$/u.test(match[2]!)) found.set(match[1] as DiscoveredDouyinRoom['field'], match[2]!)
  for (const field of ['web_rid', 'room_id', 'roomID'] as const) { const roomId = found.get(field); if (roomId) return { roomId, field } }
}
/** Watches only the companion's main log directory. Discovered numbers are candidates, never connection health. */
export function createDouyinRoomDiscovery(options: Options) {
  const folder = resolve(options.folder ?? DEFAULT_FOLDER), now = options.now ?? Date.now
  const testRoot = resolve(process.cwd(), '.local', 'test-data')
  const allowed = folder === resolve(DEFAULT_FOLDER) || folder.startsWith(testRoot + sep)
  let state: DouyinRoomDiscoveryInfo = { state: 'idle', message: '尚未自动发现伴侣日志房号。', updates: 0 }, running = false, disposed = false, generation = 0, busy = false
  let timer: ReturnType<typeof setTimeout> | undefined, previousIdentity = ''
  const seen = new Set<string>()
  const info = (): DouyinRoomDiscoveryInfo => ({ ...state, ...(state.lastCandidate ? { lastCandidate: { ...state.lastCandidate } } : {}) })
  function report(patch: Partial<DouyinRoomDiscoveryInfo>) { state = { ...state, ...patch }; try { options.onStatus?.(info()) } catch { /* A UI listener must not affect live output. */ } }
  async function check() {
    if (!running || busy || disposed) return
    busy = true; const ticket = generation
    try {
      if (process.platform === 'win32' && !options.folder) { report({ state: 'unavailable', message: 'Windows 请手填当前直播房间号或使用本机输入桥；当前不自动读取伴侣日志。', lastCheckedAt: now() }); return }
      if (!allowed || await realpath(folder) !== folder) throw new Error('folder')
      const entries = await readdir(folder, { withFileTypes: true }), logs: { path: string; at: number; size: number; ino: number; dev: number }[] = []
      for (const entry of entries) {
        if (!entry.isFile() || !/\.log$/iu.test(entry.name) || /^(?:native|metrics|media)(?:[._-]|$)/iu.test(entry.name)) continue
        const path = join(folder, entry.name), file = await lstat(path)
        if (file.isFile() && !file.isSymbolicLink()) logs.push({ path, at: file.mtimeMs, size: file.size, ino: file.ino, dev: file.dev })
      }
      if (ticket !== generation || !running) return
      logs.sort((a, b) => b.at - a.at || b.path.localeCompare(a.path))
      const newest = logs[0]
      if (!newest) { report({ state: 'watching', message: '等待伴侣主日志出现公共房号；尚未建立后台连接。', lastCheckedAt: now() }); return }
      if (now() - newest.at > FRESH || newest.at > now() + 300000) { report({ state: 'stale', message: '伴侣主日志过旧或时间异常，房号仅待发现，不自动选用；直播输出继续。', lastCheckedAt: now() }); return }
      const identity = `${newest.dev}:${newest.ino}:${newest.size}:${newest.at}`
      if (identity === previousIdentity) { report({ lastCheckedAt: now() }); return }
      const file = await open(newest.path, constants.O_RDONLY | constants.O_NOFOLLOW)
      let tail: string
      try {
        const opened = await file.stat()
        if (!opened.isFile() || opened.ino !== newest.ino || opened.dev !== newest.dev) throw new Error('changed')
        const length = Math.min(LIMIT, opened.size), bytes = Buffer.alloc(length)
        const read = await file.read(bytes, 0, length, Math.max(0, opened.size - length))
        tail = bytes.subarray(0, read.bytesRead).toString('utf8')
      } finally { await file.close() }
      if (ticket !== generation || !running || disposed || await realpath(folder) !== folder) return
      previousIdentity = identity
      const candidate = publicRoomFromTail(tail)
      if (!candidate) { report({ state: 'watching', message: '已检查伴侣最新主日志末尾，暂未发现完整公共房号；这不代表后台已连接。', lastCheckedAt: now() }); return }
      const room: DiscoveredDouyinRoom = { ...candidate, discoveredAt: now(), source: 'companion-log', candidate: true }, key = `${room.field}:${room.roomId}`
      report({ state: 'candidate', message: '伴侣日志发现房号候选；是否活动、是否连接成功由后台接收器核验。', lastCheckedAt: now(), lastCandidate: room })
      if (ticket !== generation || !running || disposed) return
      if (!seen.has(key)) { seen.add(key); while (seen.size > 64) seen.delete(seen.values().next().value!); state.updates++; try { options.onRoom({ ...room }) } catch { report({ message: '已发现公共房号候选，接收器暂未接受；直播输出继续。' }) } }
    } catch { if (ticket === generation && running && !disposed) report({ state: 'unavailable', message: '暂时无法读取允许的伴侣主日志，自动发现等待重试；不影响音视频输出。', lastCheckedAt: now() }) }
    finally { busy = false }
  }
  function schedule() { if (!running || disposed) return; const ticket = generation; timer = setTimeout(async () => { if (ticket !== generation || !running) return; await check(); if (ticket === generation) schedule() }, Math.max(2000, Math.min(3000, options.intervalMs ?? 2500))); timer.unref?.() }
  function stop() { generation++; running = false; if (timer) clearTimeout(timer); timer = undefined; report({ state: 'idle', message: '已停止从伴侣日志自动发现房号；音视频输出继续。' }) }
  return { async start() { if (disposed) return; if (running) return; running = true; generation++; previousIdentity = ''; seen.clear(); report({ state: 'watching', message: '正在检查伴侣最新主日志的公共房号字段；尚未建立后台连接。' }); await check(); schedule() }, stop, info, dispose() { stop(); disposed = true; seen.clear() } }
}
