import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export interface RehearsalAudioLease { pid: number; startedAt: number; expiresAt: number }

function read(path: string): RehearsalAudioLease | undefined {
  try {
    const raw = readFileSync(path, 'utf8')
    if (raw.length > 4096) return
    const value = JSON.parse(raw)
    if (Number.isInteger(value?.pid) && value.pid > 0 && Number.isFinite(value.startedAt) && Number.isFinite(value.expiresAt)) return value
  } catch { /* Missing or stale partial markers have no live owner. */ }
}

/** Only coordinates this project's rehearsal/primary app; never changes a system audio device. */
export function acquireRehearsalAudioLease(project: string, options: { pid?: number; now?: () => number; durationMs: number; isAlive?: (pid: number) => boolean }) {
  const now = options.now || Date.now, pid = options.pid || process.pid
  const folder = join(project, '.local/live-rehearsals'), path = join(folder, 'active-audio.json')
  const isAlive = options.isAlive || ((candidate: number) => { try { process.kill(candidate, 0); return true } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM' } })
  mkdirSync(folder, { recursive: true, mode: 0o700 })
  const previous = read(path)
  if (previous && previous.expiresAt > now() && isAlive(previous.pid)) throw new Error('已有另一轮测试占用小店专用音频，请先结束那轮测试。')
  if (existsSync(path)) unlinkSync(path)
  const startedAt = now(), value: RehearsalAudioLease = { pid, startedAt, expiresAt: startedAt + options.durationMs }
  try { writeFileSync(path, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' }); chmodSync(path, 0o600) }
  catch { throw new Error('无法取得本轮专用音频占用权，测试未开始。') }
  let released = false
  const owns = () => { const current = read(path); return current?.pid === pid && current.startedAt === startedAt }
  return {
    path, value,
    assertOwned() { if (released || !owns() || now() >= value.expiresAt) throw new Error('本轮专用音频占用权已失效，已停止测试。') },
    release() { if (released) return false; released = true; if (!owns()) return false; try { unlinkSync(path); return true } catch { return false } },
  }
}
