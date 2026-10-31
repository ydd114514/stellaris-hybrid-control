import { afterEach, expect, test } from 'vitest'
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readAudioReservation } from '../apps/desktop/electron/audio-reservation'

const folders: string[] = []
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }) })
const fixture = (value: unknown) => { const folder = mkdtempSync(join(tmpdir(), 'fish-audio-reservation-')); folders.push(folder); const file = join(folder, 'active.json'); writeFileSync(file, JSON.stringify(value)); return file }
const active = { pid: 12345, startedAt: 9000, expiresAt: 50000 }
test('有效的独立测试占用可被主工作台识别', () => { expect(readAudioReservation(fixture(active), 10000, () => true)).toEqual(active) })
test('测试已退出或占用过期时不会继续静音主工作台', () => {
  const file = fixture(active)
  expect(readAudioReservation(file, 10000, () => false)).toBeUndefined()
  expect(readAudioReservation(file, 50000, () => true)).toBeUndefined()
})
test('错误时间、PID、超长占用与损坏文件不会锁住声音', () => {
  for (const value of [{ ...active, pid: -1 }, { ...active, pid: 1.5 }, { ...active, startedAt: 16000 }, { ...active, expiresAt: 1500000 }, null]) expect(readAudioReservation(fixture(value), 10000, () => true)).toBeUndefined()
  const file = fixture(active); writeFileSync(file, '{'); expect(readAudioReservation(file, 10000, () => true)).toBeUndefined()
})
test('占用文件不能借助链接读取其他资料', context => {
  const file = fixture(active), link = `${file}.link`
  try { symlinkSync(file, link) } catch (error) { if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') { context.skip(); return }; throw error }
  expect(readAudioReservation(link, 10000, () => true)).toBeUndefined()
})
test('拒绝超大占用文件', () => {
  const file = fixture(active)
  writeFileSync(file, 'x'.repeat(1025)); expect(readAudioReservation(file, 10000, () => true)).toBeUndefined()
})
