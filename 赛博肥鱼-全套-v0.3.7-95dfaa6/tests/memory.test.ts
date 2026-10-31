import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRuntime } from '../packages/core/src/runtime'
import { tierOf } from '../packages/core/src/memory'
import { parseClaimedGift } from '../packages/core/src/persona'
import type { LiveEvent } from '../packages/shared/src/index'

const runtimes: ReturnType<typeof createRuntime>[] = []
afterEach(() => { for (const rt of runtimes.splice(0)) rt.dispose(); vi.useRealTimers() })
let n = 0
const chat = (userId: string, text: string, name = `客人${userId}`): LiveEvent => ({ id: `m-${++n}`, kind: 'chat', user: { id: userId, name }, text, at: Date.now() })
const gift = (userId: string, giftId: string, count: number): LiveEvent => ({ id: `g-${++n}`, kind: 'gift', user: { id: userId, name: `客人${userId}` }, giftId, count, at: Date.now() })
const keys = { get: (provider: string) => provider === 'deepseek' ? 'sk-test-secret' : undefined, set: vi.fn(), encrypted: true }

/** A runtime with a scripted model. `answer` sees each request body and returns the json the model says. */
function withModel(answer: (body: any) => unknown = () => ({ say: ['好嘞。'], face: 'happy', action: 'wave' }), usage = { prompt_tokens: 1000, completion_tokens: 50, prompt_cache_hit_tokens: 800 }) {
  const bodies: any[] = []
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)); bodies.push(body)
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(answer(body)) } }], usage }), { status: 200 })
  })
  const rt = createRuntime({ credentials: keys, fetch: fetch as unknown as typeof globalThis.fetch })
  runtimes.push(rt)
  return { rt, bodies, fetch }
}
async function live(rt: ReturnType<typeof createRuntime>, patch: (c: any) => void = () => {}) {
  const config = structuredClone(rt.getState().config)
  config.demo = false; config.mode = 'supervised'; config.idle.enabled = false; config.voice.enabled = false
  patch(config)
  await rt.command({ type: 'set-config', config })
  await rt.command({ type: 'start' })
}
/** Lets her finish whatever she is saying, so the next line can go on air. */
async function finish(rt: ReturnType<typeof createRuntime>) {
  await rt.flush()
  const id = rt.getState().stage.replyId
  if (id) await rt.command({ type: 'stage-event', event: { type: 'speech-ended', replyId: id } })
  await rt.flush()
}

describe('每位客人独立的上下文线程与缓存', () => {
  it('回复某位客人时只带这位客人今晚的对话，前缀和上一次请求完全一致', async () => {
    const { rt, bodies } = withModel(body => ({ say: [`收到：${JSON.parse(body.messages.at(-1).content).audience_data.text}`], face: 'happy', action: 'wave' }))
    await live(rt)
    await rt.command({ type: 'inject', event: chat('a', '我叫阿离，喜欢下雨天') }); await finish(rt)
    await rt.command({ type: 'inject', event: chat('b', '店长晚上好') }); await finish(rt)
    await rt.command({ type: 'inject', event: chat('a', '你还记得我喜欢什么吗') }); await finish(rt)
    const third = bodies[2].messages.map((m: any) => m.content)
    expect(third.some((c: string) => c.includes('喜欢下雨天'))).toBe(true)
    // B's line is not in A's thread, only in the last message's "刚才店里" digest.
    expect(third.slice(0, -1).some((c: string) => c.includes('店长晚上好'))).toBe(false)
    expect(third.at(-1)).toContain('店长晚上好')
    // The cached prefix: everything A's first request sent before its last message is sent again unchanged.
    const first = bodies[0].messages.slice(0, -1)
    expect(bodies[2].messages.slice(0, first.length)).toEqual(first)
    expect(bodies[0].messages[0].content).toBe(bodies[1].messages[0].content)
  })

  it('按缓存命中计费并统计命中率', async () => {
    const { rt } = withModel()
    await live(rt, c => { c.brain.inputPrice = 2; c.brain.cachedInputPrice = .2; c.brain.outputPrice = 8 })
    await rt.command({ type: 'inject', event: chat('a', '你好') }); await rt.flush()
    const costs = rt.getState().costs
    expect(costs.cacheHitTokens).toBe(800)
    expect(costs.cacheMissTokens).toBe(200)
    expect(costs.session).toBeCloseTo((200 * 2 + 800 * .2 + 50 * 8) / 1e6, 10)
    expect(rt.getState().show.tokens).toBe(1050)
  })

  it('没人说话时用全局闲聊线程，客人一开口就先回应客人', async () => {
    vi.useFakeTimers()
    const { rt, bodies } = withModel(body => body.messages.at(-1).content.includes('situation') ? { say: ['今晚的雨下得真认真。'], face: 'happy', action: 'watch_rain' } : { say: ['来啦。'], face: 'happy', action: 'wave' })
    await live(rt, c => { c.idle.enabled = true; c.idle.seconds = 10; c.idle.chatterSeconds = 120 })
    await vi.advanceTimersByTimeAsync(152000); await rt.flush()
    expect(bodies).toHaveLength(1)
    expect(bodies[0].messages.at(-1).content).toContain('当前暂未收到新弹幕')
    // Spoken now, or right after the idle motion she started (a full-body motion finishes first).
    const lines = [...rt.getState().drafts, ...rt.getState().history].map(r => r.say.join(''))
    expect(lines.some(l => l.includes('雨下得真认真'))).toBe(true)
  })
})

describe('下播后的长期记忆', () => {
  it('只整理说过话的客人，贵客记得更多，隐私不进记忆，并写营业日志', async () => {
    const { rt, bodies } = withModel(body => {
      if (body.messages[0].content.includes('整理今晚的客人记忆')) {
        const viewers = JSON.parse(body.messages[1].content).viewers as { id: string }[]
        return { viewers: viewers.map(v => ({ id: v.id, summary: '爱喝热可可的夜猫子', facts: Array.from({ length: 15 }, (_, i) => i === 0 ? '手机号13812345678' : `记忆${i}`) })) }
      }
      if (body.messages[0].content.includes('营业日志')) return { summary: '今晚雨夜营业，阿暖包场送了好多热咖啡。' }
      return { say: ['好嘞。'], face: 'happy', action: 'wave' }
    })
    await live(rt)
    await rt.command({ type: 'inject', event: gift('vip', 'coffee', 12) }); await finish(rt)
    await rt.command({ type: 'inject', event: chat('vip', '今天也来喝咖啡') }); await finish(rt)
    await rt.command({ type: 'inject', event: chat('new', '第一次来') }); await finish(rt)
    await rt.command({ type: 'inject', event: gift('silent', 'heart', 1) }); await finish(rt)
    const ended = await rt.command({ type: 'end-show' })
    expect(ended.ok).toBe(true)
    const s = rt.getState()
    const vip = s.viewers.find(v => v.id === 'vip')!, guest = s.viewers.find(v => v.id === 'new')!, silent = s.viewers.find(v => v.id === 'silent')!
    expect(tierOf(vip)).toBe('vip')
    expect(vip.memory!.facts).toHaveLength(12)
    expect(guest.memory!.facts).toHaveLength(3)
    expect(vip.memory!.facts.join()).not.toContain('138')
    expect(silent.memory).toBeUndefined()
    expect(s.channel.shows).toBe(1)
    expect(s.channel.recaps[0]!.summary).toContain('雨夜营业')
    expect(s.show.turns).toBe(0)
    // Next show: the channel log sits in the cached prefix.
    await rt.command({ type: 'start' })
    await rt.command({ type: 'inject', event: chat('vip', '我又来啦') }); await rt.flush()
    expect(bodies.at(-1).messages[0].content).toContain('第2场')
    expect(bodies.at(-1).messages.at(-1).content).toContain('爱喝热可可的夜猫子')
  })

  it('试营业下播时不调模型，按客人原话存档', async () => {
    const rt = createRuntime(); runtimes.push(rt)
    await rt.command({ type: 'start' })
    await rt.command({ type: 'inject', event: chat('a', '我最喜欢下雨天了') }); await finish(rt)
    await rt.command({ type: 'end-show' })
    expect(rt.getState().viewers.find(v => v.id === 'a')!.memory!.facts[0]).toContain('我最喜欢下雨天了')
  })
})

describe('token 钱包', () => {
  it('真实花销扣钱包，礼物按一半价值充值，亏太多破产后只说免费台词', async () => {
    const { rt, fetch } = withModel(undefined, { prompt_tokens: 1_000_000, completion_tokens: 0, prompt_cache_hit_tokens: 0 })
    await live(rt, c => { c.brain.inputPrice = 8; c.wallet.start = 5; c.wallet.debtLimit = 2 })
    await rt.command({ type: 'inject', event: chat('a', '你好') }); await finish(rt)
    expect(rt.getState().wallet.balance).toBeCloseTo(-3)
    expect(rt.getState().wallet.bankrupt).toBe(true)
    const calls = fetch.mock.calls.length
    await rt.command({ type: 'inject', event: chat('b', '店长你还好吗') }); await finish(rt)
    expect(fetch.mock.calls.length).toBe(calls)
    await rt.command({ type: 'inject', event: gift('c', 'light', 3) }); await finish(rt)
    expect(rt.getState().wallet.earned).toBeCloseTo(3)
    expect(rt.getState().wallet.bankrupt).toBe(false)
  })

  it('开播初期嘴上送的礼物：照样道谢，但不记账、不涨进度', async () => {
    const rt = createRuntime(); runtimes.push(rt)
    await rt.command({ type: 'start' })
    const before = rt.getState()
    await rt.command({ type: 'inject', event: chat('a', '送出了火箭') }); await rt.flush()
    const s = rt.getState()
    expect(s.stage.text).toContain('火箭')
    expect(s.wallet.imagined).toBe(100)
    expect(s.wallet.balance).toBe(before.wallet.balance)
    expect(s.shop.points).toBe(before.shop.points)
    expect(parseClaimedGift('我送你3个小心心', [])).toEqual({ gift: '小心心', count: 3, yuan: .3 })
    expect(parseClaimedGift('今天送外卖好累', [])).toBeUndefined()
  })
})

describe('弹幕太多时的取舍', () => {
  it('进店欢迎合并成一句，送礼的人连着被回应两次后，没送礼的客人也能轮到', async () => {
    const { rt } = withModel(body => ({ say: [`回应${JSON.parse(body.messages.at(-1).content).audience_data.name}`], face: 'happy', action: 'wave' }))
    await live(rt)
    await rt.command({ type: 'inject', event: gift('p1', 'coffee', 1) }); await finish(rt)
    await rt.command({ type: 'inject', event: gift('p2', 'coffee', 1) }); await finish(rt)
    // Hold her mid-sentence so the room can pile up.
    await rt.command({ type: 'say', text: '稍等，我先说完这句。' }); await rt.flush()
    for (let i = 0; i < 5; i++) await rt.command({ type: 'inject', event: { id: `enter-${i}`, kind: 'enter', user: { id: `e${i}`, name: `路人${i}` }, at: Date.now() } })
    await rt.command({ type: 'inject', event: chat('p1', '我又来说话了') })
    await rt.command({ type: 'inject', event: chat('p2', '我也来说话') })
    await rt.command({ type: 'inject', event: chat('free', '我没送礼也想聊') })
    await rt.flush()
    const said: string[] = [], observed = new Set<string>()
    for (let i = 0; i < 6; i++) {
      await finish(rt); const stage = rt.getState().stage
      if (stage.replyId && !observed.has(stage.replyId)) { observed.add(stage.replyId); said.push(stage.text) }
    }
    expect(said.filter(t => t.includes('欢迎')).length).toBe(1)
    expect(said.some(t => t.includes('欢迎路人') && t.includes('进店'))).toBe(true)
    expect(said.some(t => t.includes('等5位') && t.includes('进店'))).toBe(true)
    // Two supporters in a row, then the viewer who sent nothing gets a turn before the next supporter.
    const order = [...new Set(said.map(t => t.replace(/^[^，]+，(?=回应)/, '')).filter(t => t.startsWith('回应')))]
    expect(order).toHaveLength(3)
    expect(order[2]).not.toBe('回应客人free')
  })
})

describe('打断与提前准备', () => {
  it('打断时正在准备的回复作废，但这位客人不会被跳过；暂停才清空', async () => {
    let release: (() => void) | undefined
    const bodies: any[] = []
    const fetch = vi.fn(async (_u: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)); bodies.push(body)
      const who = JSON.parse(body.messages.at(-1).content).audience_data.name
      if (who === '客人slow' && bodies.filter(b => JSON.parse(b.messages.at(-1).content).audience_data.name === '客人slow').length === 1) await new Promise<void>(r => { release = r; init.signal?.addEventListener('abort', () => r()) })
      if (init.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ say: [`回应${who}`], face: 'happy', action: 'wave' }) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 })
    })
    const rt = createRuntime({ credentials: keys, fetch: fetch as unknown as typeof globalThis.fetch }); runtimes.push(rt)
    await live(rt)
    await rt.command({ type: 'inject', event: chat('fast', '先到的') }); await rt.flush()
    await rt.command({ type: 'inject', event: chat('slow', '我在排队') })
    await new Promise(r => setTimeout(r, 10))
    expect(rt.getState().generating).toBe(true)
    await rt.command({ type: 'interrupt' }); release?.()
    await rt.flush(); await finish(rt)
    expect(rt.getState().stage.text).toBe('客人slow，回应客人slow')
    await rt.command({ type: 'inject', event: chat('later', '后来的') })
    await rt.command({ type: 'pause' })
    expect(rt.getState().queue).toHaveLength(0)
  })
})
