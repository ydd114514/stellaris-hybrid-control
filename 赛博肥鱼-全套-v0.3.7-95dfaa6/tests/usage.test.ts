import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRuntime } from '../packages/core/src/runtime'
import { defaultConfig } from '../packages/core/src/defaults'
import { calculateVoiceUsage, usageNumber, voiceBillingUnit } from '../packages/core/src/usage'
import type { AppConfig } from '../packages/shared/src/index'

const voiceConfig = (model = 'qwen-audio-3.1-tts-flash') => ({ ...defaultConfig.voice, model, inputPrice: 1.5, outputPrice: 12, pricePer10kChars: 1 })
const runtimes: ReturnType<typeof createRuntime>[] = []
afterEach(() => runtimes.splice(0).forEach(runtime => runtime.dispose()))
const keys = { get: () => 'offline-test-key', set() {}, encrypted: true }
const response = (usage?: unknown) => Response.json({ choices: [{ message: { content: JSON.stringify({ say: ['欢迎来小店坐坐。'], action: 'wave', face: 'happy' }) } }], ...(usage ? { usage } : {}) })
const audio = { kind: 'pcm' as const, data: 'AAAA', sampleRate: 24000 }
function runtime(options: Parameters<typeof createRuntime>[0] = {}) {
  const instance = createRuntime({ credentials: keys, ...options }); runtimes.push(instance); return instance
}
function config(model = 'qwen-audio-3.1-tts-flash'): AppConfig {
  const value = structuredClone(defaultConfig)
  value.demo = false; value.idle.aiChatter = false; value.wallet.enabled = false
  value.brain.inputPrice = 2; value.brain.cachedInputPrice = .2; value.brain.outputPrice = 8
  value.voice = { ...voiceConfig(model), provider: 'qwen' }
  return value
}

describe('真实用量与模型计费口径', () => {
  it('3.1 Flash按输入和输出音频token估价，不混入字符费用', () => {
    const data = calculateVoiceUsage({ usage: { inputTokens: 54, outputTokens: 125 }, characters: 100, charactersReported: true }, voiceConfig())
    expect(data).toMatchObject({ inputTokens: 54, outputTokens: 125, characters: 100, tokensMissing: false, costUnknown: false })
    expect(data.cost).toBeCloseTo((54 * 1.5 + 125 * 12) / 1e6)
    expect(voiceBillingUnit('qwen-audio-3.1-tts-flash-2026-01-01')).toBe('tokens')
  })
  it('Plus即使返回token也按计费字符估价，3.0缺token不会伪造token', () => {
    const plus = calculateVoiceUsage({ usage: { inputTokens: 54, outputTokens: 134 }, characters: 100, charactersReported: true }, voiceConfig('qwen-audio-3.1-tts-plus'))
    expect(plus.cost).toBeCloseTo(.01); expect(plus.costUnknown).toBe(false)
    const legacy = calculateVoiceUsage({ usage: {}, characters: 100, charactersReported: true }, voiceConfig('qwen-audio-3.0-tts-flash'))
    expect(legacy.inputTokens).toBeUndefined(); expect(legacy.outputTokens).toBeUndefined()
    expect(legacy.tokensMissing).toBe(true); expect(legacy.costUnknown).toBe(false); expect(legacy.cost).toBeCloseTo(.01)
  })
  it('缺字段不是已报告零，文本长度不是实际计费字符或token', () => {
    for (const invalid of [-1, NaN, Infinity, '54', null, undefined]) expect(usageNumber(invalid)).toBeUndefined()
    expect(usageNumber(0)).toBe(0)
    const partial = calculateVoiceUsage({ usage: { inputTokens: 54 }, characters: 54, charactersReported: false }, voiceConfig())
    expect(partial).toMatchObject({ inputTokens: 54, outputTokens: undefined, tokensMissing: true, costUnknown: true, characterCountEstimated: true })
    const chars = calculateVoiceUsage({ characters: 54, charactersReported: false }, voiceConfig('qwen-audio-3.0-tts-flash'))
    expect(chars.costUnknown).toBe(true); expect(chars.inputTokens).toBeUndefined()
  })
  it('未配置匹配单价时金额待核算，真实token保留原值', () => {
    const data = calculateVoiceUsage({ usage: { inputTokens: 54, outputTokens: 125 } }, { ...voiceConfig(), inputPrice: 0, outputPrice: 0, pricePer10kChars: 99 })
    expect(data.cost).toBe(0); expect(data.costUnknown).toBe(true)
    expect(data.inputTokens).toBe(54); expect(data.outputTokens).toBe(125)
  })
})

describe('对话与千问配音独立账本', () => {
  it('旧版真实对话零金额标历史待核算，不伪造次数；重置不抹掉今日未知，次日清除', async () => {
    let now = new Date(2026, 9, 26, 12).getTime()
    const rt = runtime({ now: () => now, store: { load: () => ({ costs: { session: 0, today: 0, inputTokens: 17000, outputTokens: 100, requests: 9, voiceCharacters: 0, day: '2026-10-26' } }), save() {} } })
    expect(rt.getState().costs).toMatchObject({ inputTokens: 17000, outputTokens: 100, requests: 9, unpricedRequests: 0, todayUnpricedRequests: 0, legacyUsageIncomplete: true, legacyTodayCostUnknown: true })
    await rt.command({ type: 'reset-session' })
    expect(rt.getState().costs).toMatchObject({ requests: 0, inputTokens: 0, unpricedRequests: 0, legacyUsageIncomplete: false, legacyTodayCostUnknown: true })
    now += 24 * 60 * 60 * 1000
    await rt.command({ type: 'start' })
    await rt.command({ type: 'inject', event: { id: 'new-day', kind: 'chat', user: { id: 'one', name: '客人' }, text: '你好', at: now } }); await rt.flush()
    expect(rt.getState().costs.legacyTodayCostUnknown).toBe(false)
  })
  it('同一互动分别记录DeepSeek和千问原始用量、缓存和请求次数', async () => {
    const fetch = vi.fn(async () => response({ prompt_tokens: 100, completion_tokens: 20, prompt_cache_hit_tokens: 80 }))
    const synthesize = vi.fn(async () => ({ audio, characters: 100, charactersReported: true, usage: { inputTokens: 54, outputTokens: 125 } }))
    const rt = runtime({ fetch: fetch as typeof globalThis.fetch, voice: { synthesize } })
    await rt.command({ type: 'set-config', config: config() }); await rt.command({ type: 'start' })
    await rt.command({ type: 'inject', event: { id: 'both-usage', kind: 'chat', user: { id: 'one', name: '小客人' }, text: '你好', at: Date.now() } }); await rt.flush()
    expect(fetch).toHaveBeenCalledOnce(); expect(synthesize).toHaveBeenCalledOnce()
    const costs = rt.getState().costs
    expect(costs).toMatchObject({ requests: 1, inputTokens: 100, outputTokens: 20, cacheHitTokens: 80, cacheMissTokens: 20, voiceRequests: 1, voiceInputTokens: 54, voiceOutputTokens: 125, voiceCharacters: 100, voiceUsageMissing: 0, brainUsageMissing: 0, unpricedRequests: 0 })
    expect(costs.session).toBeCloseTo((20 * 2 + 80 * .2 + 20 * 8 + 54 * 1.5 + 125 * 12) / 1e6)
  })
  it('3.0返回100计费字符但不返回token时保留缺失标记，不能记成100 tokens', async () => {
    const rt = runtime({ voice: { synthesize: vi.fn(async () => ({ audio, characters: 100, charactersReported: true, usage: {} })) } })
    await rt.command({ type: 'set-config', config: config('qwen-audio-3.0-tts-flash') }); await rt.command({ type: 'start' })
    await rt.command({ type: 'say', text: '短短的一句试听。' }); await rt.flush()
    expect(rt.getState().costs).toMatchObject({ requests: 0, voiceRequests: 1, voiceCharacters: 100, voiceCharactersEstimated: 0, voiceInputTokens: 0, voiceOutputTokens: 0, voiceUsageMissing: 1, unpricedRequests: 0 })
    expect(rt.getState().costs.session).toBeCloseTo(.01)
  })
  it('未配置单价时记录未知费用，不能把金额零称为免费', async () => {
    const rt = runtime({ fetch: vi.fn(async () => response()) as typeof globalThis.fetch, voice: { synthesize: vi.fn(async () => ({ audio, usage: { inputTokens: 3, outputTokens: 10 } })) } })
    const cfg = config(); cfg.brain.inputPrice = 0; cfg.brain.outputPrice = 0; cfg.voice.inputPrice = 0; cfg.voice.outputPrice = 0
    await rt.command({ type: 'set-config', config: cfg }); await rt.command({ type: 'start' })
    await rt.command({ type: 'inject', event: { id: 'unknown-cost', kind: 'chat', user: { id: 'one', name: '小客人' }, text: '你好', at: Date.now() } }); await rt.flush()
    expect(rt.getState().costs).toMatchObject({ session: 0, requests: 1, brainUsageMissing: 1, voiceRequests: 1, voiceInputTokens: 3, voiceOutputTokens: 10, unpricedRequests: 2, todayUnpricedRequests: 2 })
    expect(rt.getState().logs.some(row => row.category === '成本' && row.message.includes('不能当作实际免费'))).toBe(true)
  })
  it('暂停时中断的部分千问token只记录一次，不恢复播放', async () => {
    let reject!: (error: Error) => void, announce!: () => void
    const began = new Promise<void>(resolve => { announce = resolve })
    const rt = runtime({ voice: { synthesize: vi.fn(() => new Promise((_resolve, fail) => { reject = fail; announce() })) } })
    await rt.command({ type: 'set-config', config: config() }); await rt.command({ type: 'start' })
    await rt.command({ type: 'say', text: '正在生成的配音。' }); await began
    await rt.command({ type: 'pause' })
    reject(Object.assign(new Error('流已中断'), { chargedCharacters: 100, usage: { inputTokens: 3, outputTokens: 7 }, usageUncertain: false }))
    await rt.flush()
    expect(rt.getState().costs).toMatchObject({ voiceRequests: 1, voiceInputTokens: 3, voiceOutputTokens: 7, voiceCharacters: 100, voiceUsageMissing: 1, unpricedRequests: 1 })
    expect(rt.getState().stage.speaking).toBe(false)
  })
  it('暂停后完整结果才返回，成功结算后抛出的取消错误不会再计一次', async () => {
    let resolve!: (value: { audio: typeof audio; usage: { inputTokens: number; outputTokens: number } }) => void, announce!: () => void
    const began = new Promise<void>(done => { announce = done })
    const rt = runtime({ voice: { synthesize: vi.fn(() => new Promise(done => { resolve = done; announce() })) } })
    await rt.command({ type: 'set-config', config: config() }); await rt.command({ type: 'start' })
    await rt.command({ type: 'say', text: '迟到的完整音频。' }); await began
    await rt.command({ type: 'pause' }); resolve({ audio, usage: { inputTokens: 3, outputTokens: 7 } }); await rt.flush()
    expect(rt.getState().costs).toMatchObject({ voiceRequests: 1, voiceInputTokens: 3, voiceOutputTokens: 7, voiceUsageMissing: 0, unpricedRequests: 0 })
    expect(rt.getState().costs.session).toBeCloseTo((3 * 1.5 + 7 * 12) / 1e6)
    expect(rt.getState().stage.speaking).toBe(false)
  })
  it('重置后迟到语音只更新今日费用，新场次token与请求数保持清空', async () => {
    let resolve!: (value: { audio: typeof audio; usage: { inputTokens: number; outputTokens: number } }) => void, announce!: () => void
    const began = new Promise<void>(done => { announce = done })
    const rt = runtime({ voice: { synthesize: vi.fn(() => new Promise(done => { resolve = done; announce() })) } })
    await rt.command({ type: 'set-config', config: config() }); await rt.command({ type: 'start' })
    await rt.command({ type: 'say', text: '旧场次的配音。' }); await began
    await rt.command({ type: 'reset-session' }); resolve({ audio, usage: { inputTokens: 3, outputTokens: 7 } }); await rt.flush()
    expect(rt.getState().costs).toMatchObject({ session: 0, voiceRequests: 0, voiceInputTokens: 0, voiceOutputTokens: 0, voiceCharacters: 0, voiceUsageMissing: 0 })
    expect(rt.getState().costs.today).toBeCloseTo((3 * 1.5 + 7 * 12) / 1e6)
  })
  it('连接测试也透传token并记一次尝试，失败前无用量不会编造字符', async () => {
    const test = vi.fn(async () => ({ characters: 100, charactersReported: true, usage: { inputTokens: 54, outputTokens: 125 } }))
    const rt = runtime({ voice: { synthesize: vi.fn(), test } })
    await rt.command({ type: 'set-config', config: config() })
    expect((await rt.command({ type: 'test-connection', provider: 'qwen' })).ok).toBe(true)
    expect(rt.getState().costs).toMatchObject({ requests: 0, voiceRequests: 1, voiceInputTokens: 54, voiceOutputTokens: 125 })
    test.mockRejectedValueOnce(new Error('网络连接失败'))
    expect((await rt.command({ type: 'test-connection', provider: 'qwen' })).ok).toBe(false)
    expect(rt.getState().costs).toMatchObject({ voiceRequests: 2, voiceInputTokens: 54, voiceOutputTokens: 125, voiceCharacters: 100, voiceUsageMissing: 1, unpricedRequests: 1 })
  })
})
