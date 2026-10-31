import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRuntime } from '../packages/core/src/runtime'
import { defaultConfig } from '../packages/core/src/defaults'
import { canRetryQwenVoice, synthesizeQwen } from '../packages/core/src/voice'
import type { AppConfig } from '../packages/shared/src'

const runtimes: ReturnType<typeof createRuntime>[] = []
afterEach(() => runtimes.splice(0).forEach(runtime => runtime.dispose()))
const success = () => Response.json({ output: { audio: { data: 'AQACAA==' } }, usage: { input_tokens: 3, output_tokens: 7, characters: 4 } })
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
async function setup(fetch: typeof globalThis.fetch) {
  const runtime = createRuntime({ credentials: { get: () => 'offline-key', set() {}, encrypted: true }, voice: { async synthesize(text, config, key, signal, onRequest) {
    const result = await synthesizeQwen({ text, config, apiKey: key, signal, onRequest, fetch })
    return { ...result, audio: { kind: result.kind, data: result.data, url: result.url, sampleRate: result.sampleRate } }
  } } }); runtimes.push(runtime)
  const config = structuredClone(defaultConfig); config.demo = false; config.wallet.enabled = false; config.idle.aiChatter = false; config.music.bgmEnabled = false
  config.voice = { ...config.voice, provider: 'qwen', workspaceId: 'offline-workspace', model: 'qwen-audio-3.1-tts-flash', inputPrice: 1.5, outputPrice: 12 }
  await runtime.command({ type: 'set-config', config }); await runtime.command({ type: 'start' })
  return runtime
}
describe('千问瞬时故障只重试一次，每次实际请求独立核算', () => {
  it('HTTP500后成功：失败保留未知费用，第二次独立记API与真实token', async () => {
    const fetch = vi.fn(async () => success()).mockResolvedValueOnce(new Response('', { status: 500 }))
    const rt = await setup(fetch as typeof globalThis.fetch); await rt.command({ type: 'say', text: '配音恢复测试。' }); await rt.flush()
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(rt.getState().costs).toMatchObject({ voiceRequests: 2, voiceApiRequests: 2, voiceApiFailed: 1, voiceApiSucceeded: 1, voiceApiCancelled: 0, voiceInputTokens: 3, voiceOutputTokens: 7, voiceUsageMissing: 1, unpricedRequests: 1, todayUnpricedRequests: 1 })
    expect(rt.getState().rations).toMatchObject({ spent: 10, unknownRequests: 1 }); expect(rt.getState().stage.audio?.kind).toBe('pcm')
    expect(rt.getState().logs.some(log => log.message.includes('最多重试1次'))).toBe(true)
  })
  it('连续HTTP503最多两次，随后明确文字展示，不形成重试风暴', async () => {
    const fetch = vi.fn(async () => Response.json({ code: 'ServiceUnavailable', message: 'do-not-export-upstream-secret' }, { status: 503 }))
    const rt = await setup(fetch as typeof globalThis.fetch); await rt.command({ type: 'say', text: '连续失败测试。' }); await rt.flush()
    expect(fetch).toHaveBeenCalledTimes(2); expect(rt.getState().stage.audio).toBeUndefined(); expect(rt.getState().connection.voice).toBe('配音失败 · 文字展示')
    expect(rt.getState().costs).toMatchObject({ voiceApiRequests: 2, voiceApiFailed: 2, voiceUsageMissing: 2, unpricedRequests: 2 })
    expect(JSON.stringify(rt.getState().logs)).not.toContain('do-not-export-upstream-secret')
  })
  it('首次网络无响应可重试一次', async () => {
    const fetch = vi.fn(async () => success()).mockRejectedValueOnce(new TypeError('fetch failed'))
    const rt = await setup(fetch as typeof globalThis.fetch); await rt.command({ type: 'say', text: '网络恢复测试。' }); await rt.flush()
    expect(fetch).toHaveBeenCalledTimes(2); expect(rt.getState().costs).toMatchObject({ voiceApiRequests: 2, voiceApiFailed: 1, voiceApiSucceeded: 1 })
  })
  it.each([400, 401, 403, 404, 429])('HTTP%s不重试，业务或权限错误保持可见', async status => {
    const fetch = vi.fn(async () => Response.json({ code: 'InvalidParameter', message: 'upstream-secret' }, { status }))
    const rt = await setup(fetch as typeof globalThis.fetch); await rt.command({ type: 'say', text: '不可重试测试。' }); await rt.flush()
    expect(fetch).toHaveBeenCalledOnce(); expect(rt.getState().stage.audio).toBeUndefined()
  })
  it('HTTP500携带模型业务错误不重试，有用量的HTTP500也不重试且不漏扣', async () => {
    const business = vi.fn(async () => Response.json({ code: 'Model.NotFound' }, { status: 500 }))
    const first = await setup(business as typeof globalThis.fetch); await first.command({ type: 'say', text: '模型错误。' }); await first.flush(); expect(business).toHaveBeenCalledOnce()
    const partial = vi.fn(async () => Response.json({ code: 'InternalError', usage: { input_tokens: 2, output_tokens: 5 } }, { status: 500 }))
    const second = await setup(partial as typeof globalThis.fetch); await second.command({ type: 'say', text: '已有用量。' }); await second.flush()
    expect(partial).toHaveBeenCalledOnce(); expect(second.getState().rations).toMatchObject({ spent: 7, unknownRequests: 0 }); expect(second.getState().costs).toMatchObject({ voiceInputTokens: 2, voiceOutputTokens: 5, voiceApiFailed: 1 })
  })
  it('已收到音频或usage的SSE网络中断不重试', async () => {
    let reads = 0
    const fetch = vi.fn(async () => new Response(new ReadableStream({ pull(controller) { if (reads++ === 0) controller.enqueue(new TextEncoder().encode('data: {"output":{"audio":{"data":"AQACAA=="}},"usage":{"input_tokens":2,"output_tokens":4}}\n\n')); else controller.error(new TypeError('network interrupted')) } }), { headers: { 'content-type': 'text/event-stream' } }))
    const rt = await setup(fetch as typeof globalThis.fetch); await rt.command({ type: 'say', text: '已经接收部分。' }); await rt.flush()
    expect(fetch).toHaveBeenCalledOnce(); expect(rt.getState().rations.spent).toBe(6); expect(rt.getState().stage.audio).toBeUndefined()
  })
  it.each(['pause', 'mute', 'interrupt', 'reset-session'] as const)('%s发生于350ms等待时，不能发第二次请求或迟到播放', async type => {
    const fetch = vi.fn(async () => new Response('', { status: 500 })), rt = await setup(fetch as typeof globalThis.fetch), waiting = deferred<void>()
    const unsubscribe = rt.subscribe(state => { if (state.connection.voice === '临时故障 · 等待重试') waiting.resolve() })
    await rt.command({ type: 'say', text: '等待重试。' }); await waiting.promise; await rt.command({ type }); await rt.flush(); unsubscribe()
    expect(fetch).toHaveBeenCalledOnce(); expect(rt.getState().stage.speaking).toBe(false); expect(rt.getState().stage.audio).toBeUndefined()
  })
  it('第二次请求已发出后重置，迟到成功只记今日和口粮一次，不播放也不污染新场', async () => {
    const pending = deferred<Response>(), began = deferred<void>(), fetch = vi.fn(async () => { began.resolve(); return pending.promise }).mockResolvedValueOnce(new Response('', { status: 500 }))
    const rt = await setup(fetch as typeof globalThis.fetch); await rt.command({ type: 'say', text: '旧场重试。' }); await began.promise; await rt.command({ type: 'reset-session' })
    pending.resolve(success()); await rt.flush()
    expect(fetch).toHaveBeenCalledTimes(2); expect(rt.getState().stage.speaking).toBe(false); expect(rt.getState().costs).toMatchObject({ voiceApiRequests: 0, voiceInputTokens: 0, voiceOutputTokens: 0 })
    expect(rt.getState().rations).toMatchObject({ spent: 10, unknownRequests: 1 })
  })
  it('未显式标注、abort、联网前拒绝与已有partial不能误判为可重试', () => {
    for (const error of [new Error('HTTP500'), Object.assign(new Error('拒绝'), { retryableVoice: true, requestNotStarted: true }), Object.assign(new DOMException('取消', 'AbortError'), { retryableVoice: true }), { retryableVoice: true, usage: { inputTokens: 1 } }, { retryableVoice: true, receivedAudio: true }]) expect(canRetryQwenVoice(error)).toBe(false)
  })
})
