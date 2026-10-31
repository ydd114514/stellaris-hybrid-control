import { afterEach, describe, expect, it, vi } from 'vitest'
import { createArrivalEngagement } from '../packages/core/src/arrival-engagement'
import { defaultConfig } from '../packages/core/src/defaults'
import { createRuntime } from '../packages/core/src/runtime'
import type { AppConfig, LiveEvent } from '../packages/shared/src'

const runtimes: ReturnType<typeof createRuntime>[] = []
afterEach(() => runtimes.splice(0).forEach(runtime => runtime.dispose()))
const morning = new Date(2026, 9, 26, 8, 0).getTime()
function make(change?: (config: AppConfig) => void) {
  const config = structuredClone(defaultConfig)
  config.demo = false; config.voice.enabled = true; config.voice.provider = 'qwen'
  config.idle.enabled = false; config.music.bgmEnabled = false
  change?.(config)
  const fetch = vi.fn<typeof globalThis.fetch>(async () => { throw new Error('离线测试禁止真实请求') })
  const voice = vi.fn(async (text: string) => ({ audio: undefined, characters: text.length, charactersReported: true }))
  const runtime = createRuntime({ now: () => morning, fetch, voice: { synthesize: voice }, credentials: { get: () => 'offline-fixture-key', set() {}, encrypted: true }, store: { load: () => ({ config }), save() {} } })
  runtimes.push(runtime)
  return { runtime, fetch, voice }
}
const event = (id: string, kind: LiveEvent['kind'] = 'enter', userId = id, name = id): LiveEvent => ({ id, kind, user: { id: userId, name }, at: morning, ...(kind === 'chat' ? { text: '你好' } : kind === 'gift' ? { giftId: 'heart', giftName: '小心心', count: 1 } : {}) })
const questions = (say: string[]) => say.join('').match(/[？?]/g)?.length || 0

describe('进场欢迎给一次轻巧的互动接点', () => {
  it('六种问题按新观众轮换，每条只有一个问题且没有关注送礼要求', () => {
    const engagement = createArrivalEngagement(() => morning)
    const lines = Array.from({ length: 6 }, (_, i) => engagement.invite({ userIds: [`viewer-${i}`], phase: 'morning', busy: false })!)
    expect(new Set(lines).size).toBe(6)
    for (const line of lines) { expect(questions([line])).toBe(1); expect(line).not.toMatch(/关注|礼物|送礼|小心心|token|教程/) }
  })
  it('同稳定ID十分钟内不重复邀请，批量合并的新成员也记入本轮', () => {
    let now = morning
    const engagement = createArrivalEngagement(() => now)
    const first = engagement.invite({ userIds: ['one'], phase: 'day', busy: false })!
    expect(engagement.invite({ userIds: ['one', 'two'], phase: 'day', busy: false, existing: first })).toBe(first)
    now += 599999
    expect(engagement.invite({ userIds: ['one', 'two'], phase: 'day', busy: false })).toBeUndefined()
    now++
    expect(engagement.invite({ userIds: ['one'], phase: 'day', busy: false })).not.toBe(first)
  })
  it('单人欢迎保留名字、用真实晨间问候，只有原来一次配音且零对话请求', async () => {
    const { runtime, fetch, voice } = make(config => { config.look.timeOfDay = 'night' })
    await runtime.command({ type: 'start' }); await runtime.command({ type: 'inject', event: event('arrival', 'enter', 'viewer', '阿黎') }); await runtime.flush()
    const reply = runtime.getState().history[0]!
    expect(reply.say.join('')).toContain('阿黎，早上好'); expect(questions(reply.say)).toBe(1)
    expect(fetch).not.toHaveBeenCalled(); expect(voice).toHaveBeenCalledTimes(1)
    expect(runtime.getState().config.idle).toMatchObject({ chatterSeconds: 120, hourlySpeechLimit: 24 })
  })
  it('三人同批欢迎逐人点名，只问一次、只做一次欢迎配音', async () => {
    const { runtime, fetch, voice } = make()
    for (const name of ['阿黎', '小周', '听雨']) await runtime.command({ type: 'inject', event: event(name) })
    await runtime.command({ type: 'start' }); await runtime.flush()
    const reply = runtime.getState().history[0]!
    for (const name of ['阿黎', '小周', '听雨']) expect(reply.say.join('')).toContain(name)
    expect(questions(reply.say)).toBe(1); expect(voice).toHaveBeenCalledTimes(1); expect(fetch).not.toHaveBeenCalled()
  })
  it('前一批欢迎还在说，新一批欢迎仍合并并附一次邀请', async () => {
    const { runtime, fetch } = make()
    await runtime.command({ type: 'start' }); await runtime.command({ type: 'inject', event: event('first') }); await runtime.flush()
    expect(questions(runtime.getState().history[0]!.say)).toBe(1)
    await Promise.all(['第二位', '第三位'].map(name => runtime.command({ type: 'inject', event: event(name) })))
    await runtime.flush()
    const waiting = runtime.getState().drafts.find(reply => reply.say.join('').includes('第二位'))!
    expect(waiting.say.join('')).toContain('第三位'); expect(questions(waiting.say)).toBe(1); expect(fetch).not.toHaveBeenCalled()
  })
  it.each(['chat', 'gift'] as const)('真实%s正在说或待回时仅短欢迎，不插新问题', async kind => {
    const { runtime, fetch } = make(config => { config.demo = true; config.voice.enabled = false })
    await runtime.command({ type: 'start' }); await runtime.command({ type: 'inject', event: event('talking', kind) }); await runtime.flush()
    await runtime.command({ type: 'inject', event: event('new-arrival') }); await runtime.flush()
    const waiting = runtime.getState().drafts.find(reply => reply.viewerName === 'new-arrival')!
    expect(waiting.say.join('')).toContain('欢迎进店'); expect(questions(waiting.say)).toBe(0); expect(fetch).not.toHaveBeenCalled()
  })
  it('普通暖场正在播不压掉新人的邀请', async () => {
    const { runtime } = make()
    await runtime.command({ type: 'start' }); await runtime.command({ type: 'say', text: '店猫把账本压住了。' }); await runtime.flush()
    await runtime.command({ type: 'inject', event: event('new-arrival') }); await runtime.flush()
    expect(questions(runtime.getState().drafts.find(reply => reply.viewerName === 'new-arrival')!.say)).toBe(1)
  })
  it('欢迎还没播时来了真实礼物，去掉待播欢迎中的问题', async () => {
    const { runtime } = make(config => { config.mode = 'manual' })
    await runtime.command({ type: 'start' }); await runtime.command({ type: 'inject', event: event('arrival') }); await runtime.flush()
    const welcome = runtime.getState().drafts[0]!
    expect(questions(welcome.say)).toBe(1)
    await runtime.command({ type: 'inject', event: event('gift', 'gift') }); await runtime.flush()
    await runtime.command({ type: 'approve', id: welcome.id }); await runtime.flush()
    expect(questions(runtime.getState().history[0]!.say)).toBe(0)
  })
  it('同一观众重复回场仍欢迎，但十分钟内不再追问', async () => {
    const { runtime } = make()
    await runtime.command({ type: 'start' }); await runtime.command({ type: 'inject', event: event('first', 'enter', 'one', '阿黎') }); await runtime.flush()
    await runtime.command({ type: 'inject', event: event('again', 'enter', 'one', '阿黎') }); await runtime.flush()
    const waiting = runtime.getState().drafts[0]!
    expect(waiting.say.join('')).toContain('阿黎'); expect(questions(waiting.say)).toBe(0)
  })
  it('完整播放后的邀请只给本人下一次短答临时接续，不进入永久记忆', async () => {
    const { runtime, fetch } = make(config => { config.voice.enabled = false })
    const bodies: any[] = []
    fetch.mockImplementation(async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)))
      return Response.json({ choices: [{ message: { content: JSON.stringify({ say: ['那就一起听着，我也晃晃尾巴。'], face: 'happy', action: 'music', memory_note: '喜欢听歌' }) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } })
    })
    const finish = async () => {
      const state = runtime.getState()
      if (state.stage.replyId) await runtime.command({ type: 'stage-event', event: { type: 'speech-ended', replyId: state.stage.replyId } })
      await runtime.command({ type: 'stage-event', event: { type: 'action-ended', commandId: runtime.getState().stage.commandId } }); await runtime.flush()
    }
    await runtime.command({ type: 'start' }); await runtime.command({ type: 'inject', event: event('enter', 'enter', 'one', '阿黎') }); await runtime.flush()
    const invitation = runtime.getState().history[0]!.say.at(-1)
    await finish()
    await runtime.command({ type: 'inject', event: { ...event('answer', 'chat', 'one', '阿黎'), text: '听' } }); await runtime.flush()
    expect(JSON.parse(bodies[0].messages.at(-1).content).此刻.刚才实际对这位客人说过的邀请.问句).toBe(invitation)
    expect(runtime.getState().viewers.find(viewer => viewer.id === 'one')?.memory?.facts).toBeUndefined()
    await finish()
    await runtime.command({ type: 'inject', event: { ...event('next', 'chat', 'one', '阿黎'), text: '尾巴挺灵活' } }); await runtime.flush()
    expect(JSON.parse(bodies[1].messages.at(-1).content).此刻.刚才实际对这位客人说过的邀请).toBeUndefined()
  })
  it.each(['draft', 'cancelled'] as const)('%s欢迎不能充当已经问过的邀请', async state => {
    const { runtime, fetch } = make(config => { config.voice.enabled = false; if (state === 'draft') config.mode = 'manual' })
    const bodies: any[] = []
    fetch.mockImplementation(async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)))
      return Response.json({ choices: [{ message: { content: JSON.stringify({ say: ['我在听。'], face: 'happy', action: 'listen' }) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } })
    })
    await runtime.command({ type: 'start' }); await runtime.command({ type: 'inject', event: event('enter', 'enter', 'one', '阿黎') }); await runtime.flush()
    if (state === 'cancelled') {
      const old = runtime.getState().stage.replyId!
      await runtime.command({ type: 'interrupt' })
      await runtime.command({ type: 'stage-event', event: { type: 'speech-ended', replyId: old } })
    }
    await runtime.command({ type: 'inject', event: { ...event('answer', 'chat', 'one', '阿黎'), text: '聊' } }); await runtime.flush()
    expect(JSON.parse(bodies[0].messages.at(-1).content).此刻.刚才实际对这位客人说过的邀请).toBeUndefined()
  })
})
