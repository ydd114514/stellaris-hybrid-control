import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createRehearsalControl, rehearsalLiveState, rehearsalLookConfig, type ControlEvent } from '../scripts/rehearsal-control'
import { createDefaultState } from '../packages/core/src/defaults'

const roots: string[] = []
it('真实排练允许切AI形象，服务密钥入口、音频路由和调用预算不能被顺带改写', () => {
  const current = createDefaultState().config
  const changed = rehearsalLookConfig(current, { ...current, voice: { ...current.voice, model: 'unwanted-model' }, audio: { ...current.audio, streamDeviceId: 'default' }, budget: { ...current.budget, sessionLimit: 999 }, look: { scheme: 'claude', outfit: 'crew', timeOfDay: 'auto' } })
  expect(changed.look).toEqual({ scheme: 'claude', outfit: 'crew', timeOfDay: 'auto' })
  expect(changed.voice).toEqual(current.voice); expect(changed.audio).toEqual(current.audio); expect(changed.budget).toEqual(current.budget)
  expect(() => rehearsalLookConfig(current, { look: { scheme: 'unknown', outfit: 'crew', timeOfDay: 'auto' } })).toThrow('现有AI形象')
})
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })))
function setup(options: Partial<Parameters<typeof createRehearsalControl>[0]> = {}) {
  const parent = resolve('.local/test-data'); mkdirSync(parent, { recursive: true })
  const root = mkdtempSync(join(parent, 'rehearsal-control-')); roots.push(root)
  const inject = vi.fn(async (_event: ControlEvent) => ({ ok: true, message: '模拟事件已接纳' }))
  const control = createRehearsalControl({ runDirectory: root, canInject: () => true, inject, now: () => 1000, ...options })
  const batch = (value: unknown) => { const temporary = join(root, 'control', 'new.json'); writeFileSync(temporary, JSON.stringify(value)); renameSync(temporary, control.inbox) }
  return { root, inject, control, batch }
}
const event = { kind: 'chat', userId: 'cat', name: '小猫', text: '店长刚才说的那杯热茶是什么味道？' }

describe('本轮隔离模拟观众控制文件', () => {
  it('只注入白名单事件、统一模拟前缀，batch去重并写安全回执', async () => {
    const { inject, control, batch } = setup()
    batch({ batchId: 'first', events: [{ ...event, id: 'same-event', origin: 'bridge', user: { id: 'owner' }, type: 'music-next', credentials: 'dummy-secret' }, { kind: 'gift', userId: 'cat', name: '模拟小猫', giftId: 'heart', giftName: '小心心', count: 5, comboKey: 'same-combo' }] })
    const ack = await control.poll(); await control.poll()
    expect(inject).toHaveBeenCalledTimes(2)
    expect(inject.mock.calls[0]![0]).toEqual({ ...event, name: '模拟·小猫', id: 'control:same-event' })
    expect(inject.mock.calls[1]![0]).toMatchObject({ userId: 'cat', name: '模拟小猫', comboKey: 'control:same-combo', count: 5 })
    expect(ack).toMatchObject({ batchId: 'first', accepted: true, results: [{ id: 'control:same-event', ok: true }, { ok: true }] })
    expect(readFileSync(control.ackFile, 'utf8')).not.toMatch(/dummy-secret|credentials|music-next/)
    expect(control.metadata()).toMatchObject({ acceptedBatches: 1, injectedEvents: 2, seenBatches: 1 })
  })
  it('整批验证后才执行，拒绝命令类型、21条、超长文本与超大文件', async () => {
    const { inject, control, batch } = setup()
    for (const [batchId, events] of [['bad-kind', [event, { ...event, kind: 'music-next' }]], ['too-many', Array.from({ length: 21 }, () => event)], ['too-long', [{ ...event, text: '字'.repeat(601) }]]] as const) {
      batch({ batchId, events }); expect((await control.poll())?.accepted).toBe(false)
    }
    writeFileSync(control.inbox, Buffer.alloc(65537, 32)); expect((await control.poll())?.error).toContain('64 KiB')
    expect(inject).not.toHaveBeenCalled()
  })
  it('只轮询四个固定入口，各actor相同batchId独立去重并有各自回执', async () => {
    const { root, inject, control } = setup()
    for (const [channel, path] of Object.entries(control.inboxes)) writeFileSync(path, JSON.stringify({ batchId: 'batch-1', events: [{ ...event, userId: channel }] }))
    writeFileSync(join(root, 'control/inbox-admin.json'), JSON.stringify({ batchId: 'not-allowed', events: [event] }))
    await control.poll(); await control.poll()
    expect(inject).toHaveBeenCalledTimes(4)
    expect(inject.mock.calls.map(([event]) => event.id)).toEqual(['control:batch-1:1', 'control:cat:batch-1:1', 'control:worker:batch-1:1', 'control:music:batch-1:1'])
    for (const [channel, path] of Object.entries(control.ackFiles)) expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ channel, batchId: 'batch-1', accepted: true })
    expect(JSON.parse(readFileSync(control.lastAckFile, 'utf8')).channel).toBe('music')
    expect(control.metadata()).toMatchObject({ acceptedBatches: 4, seenBatches: 4, injectedEvents: 4 })
  })
  it('拒绝inbox符号链接，不读取其他位置', async context => {
    const { root, inject, control } = setup(), target = join(root, 'other.json')
    writeFileSync(target, JSON.stringify({ batchId: 'outside', events: [event] }))
    try { symlinkSync(target, control.inbox) } catch (error) { if (process.platform === 'win32' && (error as NodeJS.ErrnoException).code === 'EPERM') { context.skip(); return }; throw error }
    expect((await control.poll())?.accepted).toBe(false); expect(inject).not.toHaveBeenCalled()
  })
  it('拒绝非普通inbox文件', async () => {
    const { control, inject } = setup()
    mkdirSync(control.inbox); expect((await control.poll())?.accepted).toBe(false); expect(inject).not.toHaveBeenCalled()
  })
  it('控制目录不能被链接替换，回执也不写到替换目的地', async () => {
    const { root, control, inject } = setup(), old = join(root, 'control-old'), replacement = join(root, 'replacement')
    mkdirSync(replacement); renameSync(join(root, 'control'), old); symlinkSync(replacement, join(root, 'control'), process.platform === 'win32' ? 'junction' : 'dir')
    writeFileSync(join(replacement, 'inbox.json'), JSON.stringify({ batchId: 'replaced', events: [event] }))
    expect((await control.poll())?.accepted).toBe(false); expect(inject).not.toHaveBeenCalled()
    expect(() => readFileSync(join(replacement, 'ack.json'))).toThrow()
  })
  it('最后30秒关闭注入，停止后不再读文件且在途批次不继续后续事件', async () => {
    const ending = setup({ canInject: () => false }); ending.batch({ batchId: 'ending', events: [event] })
    expect((await ending.control.poll())?.results[0]).toMatchObject({ ok: false }); expect(ending.inject).not.toHaveBeenCalled()
    let finish!: () => void
    const pending = new Promise<void>(done => { finish = done }), inject = vi.fn(async () => { await pending; return { ok: true } })
    const active = setup({ inject }); active.batch({ batchId: 'stopping', events: [event, event] })
    const polling = active.control.poll(); await Promise.resolve(); active.control.stop(); finish(); await polling
    expect(inject).toHaveBeenCalledOnce(); rmSync(active.control.inbox); mkdirSync(active.control.inbox)
    expect(await active.control.poll()).toBeUndefined()
  })
  it('实时状态仅白名单，最近25条回答，不导出配置、音频或源地址', () => {
    const state = createDefaultState(1000)
    state.stage.audio = { kind: 'url', url: 'https://audio.invalid/signed?token=dummy-secret', data: 'RAW_PCM_SECRET' }
    ;(state.config.voice as any).apiKey = 'dummy-secret'; (state.costs as any).secret = 'dummy-secret'
    state.history = Array.from({ length: 30 }, (_, index) => ({ id: `reply-${index}`, say: ['实际回答 dummy-secret'], heard: '刚才那句话', source: 'deepseek', status: 'done', face: 'happy', action: 'stand', station: 'counter', voiceStyle: '', createdAt: 1000 }))
    const snapshot = rehearsalLiveState(state, { startedAt: 1000, stopped: false, interactive: true, acceptingEvents: true }, value => String(value).replaceAll('dummy-secret', '[隐藏]'))
    const serialized = JSON.stringify(snapshot)
    expect(snapshot.history).toHaveLength(25); expect(snapshot.history[0]!.say).toEqual(['实际回答 [隐藏]'])
    expect(serialized).not.toMatch(/dummy-secret|RAW_PCM_SECRET|https:\/\/audio|apiKey|credentials|shop-qqmusic:\/\//)
    expect(snapshot.rations).toMatchObject({ balance: 100000, unknownRequests: 0 })
  })
})
