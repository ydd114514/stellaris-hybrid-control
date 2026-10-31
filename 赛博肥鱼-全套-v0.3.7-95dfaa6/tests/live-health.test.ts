import { expect, test } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createDefaultState } from '../packages/core/src/defaults'
import { createLiveHealthReporter, liveHealthSnapshot } from '../apps/desktop/electron/live-health'
test('只读健康记录不含当前音频、聊天和密钥，退出状态不会声称仍在播放', () => {
  const state = createDefaultState(); state.running = true; state.stage.speaking = true; state.stage.text = '私密聊天不应进入监控'; state.stage.audio = { kind: 'pcm', data: 'PRIVATE_AUDIO' }
  state.connection.voice = '失败 https://service.invalid/signed sk-secret-test123'
  const snapshot = liveHealthSnapshot(state, 1234), data = JSON.stringify(snapshot)
  expect(data).not.toContain('PRIVATE_AUDIO'); expect(data).not.toContain(state.stage.text); expect(data).not.toContain('sk-secret-test123'); expect(data).not.toContain('service.invalid')
  expect(snapshot.running).toBe(true); expect(liveHealthSnapshot(state, 1234, true)).toMatchObject({ closed: true, running: false, stage: { speaking: false } })
})
test('输入诊断只保留固定非负整数，不泄漏房号昵称原文与未知键', () => {
  const diagnostics = { primary: { room: 'PRIVATE_ROOM', methods: { gift: 2, chat: 3, token: 'PRIVATE_TOKEN', other: Number.POSITIVE_INFINITY }, giftRejections: { count: 1, malformed: -1, identity: 'PRIVATE_ID' } }, screen: { frames: 390, candidates: 2, errorCount: 0, lastFrameAt: 123456, windowId: 'PRIVATE_WINDOW', message: 'PRIVATE_TEXT' }, failover: { deliveredBridge: 13, deliveredScreen: 0, ignored: 2, duplicates: 0, pendingScreenGifts: 0, room: 'PRIVATE_ROOM', bad: 1, userName: 'PRIVATE_NAME' } }
  const snapshot = liveHealthSnapshot(createDefaultState(), 1234, false, diagnostics)
  expect(snapshot.input.diagnostics).toEqual({ primary: { methods: { chat: 3, gift: 2 }, giftRejections: { count: 1 } }, screen: { frames: 390, candidates: 2, errorCount: 0, lastFrameAt: 123456 }, failover: { deliveredBridge: 13, deliveredScreen: 0, ignored: 2, duplicates: 0, pendingScreenGifts: 0 } })
  expect(JSON.stringify(snapshot)).not.toContain('PRIVATE_')
  expect(liveHealthSnapshot(createDefaultState(), 1234, false, {}).input.diagnostics).toEqual({})
})
test('未初始化或抛错的诊断回调不妨碍健康文件，仅读取自己的临时目录', () => {
  const folder = mkdtempSync(join(tmpdir(), 'fish-health-test-'))
  let reporter: ReturnType<typeof createLiveHealthReporter> | undefined
  try { reporter = createLiveHealthReporter(folder, () => createDefaultState(), 10000, () => { throw new Error('PRIVATE_ERROR') }); const data = JSON.parse(readFileSync(reporter.path, 'utf8')); expect(data.input.diagnostics).toEqual({}); expect(JSON.stringify(data)).not.toContain('PRIVATE_ERROR'); reporter.stop(); expect(JSON.parse(readFileSync(reporter.path, 'utf8')).closed).toBe(true) }
  finally { reporter?.stop(); rmSync(folder, { recursive: true, force: true }) }
})
