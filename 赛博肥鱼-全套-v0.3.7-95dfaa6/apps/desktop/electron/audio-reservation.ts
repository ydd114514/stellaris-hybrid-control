import { lstatSync, readFileSync } from 'node:fs'

export interface AudioReservation { pid: number; startedAt: number; expiresAt: number }

/** A short-lived, project-local reservation prevents two app instances from mixing into BlackHole. */
export function readAudioReservation(path: string, now = Date.now(), alive = (pid: number) => {
  try { process.kill(pid, 0); return true } catch { return false }
}): AudioReservation | undefined {
  try {
    const file = lstatSync(path)
    if (!file.isFile() || file.isSymbolicLink() || file.size > 1024) return
    const value = JSON.parse(readFileSync(path, 'utf8'))
    if (!Number.isSafeInteger(value.pid) || value.pid <= 0 || !Number.isFinite(value.startedAt) || !Number.isFinite(value.expiresAt)) return
    if (value.startedAt > now + 5000 || value.expiresAt <= now || value.expiresAt - value.startedAt > 20 * 60 * 1000 || !alive(value.pid)) return
    return { pid: value.pid, startedAt: value.startedAt, expiresAt: value.expiresAt }
  } catch { return }
}
