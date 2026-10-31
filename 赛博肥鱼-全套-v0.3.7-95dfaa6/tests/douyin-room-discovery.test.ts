import { mkdtemp, mkdir, rm, utimes, writeFile, appendFile, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createDouyinRoomDiscovery, publicRoomFromTail } from '../apps/desktop/electron/douyin-room-discovery'
const folders: string[] = [], readers: ReturnType<typeof createDouyinRoomDiscovery>[] = []
afterEach(async () => { readers.splice(0).forEach(reader => reader.dispose()); vi.useRealTimers(); await Promise.all(folders.splice(0).map(folder => rm(folder, { recursive: true, force: true }))) })
async function folder() { const root = join(process.cwd(), '.local/test-data'); await mkdir(root, { recursive: true }); const path = await mkdtemp(join(root, 'room-discovery-')); folders.push(path); return path }
it('只提取完整纯数字公共字段，web_rid优先并保持64位字符串', () => {
  expect(publicRoomFromTail('room_id=7123456789012345678 web_rid="90123456789012345678" roomID:123456')).toEqual({ field: 'web_rid', roomId: '90123456789012345678' })
  for (const source of ['room_id=12345','room_id=000000','room_id=123456789012345678901','room_id=123456.7','room_id=123456e3','private_room_id=123456']) expect(publicRoomFromTail(source)).toBeUndefined()
})
it('只看最新主日志末256KiB，忽略子目录与symlink，新增公共房号去重且不泄漏其它内容', async () => {
  vi.useFakeTimers(); const path = await folder(), now = Date.now(), room = vi.fn(), statuses: unknown[] = []
  await mkdir(join(path, 'native')); await writeFile(join(path, 'native', 'hidden.log'), 'web_rid=99999999')
  const old = join(path, 'old.log'), latest = join(path, 'latest.log')
  await writeFile(old, 'web_rid=88888888'); await utimes(old, new Date(now - 10000), new Date(now - 10000))
  await writeFile(latest, 'web_rid=77777777\n' + 'x'.repeat(256 * 1024 + 1000) + '\nroom_id="7123456789012345678"\nother_unrelated_value=do-not-expose')
  // A directory junction is also a reparse point and needs no Windows admin rights.
  if (process.platform === 'win32') await symlink(join(path, 'native'), join(path, 'symlink.log'), 'junction')
  else await symlink(old, join(path, 'symlink.log'))
  const reader = createDouyinRoomDiscovery({ folder: path, onRoom: room, onStatus: value => statuses.push(value) }); readers.push(reader)
  await reader.start(); expect(room).toHaveBeenCalledOnce(); expect(room.mock.calls[0]![0]).toMatchObject({ roomId: '7123456789012345678', field: 'room_id', candidate: true })
  await vi.advanceTimersByTimeAsync(2600); expect(room).toHaveBeenCalledOnce()
  await appendFile(latest, '\nweb_rid=90123456789012345678'); await vi.advanceTimersByTimeAsync(2600)
  await vi.waitFor(() => expect(room).toHaveBeenCalledTimes(2)); expect(room.mock.calls[1]![0].roomId).toBe('90123456789012345678')
  const rotated = join(path, 'new-main.log'); await writeFile(rotated, 'roomID=884466220011335577'); await utimes(rotated, new Date(Date.now()), new Date(Date.now()))
  await vi.advanceTimersByTimeAsync(2600); await vi.waitFor(() => expect(room).toHaveBeenCalledTimes(3))
  expect(room.mock.calls[2]![0]).toMatchObject({ field: 'roomID', roomId: '884466220011335577' })
  expect(JSON.stringify(statuses)).not.toContain('do-not-expose'); expect(reader.info().message).toContain('候选')
  reader.stop(); await appendFile(rotated, '\nweb_rid=66666666'); await vi.advanceTimersByTimeAsync(6000); expect(room).toHaveBeenCalledTimes(3)
})
it('房号后追加200KiB其它内容，仍能在有界尾部窗口发现公共room_id', async () => {
  const path = await folder(), room = vi.fn()
  await writeFile(join(path, 'latest.log'), 'room_id=7123456789012345678\n' + 'x'.repeat(200 * 1024))
  const reader = createDouyinRoomDiscovery({ folder: path, onRoom: room }); readers.push(reader)
  await reader.start()
  expect(room).toHaveBeenCalledOnce()
  expect(room.mock.calls[0]![0]).toMatchObject({ field: 'room_id', roomId: '7123456789012345678', candidate: true })
})
it('超过12小时不自动选用；非allowlisted目录不可读取，均不冒充后台connected', async () => {
  const path = await folder(), at = Date.now() - 13 * 3600000, file = join(path, 'stale.log'), room = vi.fn()
  await writeFile(file, 'room_id=7123456789012345678'); await utimes(file, new Date(at), new Date(at))
  const reader = createDouyinRoomDiscovery({ folder: path, onRoom: room }); readers.push(reader); await reader.start()
  expect(reader.info().state).toBe('stale'); expect(room).not.toHaveBeenCalled()
  const outside = createDouyinRoomDiscovery({ folder: '/tmp', onRoom: room }); readers.push(outside); await outside.start()
  expect(outside.info().state).toBe('unavailable'); expect(room).not.toHaveBeenCalled(); expect(JSON.stringify(outside.info())).not.toContain('connected')
})
