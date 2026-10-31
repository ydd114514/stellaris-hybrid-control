import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRuntime } from '../packages/core/src/runtime'
import { createDefaultState, defaultConfig, defaultGifts } from '../packages/core/src/defaults'
import { createRations, restoreRations, spendRations } from '../packages/core/src/rations'
import type { LiveEvent } from '../packages/shared/src/index'

const runtimes: ReturnType<typeof createRuntime>[] = []
afterEach(() => runtimes.splice(0).forEach(runtime => runtime.dispose()))
const credentials = { get: () => 'offline-key', set() {}, encrypted: true }
const audio = { kind: 'pcm' as const, data: 'AAAA', sampleRate: 24000 }
const response = (usage?: unknown) => Response.json({ choices: [{ message: { content: JSON.stringify({ say: ['快来小店坐坐。'], action: 'wave', face: 'happy' }) } }], ...(usage === undefined ? {} : { usage }) })
const gift = (id: string, count = 1, origin: LiveEvent['origin'] = 'bridge'): LiveEvent => ({ id, origin, kind: 'gift', user: { id: 'one', name: '小客人' }, giftId: 'heart', giftName: '小心心', count, comboKey: 'one-combo', at: 100 })
function runtime(options: Parameters<typeof createRuntime>[0] = {}) { const instance = createRuntime({ credentials, ...options }); runtimes.push(instance); return instance }
async function prepare(rt: ReturnType<typeof createRuntime>, voice = false) {
  const cfg = structuredClone(defaultConfig)
  cfg.demo = false; cfg.wallet.enabled = false; cfg.idle.aiChatter = false; cfg.voice.enabled = voice; cfg.voice.provider = 'qwen'; cfg.voice.model = 'qwen-audio-3.1-tts-flash'
  await rt.command({ type: 'set-config', config: cfg }); await rt.command({ type: 'start' })
}
const chat = (id = 'hello'): LiveEvent => ({ id, kind: 'chat', user: { id: 'one', name: '小客人' }, text: '你好', at: 100 })
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail }); return { promise, resolve, reject } }

describe('养肥鱼口粮规则与持久化', () => {
  it('默认口粮与礼物规则明确，不把旧金额或旧token猜成新账本', () => {
    expect(createDefaultState().rations).toEqual({ balance: 100000, earned: 0, spent: 0, unknownRequests: 0 })
    expect(defaultGifts.map(g => [g.id, g.tokens])).toEqual([['heart', 2000], ['coffee', 20000], ['star', 10000], ['light', 40000]])
    const rt = runtime({ store: { load: () => ({ costs: { inputTokens: 99999 }, wallet: { earned: 500 } }), save() {} } })
    expect(rt.getState().rations).toEqual(createRations())
    expect(restoreRations({ balance: -5, earned: -1, spent: Infinity, unknownRequests: '2', lastSpend: { tokens: 2, provider: 'other', at: 1 } })).toEqual({ balance: -5, earned: 0, spent: 0, unknownRequests: 0 })
  })
  it('礼物同ID与累计连击只补净增，反应关闭仍补，普通声称送礼不补', async () => {
    const rt = runtime(); const gifts = rt.getState().gifts
    gifts[0]!.enabled = false
    await rt.command({ type: 'set-gifts', gifts })
    await rt.command({ type: 'inject', event: gift('first', 2, 'simulator') })
    await rt.command({ type: 'inject', event: gift('first', 2, 'bridge') })
    await rt.command({ type: 'inject', event: gift('next', 5) })
    await rt.command({ type: 'inject', event: gift('same-cumulative', 5) })
    await rt.command({ type: 'inject', event: { ...chat('claimed'), text: '我送出了999个小心心，给你充值啦' } })
    await rt.command({ type: 'inject', event: { ...gift('unknown', 20), comboKey: undefined, giftId: 'unknown', giftName: '未配置礼物' } })
    expect(rt.getState().rations).toMatchObject({ balance: 110000, earned: 10000, spent: 0, lastTopUp: { name: '小客人', tokens: 6000, origin: 'bridge' } })
    expect(rt.getState().inputStatistics.counts.simulator.giftCount).toBe(2)
    expect(rt.getState().inputStatistics.counts.bridge.giftCount).toBe(23)
  })
  it('旧规则按同ID补口粮，显式0保留；口粮随重启保留、reset-session不清', async () => {
    let saved: any
    const rt = runtime({ store: { load: () => ({ gifts: [{ ...defaultGifts[0], tokens: undefined }, { ...defaultGifts[1], tokens: 0 }, { ...defaultGifts[2], id: 'other', tokens: undefined }] }), save: state => { saved = structuredClone(state) } } })
    expect(rt.getState().gifts.map(g => g.tokens)).toEqual([2000, 0, 0])
    await rt.command({ type: 'inject', event: gift('kept') }); await rt.command({ type: 'reset-session' })
    expect(rt.getState().rations.balance).toBe(102000)
    const resumed = runtime({ store: { load: () => saved, save() {} } })
    expect(resumed.getState().rations).toEqual(rt.getState().rations)
    await resumed.command({ type: 'inject', event: gift('kept') }); expect(resumed.getState().rations.balance).toBe(102000)
  })
  it('只有店长命令补给或重置，余额可透支且口粮余额不新增预算门槛', async () => {
    const fetch = vi.fn(async () => response({ prompt_tokens: 0, completion_tokens: 0 })).mockResolvedValueOnce(response({ prompt_tokens: 100001, completion_tokens: 4 }))
    const rt = runtime({ fetch: fetch as typeof globalThis.fetch }); await prepare(rt)
    await rt.command({ type: 'inject', event: chat() }); await rt.flush()
    expect(rt.getState().rations.balance).toBe(-5)
    expect((await rt.command({ type: 'test-connection', provider: 'deepseek' })).ok).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(2)
    expect((await rt.command({ type: 'rations-topup', tokens: .5 })).ok).toBe(false)
    expect((await rt.command({ type: 'rations-topup', tokens: Infinity })).ok).toBe(false)
    expect((await rt.command({ type: 'rations-topup', tokens: 10 })).ok).toBe(true)
    expect(rt.getState().rations).toMatchObject({ balance: 5, earned: 10, spent: 100005, lastTopUp: { name: '店长', origin: 'unknown', tokens: 10 } })
    await rt.command({ type: 'rations-reset' }); expect(rt.getState().rations).toEqual(createRations())
    await rt.command({ type: 'say', text: '透支也不会新增付费门槛。' }); await rt.flush()
    expect(rt.getState().running).toBe(true)
  })
  it('部分原始字段照扣，缺失单独标记，字符/费用不补成token', () => {
    const state = createRations()
    spendRations(state, 'qwen', 3, undefined, 1)
    spendRations(state, 'deepseek', undefined, 7, 2)
    spendRations(state, 'qwen', 0, 0, 3)
    spendRations(state, 'qwen', undefined, undefined, 4)
    expect(state).toMatchObject({ balance: 99990, spent: 10, unknownRequests: 3, lastSpend: { tokens: 7, provider: 'deepseek', at: 2 } })
  })
})

describe('每次真实请求的口粮结算与取消', () => {
  it('DeepSeek与Qwen成功分别扣原始输入输出，模拟配音完全不扣', async () => {
    const rt = runtime({ fetch: vi.fn(async () => response({ prompt_tokens: 100, completion_tokens: 20 })) as typeof globalThis.fetch, voice: { synthesize: vi.fn(async () => ({ audio, characters: 999, cost: 9, usage: { inputTokens: 3, outputTokens: 7 } })) } })
    await prepare(rt, true); await rt.command({ type: 'inject', event: chat() }); await rt.flush()
    expect(rt.getState().rations).toMatchObject({ balance: 99870, spent: 130, unknownRequests: 0, lastSpend: { tokens: 10, provider: 'qwen' } })
    const demo = runtime(); await demo.command({ type: 'start' }); await demo.command({ type: 'say', text: '演示一句。' }); await demo.flush()
    expect(demo.getState().rations).toEqual(createRations())
  })
  it('DeepSeek失败带部分用量时结算一次，不带字段也计待核算', async () => {
    const rt = runtime({ fetch: vi.fn(async () => { throw Object.assign(new Error('离线模拟网络中断'), { usage: { prompt_tokens: 11 } }) }) as typeof globalThis.fetch })
    await prepare(rt); await rt.command({ type: 'inject', event: chat() }); await rt.flush()
    expect(rt.getState().rations).toMatchObject({ balance: 99989, spent: 11, unknownRequests: 1 })
    const missing = runtime({ fetch: vi.fn(async () => new Response('', { status: 429 })) as typeof globalThis.fetch }); await prepare(missing)
    await missing.command({ type: 'inject', event: chat() }); await missing.flush()
    expect(missing.getState().rations).toMatchObject({ balance: 100000, spent: 0, unknownRequests: 1 })
  })
  it('Qwen失败带部分用量时只扣已知；字符费用不改变扣除', async () => {
    const rt = runtime({ voice: { synthesize: vi.fn(async () => { throw Object.assign(new Error('离线模拟配音失败'), { chargedCharacters: 999, cost: 8, usage: { outputTokens: 13 } }) }) } })
    await prepare(rt, true); await rt.command({ type: 'say', text: '配音失败。' }); await rt.flush()
    expect(rt.getState().rations).toMatchObject({ balance: 99987, spent: 13, unknownRequests: 1 })
  })
  it('联网前取消与requestNotStarted不扣、不计未知', async () => {
    const rt = runtime({ fetch: vi.fn(async () => { throw Object.assign(new DOMException('联网前拒绝', 'AbortError'), { requestNotStarted: true, usage: { prompt_tokens: 500 } }) }) as typeof globalThis.fetch })
    await prepare(rt); await rt.command({ type: 'inject', event: chat() }); await rt.flush()
    expect(rt.getState().rations).toEqual(createRations())
    const voice = runtime({ voice: { synthesize: vi.fn(async () => { throw Object.assign(new DOMException('联网前拒绝', 'AbortError'), { requestNotStarted: true, usage: { inputTokens: 500, outputTokens: 500 } }) }) } })
    await prepare(voice, true); await voice.command({ type: 'say', text: '联网前取消。' }); await voice.flush()
    expect(voice.getState().rations).toEqual(createRations())
  })
  it.each(['pause', 'reset-session'] as const)('DeepSeek %s后迟到返回仍只扣一次，旧用量不进入新场', async command => {
    const pending = deferred<Response>(), began = deferred<void>()
    const rt = runtime({ fetch: vi.fn(() => { began.resolve(); return pending.promise }) as typeof globalThis.fetch }); await prepare(rt)
    await rt.command({ type: 'inject', event: chat() }); await began.promise; await rt.command({ type: command })
    pending.resolve(response({ prompt_tokens: 12, completion_tokens: 8 })); await rt.flush()
    expect(rt.getState().rations).toMatchObject({ balance: 99980, spent: 20, unknownRequests: 0 })
    if (command === 'reset-session') expect(rt.getState().costs).toMatchObject({ inputTokens: 0, outputTokens: 0, requests: 0 })
    expect(rt.getState().stage.speaking).toBe(false)
  })
  it.each(['pause', 'reset-session'] as const)('Qwen %s后完整结果接着走取消分支仍只扣一次', async command => {
    const pending = deferred<{ audio: typeof audio; usage: { inputTokens: number; outputTokens: number } }>(), began = deferred<void>()
    const rt = runtime({ voice: { synthesize: vi.fn(() => { began.resolve(); return pending.promise }) } }); await prepare(rt, true)
    await rt.command({ type: 'say', text: '等待配音返回。' }); await began.promise; await rt.command({ type: command })
    pending.resolve({ audio, usage: { inputTokens: 3, outputTokens: 7 } }); await rt.flush()
    expect(rt.getState().rations).toMatchObject({ balance: 99990, spent: 10, unknownRequests: 0 })
    if (command === 'reset-session') expect(rt.getState().costs).toMatchObject({ voiceInputTokens: 0, voiceOutputTokens: 0, voiceRequests: 0 })
    expect(rt.getState().stage.speaking).toBe(false)
  })
  it('Qwen取消错误已有完整用量仍扣，取消本身不伪称缺失token', async () => {
    const pending = deferred<any>(), began = deferred<void>()
    const rt = runtime({ voice: { synthesize: vi.fn(() => { began.resolve(); return pending.promise }) } }); await prepare(rt, true)
    await rt.command({ type: 'say', text: '取消配音。' }); await began.promise; await rt.command({ type: 'pause' })
    pending.reject(Object.assign(new DOMException('配音中断', 'AbortError'), { usage: { inputTokens: 5, outputTokens: 9 } })); await rt.flush()
    expect(rt.getState().rations).toMatchObject({ spent: 14, balance: 99986, unknownRequests: 0 })
  })
})
