import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { acquireRehearsalAudioLease } from '../scripts/rehearsal-audio-lease'

const folders: string[] = []
function project() { const directory = mkdtempSync(join(tmpdir(), 'fish-rehearsal-lease-')); folders.push(directory); return directory }
afterEach(() => { for (const directory of folders.splice(0)) rmSync(directory, { recursive: true, force: true }) })

describe('真实演练单源音频占用', () => {
  it('只写本项目标记，权限600，结束可重复清理且不影响别的目录', () => {
    const directory = project(), lease = acquireRehearsalAudioLease(directory, { pid: 123, now: () => 1000, durationMs: 5000, isAlive: () => true })
    expect(lease.path).toBe(join(directory, '.local/live-rehearsals/active-audio.json'))
    expect(JSON.parse(readFileSync(lease.path, 'utf8'))).toEqual({ pid: 123, startedAt: 1000, expiresAt: 6000 })
    // Windows uses ACLs; POSIX chmod bits are not represented by stat().
    if (process.platform !== 'win32') expect(statSync(lease.path).mode & 0o777).toBe(0o600)
    expect(() => lease.assertOwned()).not.toThrow(); expect(lease.release()).toBe(true); expect(lease.release()).toBe(false)
    expect(existsSync(lease.path)).toBe(false)
  })
  it('有效且存活的另一轮测试不能被抢占', () => {
    const directory = project(), first = acquireRehearsalAudioLease(directory, { pid: 111, now: () => 1000, durationMs: 5000, isAlive: () => true })
    expect(() => acquireRehearsalAudioLease(directory, { pid: 222, now: () => 2000, durationMs: 5000, isAlive: () => true })).toThrow('已有另一轮')
    expect(JSON.parse(readFileSync(first.path, 'utf8')).pid).toBe(111)
  })
  it('只有自己的pid与启动时间都匹配才删除，不能误删后来的轮次', () => {
    const directory = project(), first = acquireRehearsalAudioLease(directory, { pid: 111, now: () => 1000, durationMs: 5000, isAlive: () => true })
    writeFileSync(first.path, JSON.stringify({ pid: 222, startedAt: 2000, expiresAt: 9000 }))
    expect(() => first.assertOwned()).toThrow('失效'); expect(first.release()).toBe(false)
    expect(JSON.parse(readFileSync(first.path, 'utf8')).pid).toBe(222)
  })
  it('已过期或进程已死的残留标记可恢复，过期自己立即失去占用权', () => {
    const directory = project(); let now = 1000
    const first = acquireRehearsalAudioLease(directory, { pid: 111, now: () => now, durationMs: 1000, isAlive: () => true })
    now = 2000; expect(() => first.assertOwned()).toThrow('失效')
    const second = acquireRehearsalAudioLease(directory, { pid: 222, now: () => now, durationMs: 5000, isAlive: () => true })
    expect(first.release()).toBe(false)
    const third = acquireRehearsalAudioLease(directory, { pid: 333, now: () => now + 100, durationMs: 5000, isAlive: () => false })
    expect(second.release()).toBe(false); expect(third.release()).toBe(true)
  })
})
