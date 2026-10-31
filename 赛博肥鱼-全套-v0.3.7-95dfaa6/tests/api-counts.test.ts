import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRuntime } from '../packages/core/src/runtime'
import { defaultConfig } from '../packages/core/src/defaults'
import { synthesizeQwen } from '../packages/core/src/voice'
import type { AppConfig } from '../packages/shared/src/index'

const all: ReturnType<typeof createRuntime>[] = []
afterEach(() => { all.splice(0).forEach(runtime => runtime.dispose()) })
const keys = { get: () => 'offline-api-key', set() {}, encrypted: true }
const response = () => Response.json({ choices: [{ message: { content: JSON.stringify({ say: ['来小店坐坐。'] }) } }], usage: { prompt_tokens: 10, completion_tokens: 3 } })
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
function config(): AppConfig {
  const cfg = structuredClone(defaultConfig); cfg.demo = false; cfg.idle.aiChatter = false; cfg.wallet.enabled = false
  cfg.voice = { ...cfg.voice, provider: 'qwen', workspaceId: 'offline-workspace', model: 'qwen-audio-3.1-tts-flash', inputPrice: 1.5, outputPrice: 12 }
  return cfg
}
function runtime(options: Parameters<typeof createRuntime>[0] = {}) { const rt = createRuntime({ credentials: keys, ...options }); all.push(rt); return rt }
const event = (id: string) => ({ id, kind: 'chat' as const, user: { id: 'viewer', name: '客人' }, text: '你好', at: Date.now() })
function adapter(fetch: typeof globalThis.fetch) {
  return { async synthesize(text: string, config: AppConfig['voice'], key: string, signal: AbortSignal, onRequest?: () => void) {
    const result = await synthesizeQwen({ text, config, apiKey: key, signal, onRequest, fetch })
    return { audio: { kind: result.kind, data: result.data, sampleRate: result.sampleRate }, characters: result.characters, charactersReported: result.charactersReported, usage: result.usage }
  } }
}

describe('实际API请求计数与尝试次数分开', () => {
  it('对话与配音在各自fetch启动处计数，成功各一次', async () => {
    const dialogueFetch = vi.fn(async () => response())
    const voiceFetch = vi.fn(async () => Response.json({ output: { audio: { data: 'AAAA' } }, usage: { input_tokens: 8, output_tokens: 20, characters: 16 } }))
    const rt = runtime({ fetch: dialogueFetch as typeof globalThis.fetch, voice: adapter(voiceFetch as typeof globalThis.fetch) })
    await rt.command({ type: 'set-config', config: config() }); await rt.command({ type: 'start' }); await rt.command({ type: 'inject', event: event('both-api') }); await rt.flush()
    expect(dialogueFetch).toHaveBeenCalledOnce(); expect(voiceFetch).toHaveBeenCalledOnce()
    expect(rt.getState().costs).toMatchObject({ requests: 1, voiceRequests: 1, brainApiRequests: 1, brainApiSucceeded: 1, brainApiFailed: 0, brainApiCancelled: 0, voiceApiRequests: 1, voiceApiSucceeded: 1, voiceApiFailed: 0, voiceApiCancelled: 0 })
  })
  it('本地预算拒绝不得当成实际API、失败或待核算费用', async () => {
    const denied = vi.fn(async () => { throw Object.assign(new DOMException('本地额度已满', 'AbortError'), { requestNotStarted: true }) })
    const rt = runtime({ fetch: denied as typeof globalThis.fetch })
    const cfg = config(); cfg.voice.enabled = false
    await rt.command({ type: 'set-config', config: cfg }); await rt.command({ type: 'start' }); await rt.command({ type: 'inject', event: event('budget-denied') }); await rt.flush()
    expect(rt.getState().costs).toMatchObject({ requests: 1, brainApiRequests: 0, brainApiSucceeded: 0, brainApiFailed: 0, brainApiCancelled: 0, brainUsageMissing: 0, unpricedRequests: 0 })
  })
  it('本地语音参数校验失败保留尝试数，但不算实际API', async () => {
    const voiceFetch = vi.fn(), rt = runtime({ voice: adapter(voiceFetch as typeof globalThis.fetch) })
    const cfg = config(); cfg.voice.workspaceId = ''
    await rt.command({ type: 'set-config', config: cfg }); await rt.command({ type: 'start' }); await rt.command({ type: 'say', text: '参数错误测试。' }); await rt.flush()
    expect(voiceFetch).not.toHaveBeenCalled()
    expect(rt.getState().costs).toMatchObject({ voiceRequests: 1, voiceApiRequests: 0, voiceApiSucceeded: 0, voiceApiFailed: 0, voiceApiCancelled: 0, voiceUsageMissing: 0, unpricedRequests: 0 })
  })
  it('排队时已取消、还没fetch的语音不算实际API或用量缺失', async () => {
    const gate = deferred<void>(), started = deferred<void>(), voiceFetch = vi.fn()
    const rt = runtime({ voice: { async synthesize(text, cfg, key, signal, onRequest) {
      started.resolve(); await gate.promise
      return adapter(voiceFetch as typeof globalThis.fetch).synthesize(text, cfg, key, signal, onRequest)
    } } })
    await rt.command({ type: 'set-config', config: config() }); await rt.command({ type: 'start' }); await rt.command({ type: 'say', text: '还没有送出的配音。' }); await started.promise
    await rt.command({ type: 'pause' }); gate.resolve(); await rt.flush()
    expect(voiceFetch).not.toHaveBeenCalled()
    expect(rt.getState().costs).toMatchObject({ voiceRequests: 1, voiceApiRequests: 0, voiceApiSucceeded: 0, voiceApiFailed: 0, voiceApiCancelled: 0, voiceUsageMissing: 0, unpricedRequests: 0 })
  })
  it('实际已启动的取消计取消，真实HTTP500计失败，不能相互覆盖', async () => {
    const began = deferred<void>()
    const voiceFetch = vi.fn((_url, init?: RequestInit) => new Promise<Response>((_done, reject) => { began.resolve(); init?.signal?.addEventListener('abort', () => reject(new DOMException('已取消', 'AbortError'))) }))
    const rt = runtime({ voice: adapter(voiceFetch as typeof globalThis.fetch) })
    await rt.command({ type: 'set-config', config: config() }); await rt.command({ type: 'start' }); await rt.command({ type: 'say', text: '实际请求中。' }); await began.promise
    await rt.command({ type: 'pause' }); await rt.flush()
    expect(rt.getState().costs).toMatchObject({ voiceApiRequests: 1, voiceApiCancelled: 1, voiceApiFailed: 0, voiceUsageMissing: 1 })
    const failed = runtime({ voice: adapter(vi.fn(async () => new Response('', { status: 500 })) as typeof globalThis.fetch) })
    await failed.command({ type: 'set-config', config: config() }); await failed.command({ type: 'start' }); await failed.command({ type: 'say', text: '服务失败测试。' }); await failed.flush()
    expect(failed.getState().costs).toMatchObject({ voiceApiRequests: 2, voiceApiSucceeded: 0, voiceApiFailed: 2, voiceApiCancelled: 0, voiceUsageMissing: 2 })
  })
  it('对话HTTP错误及取消分别计数，即使用量未返回也不能漏掉实际请求', async () => {
    const failed = runtime({ fetch: vi.fn(async () => new Response('', { status: 500 })) as typeof globalThis.fetch })
    const cfg = config(); cfg.voice.enabled = false
    await failed.command({ type: 'set-config', config: cfg }); await failed.command({ type: 'start' }); await failed.command({ type: 'inject', event: event('brain-500') }); await failed.flush()
    expect(failed.getState().costs).toMatchObject({ brainApiRequests: 1, brainApiFailed: 1, brainApiCancelled: 0, brainUsageMissing: 1 })
    const began = deferred<void>()
    const aborted = runtime({ fetch: vi.fn((_url, init?: RequestInit) => new Promise<Response>((_done, reject) => { began.resolve(); init?.signal?.addEventListener('abort', () => reject(new DOMException('已取消', 'AbortError'))) })) as typeof globalThis.fetch })
    await aborted.command({ type: 'set-config', config: cfg }); await aborted.command({ type: 'start' }); await aborted.command({ type: 'inject', event: event('brain-cancel') }); await began.promise
    await aborted.command({ type: 'pause' }); await aborted.flush()
    expect(aborted.getState().costs).toMatchObject({ brainApiRequests: 1, brainApiFailed: 0, brainApiCancelled: 1, brainUsageMissing: 1 })
  })
  it('同一请求重复回调只计一次，重置后旧请求回执不污染新场次', async () => {
    const began = deferred<void>(), gate = deferred<void>()
    const rt = runtime({ voice: { async synthesize(_text, _cfg, _key, _signal, onRequest) {
      onRequest?.(); onRequest?.(); began.resolve(); await gate.promise
      return { audio: { kind: 'pcm', data: 'AAAA' }, usage: { inputTokens: 2, outputTokens: 3 } }
    } } })
    await rt.command({ type: 'set-config', config: config() }); await rt.command({ type: 'start' }); await rt.command({ type: 'say', text: '旧场次的请求。' }); await began.promise
    expect(rt.getState().costs.voiceApiRequests).toBe(1)
    await rt.command({ type: 'reset-session' }); gate.resolve(); await rt.flush()
    expect(rt.getState().costs).toMatchObject({ voiceApiRequests: 0, voiceApiSucceeded: 0, voiceApiFailed: 0, voiceApiCancelled: 0 })
  })
  it('旧尝试次数不能迁移成实际API数，明确标记历史不完整', async () => {
    const rt = runtime({ store: { load: () => ({ costs: { requests: 12, voiceRequests: 5, voiceCharacters: 100, unpricedRequests: 0 } }), save() {} } })
    expect(rt.getState().costs).toMatchObject({ requests: 12, voiceRequests: 5, brainApiRequests: 0, voiceApiRequests: 0, apiCountsIncomplete: true })
    await rt.command({ type: 'reset-session' }); expect(rt.getState().costs.apiCountsIncomplete).toBe(false)
  })
})
