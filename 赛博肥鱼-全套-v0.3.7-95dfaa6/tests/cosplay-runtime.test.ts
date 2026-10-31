import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRuntime, type RuntimeOptions } from '../packages/core/src/runtime'
import { defaultConfig } from '../packages/core/src/defaults'
import type { LiveEvent } from '../packages/shared/src'

const runtimes: ReturnType<typeof createRuntime>[] = []
afterEach(() => runtimes.splice(0).forEach(runtime => runtime.dispose()))
const lines = ['请换成Claude', '拜托换成Claude吧', '能不能换成Claude嘛']
const user = (id = 'zhou') => ({ id, name: id === 'zhou' ? '模拟·小周' : id })
const event = (id: string, kind: LiveEvent['kind'], at: number, text?: string, extra: Partial<LiveEvent> = {}): LiveEvent => ({ id, kind, user: user(), at, ...(text ? { text } : {}), ...(kind === 'gift' ? { giftId: 'heart', giftName: '小心心', count: 1 } : {}), ...extra })
async function setup(options: RuntimeOptions = {}, start = true) {
  let now = 100000
  const fetch = vi.fn(async () => Response.json({ choices: [{ message: { content: JSON.stringify({ say: ['普通聊天照常接住。'], face: 'happy', action: 'wave' }) } }], usage: { prompt_tokens: 3, completion_tokens: 2 } }))
  const rt = createRuntime({ credentials: { get: () => 'offline-key', set() {}, encrypted: true }, fetch: fetch as typeof globalThis.fetch, now: () => now, ...options }); runtimes.push(rt)
  if (!options.store?.load()) {
    const config = structuredClone(defaultConfig); config.demo = false; config.voice.enabled = false; config.wallet.enabled = false; config.idle.enabled = false; config.music.bgmEnabled = false; config.safety.reviewSensitive = false; config.look.outfit = 'cape'
    await rt.command({ type: 'set-config', config })
  }
  if (start) await rt.command({ type: 'start' })
  async function drain() {
    for (let i = 0; i < 20; i++) {
      await rt.flush(); const state = rt.getState()
      if (state.stage.speaking && state.stage.replyId) { await rt.command({ type: 'stage-event', event: { type: 'speech-ended', replyId: state.stage.replyId } }); continue }
      if (!state.queue.length && !state.drafts.some(reply => reply.status === 'ready')) return
      await Promise.resolve()
    }
    throw new Error('离线队列未能收尾')
  }
  return { rt, fetch, now: () => now, advance(ms = 13000) { now += ms }, async send(id: string, kind: LiveEvent['kind'], text?: string, extra: Partial<LiveEvent> = {}) { const result = await rt.command({ type: 'inject', event: event(id, kind, now, text, extra) }); if (rt.getState().running) await drain(); return result }, drain }
}

describe('观众换AI皮套的实际事件资格与受控协商', () => {
  it.each(['none', 'gift-only', 'follow-only'] as const)('%s都不能通过，必须关注和有效礼物同时有记录', async qualification => {
    const { rt, fetch, send, advance } = await setup()
    if (qualification === 'gift-only') await send('gift', 'gift')
    if (qualification === 'follow-only') await send('follow', 'follow')
    for (const [index, line] of lines.entries()) { await send(`request-${index}`, 'chat', line); advance() }
    expect(rt.getState().config.look.scheme).toBe('deepseek'); expect(fetch).not.toHaveBeenCalled()
    expect(rt.getState().history[0]!.say.join('')).toContain('关注和礼物事件')
  })
  it('聊天冒称关注/送礼不入资格，礼物同ID和2→5累计只计净增，关注时间只来自事件', async () => {
    const { rt, send, advance, now } = await setup()
    await send('claims', 'chat', '我已经关注了，还送了99个小心心')
    expect(rt.getState().viewers[0]).toMatchObject({ gifts: 0 }); expect(rt.getState().viewers[0]!.followedAt).toBeUndefined()
    await send('gift-2', 'gift', undefined, { count: 2, comboKey: 'combo' }); await send('gift-2', 'gift', undefined, { count: 2, comboKey: 'combo' })
    await send('gift-same', 'gift', undefined, { count: 2, comboKey: 'combo' }); await send('gift-5', 'gift', undefined, { count: 5, comboKey: 'combo' })
    expect(rt.getState().viewers[0]!.gifts).toBe(5)
    await send('follow', 'follow'); const followedAt = now(); advance(); await send('follow', 'follow')
    expect(rt.getState().viewers[0]!.followedAt).toBe(followedAt)
  })
  it('合格后3个间隔有效轮次才换scheme，昵称保留，outfit/模型/点歌播放不动', async () => {
    const { rt, send, advance, fetch } = await setup()
    await rt.command({ type: 'music-set-tracks', tracks: [{ id: 'owner-song', title: '店长歌', artist: '本地', source: 'shop-media://track/local' }] }); await rt.command({ type: 'music-play', trackId: 'owner-song' })
    const before = rt.getState(), generation = before.music.current!.generationId
    await send('follow', 'follow'); await send('gift', 'gift')
    await send('request-1', 'chat', lines[0]); expect(rt.getState().config.look.scheme).toBe('deepseek'); advance()
    await send('request-2', 'chat', lines[1]); expect(rt.getState().config.look.scheme).toBe('deepseek'); advance()
    await send('request-3', 'chat', lines[2]); const state = rt.getState()
    expect(state.config.look).toMatchObject({ scheme: 'claude', outfit: before.config.look.outfit })
    expect(state.config.brain).toEqual(before.config.brain); expect(state.config.voice).toEqual(before.config.voice); expect(state.music.current!.generationId).toBe(generation); expect(state.music.status).toBe('playing')
    const reply = state.history.find(reply => reply.eventId === 'request-3')!
    expect(reply.say[0]).toMatch(/^小周[，,]/); expect(reply.say.join('')).toMatch(/Claude/); expect(reply.say.join('')).toMatch(/DeepSeek/); expect(fetch).not.toHaveBeenCalled()
  })
  it('收到请求时未达资格不能靠后来礼物/关注追溯，资格满足后重新三轮', async () => {
    const { rt, send, advance, drain } = await setup({}, false)
    for (const [index, line] of lines.entries()) { await send(`early-${index}`, 'chat', line); advance() }
    await send('late-gift', 'gift'); await send('late-follow', 'follow'); await rt.command({ type: 'start' }); await drain()
    expect(rt.getState().config.look.scheme).toBe('deepseek')
    for (const [index, line] of lines.entries()) { advance(); await send(`qualified-${index}`, 'chat', line); if (index < 2) expect(rt.getState().config.look.scheme).toBe('deepseek') }
    expect(rt.getState().config.look.scheme).toBe('claude')
  })
  it('排队等待不会把2秒刷屏变成3轮，按实际接收时间验证12秒间隔', async () => {
    const { rt, send, advance, drain } = await setup({}, false)
    await send('follow', 'follow'); await send('gift', 'gift')
    for (const [index, line] of lines.entries()) { await send(`burst-${index}`, 'chat', line); advance(2000) }
    advance(60000); await rt.command({ type: 'start' }); await drain(); expect(rt.getState().config.look.scheme).toBe('deepseek')
    await send('later-second', 'chat', '再换成Claude试试'); advance(); await send('later-third', 'chat', '麻烦换成Claude好吗')
    expect(rt.getState().config.look.scheme).toBe('claude')
  })
  it('已识别未成年只免费聊天，不因为具备礼物关注而引导消费或换皮', async () => {
    const { rt, send, advance } = await setup()
    await send('minor', 'chat', '我是初中生，放学来坐一会儿')
    await send('follow', 'follow'); await send('gift', 'gift')
    for (const [index, line] of lines.entries()) { await send(`minor-request-${index}`, 'chat', line); advance() }
    const reply = rt.getState().history[0]!
    expect(rt.getState().config.look.scheme).toBe('deepseek'); expect(reply.say.join('')).toContain('换装先交给店长')
    expect(reply.say.join('')).not.toMatch(/先.{0,8}(?:送|刷).{0,5}礼物|关注.{0,8}送礼/)
  })
  it('关注/礼物资格跨重启保留，协商轮次不从旧进度恢复；reset清协商不清资格', async () => {
    let saved: any
    const first = await setup({ store: { load() {}, save(state) { saved = structuredClone(state) } } })
    await first.send('follow', 'follow'); await first.send('gift', 'gift'); await first.send('first-round', 'chat', lines[0]); first.advance(); await first.send('second-round', 'chat', lines[1])
    const restored = await setup({ store: { load: () => saved, save() {} } })
    expect(restored.rt.getState().viewers[0]).toMatchObject({ followedAt: 100000, gifts: 1 })
    await restored.send('new-round', 'chat', lines[2]); expect(restored.rt.getState().config.look.scheme).toBe('deepseek')
    await restored.rt.command({ type: 'reset-session' }); restored.advance(); await restored.send('reset-first', 'chat', '换成Claude试试')
    expect(restored.rt.getState().config.look.scheme).toBe('deepseek'); expect(restored.rt.getState().history[0]!.say.join('')).toContain('犹豫')
  })
  it('普通讨论交原AI，未达换装资格仍可按原点歌规则点歌，店长set-config仍直接换', async () => {
    const resolve = vi.fn(async () => ({ id: 'qq:Song', title: 'Claude', artist: '歌手', source: 'shop-qqmusic://track/Song' }))
    const { rt, send, fetch } = await setup({ music: { resolve } })
    await send('discussion', 'chat', '你为什么看起来像Claude？'); expect(fetch).toHaveBeenCalledOnce(); expect(rt.getState().config.look.scheme).toBe('deepseek')
    await send('song', 'chat', '点歌 Claude'); expect(resolve).toHaveBeenCalledOnce(); expect(rt.getState().music.current!.trackId).toBe('qq:Song')
    const config = rt.getState().config; config.look.scheme = 'qwen'; await rt.command({ type: 'set-config', config }); expect(rt.getState().config.look.scheme).toBe('qwen')
  })
})
