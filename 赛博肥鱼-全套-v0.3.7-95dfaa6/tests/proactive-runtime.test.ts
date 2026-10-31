import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRuntime } from '../packages/core/src/runtime'
import { defaultConfig } from '../packages/core/src/defaults'
import type { AppConfig } from '../packages/shared/src'

const runtimes: ReturnType<typeof createRuntime>[] = []
afterEach(() => { runtimes.splice(0).forEach(runtime => runtime.dispose()); vi.useRealTimers() })
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
const response = (say = '小发现可以慢慢展开，先把这一页留好。') => Response.json({ choices: [{ message: { content: JSON.stringify({ say: [say], action: 'listen', face: 'happy' }) } }], usage: { prompt_tokens: 7, completion_tokens: 8 } })
async function setup(options: { idle?: Partial<AppConfig['idle']>; fetch?: typeof fetch; synthesize?: NonNullable<Parameters<typeof createRuntime>[0]>['voice'] } = {}) {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-26T06:00:00Z'))
  const fetch = options.fetch ?? vi.fn(async () => response())
  const spoken: string[] = [], signals: AbortSignal[] = []
  const voice = options.synthesize ?? { async synthesize(text: string, _config: unknown, _key: string, signal: AbortSignal, onRequest?: () => void) { spoken.push(text); signals.push(signal); onRequest?.(); return { audio: { kind: 'pcm' as const, data: 'AQACAA==', sampleRate: 24000 }, usage: { inputTokens: 2, outputTokens: 3 } } } }
  const runtime = createRuntime({ fetch, credentials: { get: () => 'offline-test-key', set() {}, encrypted: true }, voice }); runtimes.push(runtime)
  const config = structuredClone(defaultConfig); config.demo = false; config.wallet.enabled = false; config.music.bgmEnabled = false; config.vote.enabled = false
  config.voice.provider = 'qwen'; config.idle = { ...config.idle, seconds: 10, entertainment: false, ...options.idle }
  await runtime.command({ type: 'set-config', config }); await runtime.command({ type: 'start' })
  return { runtime, fetch, spoken, signals }
}
async function chat(runtime: ReturnType<typeof createRuntime>, id: string, text: string) {
  await runtime.command({ type: 'inject', event: { id, origin: 'simulator', kind: 'chat', user: { id: 'guest', name: '小周' }, text, at: Date.now() } })
}
async function finish(runtime: ReturnType<typeof createRuntime>) {
  const stage = runtime.getState().stage
  if (stage.replyId && stage.speaking) await runtime.command({ type: 'stage-event', event: { type: 'speech-ended', replyId: stage.replyId } })
  await runtime.command({ type: 'stage-event', event: { type: 'action-ended', commandId: runtime.getState().stage.commandId } }); await runtime.flush()
}

describe('运行时主动发声节流、公开话题与观众让位', () => {
  it('预设与暖场共用主动额度；额度耗尽后的动作和文字不产生千问调用', async () => {
    const { runtime, fetch, spoken } = await setup({ idle: { aiChatter: false, hourlySpeechLimit: 2 } })
    await vi.advanceTimersByTimeAsync(119000); expect(spoken).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(801000); await runtime.flush()
    expect(spoken).toHaveLength(2); expect(fetch).not.toHaveBeenCalled()
    expect(runtime.getState().costs.voiceApiRequests).toBe(2)
    expect(runtime.getState().logs.some(row => row.category === '日常')).toBe(true)
    expect(runtime.getState().roomMood).toMatchObject({ kind: 'lonely', activeChatters: 0, activeParticipants: 0 })
    expect(spoken.join('')).not.toMatch(/热水|来杯|靠窗|窗边/)
  })

  it('主动额度0仍正常回复观众，收到观众后的心情来自近期事件', async () => {
    const { runtime, fetch, spoken } = await setup({ idle: { hourlySpeechLimit: 0 } })
    await vi.advanceTimersByTimeAsync(365000); expect(spoken).toHaveLength(0); expect(fetch).not.toHaveBeenCalled()
    expect(runtime.getState().roomMood.kind).toBe('lonely')
    await chat(runtime, 'direct', '我今天骑车看到一朵很特别的小花。'); await runtime.flush()
    expect(fetch).toHaveBeenCalledOnce(); expect(spoken).toHaveLength(1)
    expect(runtime.getState().roomMood).toMatchObject({ kind: 'reunited', activeChatters: 1, activeParticipants: 1 })
  })

  it('主动AI带上最近普通话题，点歌短命令不会覆盖它', async () => {
    const requests: any[] = [], fetch = vi.fn(async (_url: unknown, init?: RequestInit) => { requests.push(JSON.parse(String(init?.body))); return response() })
    const { runtime } = await setup({ fetch: fetch as typeof globalThis.fetch })
    await chat(runtime, 'topic', '我今天做了一小块木书架，想给骑车杂志找个家。'); await runtime.flush(); await finish(runtime)
    await chat(runtime, 'detail', '浅蓝'); await runtime.flush(); await finish(runtime)
    await chat(runtime, 'song', '取消点歌'); await runtime.flush(); await finish(runtime)
    await vi.advanceTimersByTimeAsync(140000); await runtime.flush()
    const asks = requests.map(request => { try { return JSON.parse(request.messages.at(-1).content) } catch { return undefined } })
    const proactive = asks.find(ask => ask?.最近未结束的公开话题)
    expect(proactive).toBeDefined(); expect(proactive.最近未结束的公开话题).toHaveLength(2)
    expect(proactive.最近未结束的公开话题[0].heard).toContain('木书架')
    expect(proactive.最近未结束的公开话题[1].heard).toBe('浅蓝')
    expect(JSON.stringify(proactive.最近未结束的公开话题)).not.toContain('取消点歌')
    expect(proactive.此刻.心情.说明).toContain('不是真实在线人数')
  })

  it('新观众取消在途主动AI；不听取消的旧响应迟到也不能配音或覆盖新回复', async () => {
    const old = deferred<Response>(), signals: AbortSignal[] = []
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      signals.push(init!.signal as AbortSignal)
      return signals.length === 1 ? old.promise : response('新问题收到了，我先认真听你讲木书架。')
    })
    const { runtime, spoken } = await setup({ fetch: fetch as typeof globalThis.fetch })
    await vi.advanceTimersByTimeAsync(120000); expect(fetch).toHaveBeenCalledOnce()
    await chat(runtime, 'arrives', '木书架的第一层应该放什么呢？')
    expect(signals[0]!.aborted).toBe(true)
    old.resolve(response('旧闲聊不应进入配音。')); await runtime.flush()
    expect(fetch).toHaveBeenCalledTimes(2); expect(spoken).toHaveLength(1)
    expect(spoken[0]).toContain('木书架'); expect(spoken.join('')).not.toContain('旧闲聊')
    expect(runtime.getState().history.some(reply => reply.say.join('').includes('旧闲聊'))).toBe(false)
  })

  it.each(['pause', 'mute'] as const)('%s取消主动AI，迟到响应与后续空档都不恢复配音', async type => {
    const old = deferred<Response>(), signals: AbortSignal[] = []
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => { signals.push(init!.signal as AbortSignal); return old.promise })
    const { runtime, spoken } = await setup({ fetch: fetch as typeof globalThis.fetch })
    await vi.advanceTimersByTimeAsync(120000); expect(fetch).toHaveBeenCalledOnce()
    await runtime.command({ type }); expect(signals[0]!.aborted).toBe(true)
    old.resolve(response('已停止的闲聊。')); await runtime.flush(); await vi.advanceTimersByTimeAsync(360000)
    expect(fetch).toHaveBeenCalledOnce(); expect(spoken).toHaveLength(0)
    expect(runtime.getState().stage.speaking).toBe(false); expect(runtime.getState().stage.audio).toBeUndefined()
  })

  it('新互动取消主动预设的千问配音；迟到音频不留在舞台，正常回复仍能继续', async () => {
    const old = deferred<{ audio: { kind: 'pcm'; data: string; sampleRate: number }; usage: { inputTokens: number; outputTokens: number } }>(), signals: AbortSignal[] = [], words: string[] = []
    const voice = { async synthesize(text: string, _config: unknown, _key: string, signal: AbortSignal, onRequest?: () => void) { words.push(text); signals.push(signal); onRequest?.(); return words.length === 1 ? old.promise : { audio: { kind: 'pcm' as const, data: 'BQAGAA==', sampleRate: 24000 }, usage: { inputTokens: 2, outputTokens: 3 } } } }
    const { runtime } = await setup({ idle: { aiChatter: false }, synthesize: voice })
    await vi.advanceTimersByTimeAsync(140000); expect(words).toHaveLength(1)
    await chat(runtime, 'cancel-voice', '我刚画好书架的草图，想给你看看。')
    expect(signals[0]!.aborted).toBe(true)
    old.resolve({ audio: { kind: 'pcm', data: 'LATEAUDIO', sampleRate: 24000 }, usage: { inputTokens: 2, outputTokens: 3 } }); await runtime.flush()
    expect(words).toHaveLength(2); expect(runtime.getState().stage.audio?.data).toBe('BQAGAA==')
    expect(JSON.stringify(runtime.getState().stage)).not.toContain('LATEAUDIO')
    expect(runtime.getState().history.every(reply => reply.eventId === 'cancel-voice')).toBe(true)
    // The provider returned success despite cancellation: charge its actual usage,
    // while the cancelled performance itself never reaches the stage.
    expect(runtime.getState().costs).toMatchObject({ voiceApiRequests: 2, voiceInputTokens: 4, voiceOutputTokens: 6 })
  })
})

describe('冷场小剧场持续播、有实际观众随时接住', () => {
  async function nextSpeech(runtime: ReturnType<typeof createRuntime>, maxSeconds = 190) {
    for (let second = 0; second < maxSeconds; second++) {
      await vi.advanceTimersByTimeAsync(1000)
      if (runtime.getState().stage.speaking) return runtime.getState().stage
    }
    throw new Error('规定空档内没有产生下一段台词')
  }
  it('一小时无观众仍持续演，免费动作穿插，AI调用少于发声且上限不超支', async () => {
    const { runtime, fetch, spoken } = await setup({ idle: { entertainment: true } })
    const start = Date.now(), started: number[] = [], titles = new Set<string>()
    while (Date.now() - start < 3500000) {
      const stage = await nextSpeech(runtime)
      started.push(Date.now()); expect(stage.text).not.toMatch(/慢慢等|安静也有|尾巴先晃一会儿/)
      runtime.getState().logs.filter(row => row.category === '自娱自乐').forEach(row => titles.add(row.message))
      await finish(runtime)
    }
    expect(spoken.length).toBeGreaterThanOrEqual(21); expect(spoken.length).toBeLessThanOrEqual(24)
    expect(fetch.mock.calls.length).toBeGreaterThan(4); expect(fetch.mock.calls.length).toBeLessThan(spoken.length - 5)
    expect(titles.size).toBeGreaterThan(12)
    expect(started.slice(1).every((at, i) => at - started[i]! >= 150000 && at - started[i]! <= 190000)).toBe(true)
    expect(runtime.getState().costs.voiceApiRequests).toBe(spoken.length)
    expect(runtime.getState().costs.brainApiRequests).toBe(fetch.mock.calls.length)
  }, 20000)

  it('普通进场不会掐断在途AI或已在说的小剧场，真正弹幕立即取消并优先回应', async () => {
    const old = deferred<Response>(), signals: AbortSignal[] = []
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => { signals.push(init!.signal as AbortSignal); return signals.length === 1 ? old.promise : response('你的新话题我接住啦，先聊你的小书架。') })
    const { runtime, spoken } = await setup({ idle: { entertainment: true }, fetch: fetch as typeof globalThis.fetch })
    await vi.advanceTimersByTimeAsync(150000); expect(fetch).toHaveBeenCalledOnce()
    await runtime.command({ type: 'inject', event: { id: 'silent-arrival', kind: 'enter', origin: 'simulator', user: { id: 'silent', name: '路过客人' }, at: Date.now() } })
    expect(signals[0]!.aborted).toBe(false)
    old.resolve(response('店猫财务面试开始，它递来一张空白简历。')); await runtime.flush()
    // Finish any queued welcome before locating the sketch.
    if (!runtime.getState().stage.text.includes('店猫财务面试')) { await finish(runtime); await vi.advanceTimersByTimeAsync(5000); await runtime.flush() }
    expect(spoken.some(text => text.includes('店猫财务面试'))).toBe(true)
    const sketch = runtime.getState().stage.replyId
    await runtime.command({ type: 'inject', event: { id: 'another-silent-arrival', kind: 'enter', origin: 'simulator', user: { id: 'silent2', name: '又一位路过客人' }, at: Date.now() } })
    expect(runtime.getState().stage.replyId).toBe(sketch)
    await chat(runtime, 'speaks', '我今天想聊我的小书架。'); await runtime.flush()
    expect(runtime.getState().stage.text).toContain('小书架')
    expect(runtime.getState().history[0]?.eventId).toBe('speaks')
  })

  it('本地剧情不请求DeepSeek，仍配音、动作和表情一致，完成后才进入下一段', async () => {
    const { runtime, fetch, spoken } = await setup({ idle: { entertainment: true, aiChatter: false } })
    const first = await nextSpeech(runtime); expect(first.text).toContain('面试店猫')
    expect(first.face).toBe('smug'); expect(first.action).toBe('pet_cat')
    await finish(runtime)
    const second = await nextSpeech(runtime); expect(second.text).toContain('商业机密'); expect(second.face).toBe('thinking')
    await finish(runtime)
    const third = await nextSpeech(runtime); expect(third.text).toContain('各有所长'); await finish(runtime)
    const fourth = await nextSpeech(runtime); expect(fourth.text).toContain('猫当老板'); await finish(runtime)
    expect(fetch).not.toHaveBeenCalled(); expect(spoken).toHaveLength(4)
  })

  it('暂停或静音取消小剧场，迟到AI不生成补救配音', async () => {
    const old = deferred<Response>()
    const fetch = vi.fn(async () => old.promise)
    const { runtime, spoken } = await setup({ idle: { entertainment: true }, fetch: fetch as typeof globalThis.fetch })
    await vi.advanceTimersByTimeAsync(150000); expect(fetch).toHaveBeenCalledOnce()
    await runtime.command({ type: 'pause' }); old.resolve(response('迟到的小剧场')); await runtime.flush()
    await vi.advanceTimersByTimeAsync(600000)
    expect(spoken).toHaveLength(0); expect(runtime.getState().history).toHaveLength(0)
  })

  it('AI服务失败时同一额度用本地剧情接住，不循环重试或追加对话请求', async () => {
    const fetch = vi.fn(async () => { throw new Error('离线模拟服务不可用') })
    const { runtime, spoken } = await setup({ idle: { entertainment: true }, fetch: fetch as typeof globalThis.fetch })
    const stage = await nextSpeech(runtime)
    expect(stage.text).toContain('面试店猫'); expect(spoken).toHaveLength(1); expect(fetch).toHaveBeenCalledOnce()
    expect(runtime.getState().costs.brainApiFailed).toBe(1)
  })
})

describe('冷场节目异常与进场压力', () => {
  it('对话超时用本地剧情收场，同一额度不重试模型；暂停仍阻止任何迟到补救', async () => {
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => { init!.signal!.addEventListener('abort', () => reject(new DOMException('离线模拟超时', 'AbortError')), { once: true }) }))
    const { runtime, spoken } = await setup({ idle: { entertainment: true }, fetch: fetch as typeof globalThis.fetch })
    await vi.advanceTimersByTimeAsync(175000); await runtime.flush()
    expect(fetch).toHaveBeenCalledOnce(); expect(spoken).toHaveLength(1); expect(spoken[0]).toContain('面试店猫')
    expect(runtime.getState().costs).toMatchObject({ brainApiRequests: 1, brainApiCancelled: 1 })
  })
  it('十分钟持续只有进场、没有人接话，也不会永远只欢迎不演节目', async () => {
    const { runtime, fetch } = await setup({ idle: { entertainment: true, aiChatter: false } })
    const seen = new Set<string>(), sketches: string[] = []
    for (let second = 0; second < 600; second++) {
      await vi.advanceTimersByTimeAsync(1000)
      if (second % 20 === 0) await runtime.command({ type: 'inject', event: { id: `silent-${second}`, kind: 'enter', origin: 'simulator', user: { id: `silent-${second}`, name: `路过${second}` }, at: Date.now() } })
      const stage = runtime.getState().stage
      if (stage.speaking && stage.replyId && !seen.has(stage.replyId)) {
        seen.add(stage.replyId)
        const reply = runtime.getState().history.find(reply => reply.id === stage.replyId)
        if (!reply?.eventId) sketches.push(stage.text)
        await finish(runtime)
      }
    }
    expect(sketches.length).toBeGreaterThanOrEqual(3)
    expect(sketches.join('')).toContain('面试店猫'); expect(sketches.join('')).toContain('商业机密')
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('欢迎让位后队列不会互相等待', () => {
  it('已有待审核回复和欢迎时，仍能准备并播放新的普通聊天', async () => {
    const { runtime } = await setup({ idle: { enabled: false } })
    const config = runtime.getState().config; config.safety.reviewSensitive = true
    await runtime.command({ type: 'set-config', config })
    await runtime.command({ type: 'say', text: '我先说完这一句。' }); await runtime.flush()
    await chat(runtime, 'review', '聊聊投资建议可以吗？'); await runtime.flush()
    expect(runtime.getState().drafts.some(reply => reply.status === 'draft')).toBe(true)
    await runtime.command({ type: 'inject', event: { id: 'waiting-welcome', kind: 'enter', origin: 'simulator', user: { id: 'silent', name: '路过的人' }, at: Date.now() } }); await runtime.flush()
    expect(runtime.getState().drafts.length).toBe(2)
    await chat(runtime, 'ordinary', '小书架应该摆在哪边呢？'); await runtime.flush()
    await finish(runtime)
    expect(runtime.getState().history[0]?.eventId).toBe('ordinary')
    expect(runtime.getState().drafts.some(reply => reply.eventId === 'review' && reply.status === 'draft')).toBe(true)
  })
})

describe('公开话题不会永久占住冷场节目', () => {
  it('观众不再补充超过六分钟后转入小剧场，自言自语不把旧弹幕续成永久话题', async () => {
    const requests: any[] = []
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => { requests.push(JSON.parse(String(init?.body))); return response() })
    const { runtime } = await setup({ idle: { entertainment: true }, fetch: fetch as typeof globalThis.fetch })
    await chat(runtime, 'old-topic', '刚做了个浅蓝色的小书架。'); await runtime.flush(); await finish(runtime)
    await vi.advanceTimersByTimeAsync(550000); await runtime.flush()
    const asks = requests.flatMap(request => { try { return [JSON.parse(request.messages.at(-1).content)] } catch { return [] } })
    expect(asks.some(ask => ask.最近未结束的公开话题?.some((turn: any) => turn.heard.includes('小书架')))).toBe(true)
    const show = asks.find(ask => ask.本段小剧场)
    expect(show).toBeDefined(); expect(show.最近未结束的公开话题).toEqual([])
    expect(show.本段小剧场.段落).toBe(1)
    expect(requests.filter(request => { try { return !!JSON.parse(request.messages.at(-1).content).本段小剧场 } catch { return false } }).every(request => request.max_tokens === 250)).toBe(true)
  })
})
