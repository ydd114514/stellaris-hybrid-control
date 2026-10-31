import { describe, it, expect, vi } from 'vitest'
import { SseParser, synthesizeQwen, designQwenVoice } from '../packages/core/src/voice'
import type { AppConfig } from '../packages/shared/src/index'
const config: AppConfig['voice'] = { enabled: true, provider: 'qwen', baseUrl: '', model: 'qwen-audio-3.1-tts-flash', voice: 'longanhuan_v3.6', workspaceId: 'workspace-test', instruction: '温暖自然', rate: 1, outputDeviceId: 'default', pricePer10kChars: 1 }
function responseFromChunks(chunks: string[]) {
  return new Response(new ReadableStream({ start(controller) { for (const text of chunks) controller.enqueue(new TextEncoder().encode(text)); controller.close() } }), { headers: { 'content-type': 'text/event-stream' } })
}
describe('千问流式配音适配器', () => {
  it('SSE支持跨网络分块、CRLF、多行和末尾无空行', () => {
    const values: string[] = []
    const parser = new SseParser(data => values.push(data))
    parser.push(': keepalive\r\nda')
    parser.push('ta: {"ok":1}\r\n\r')
    parser.push('\ndata: first\ndata: second\n\ndata: tail')
    parser.finish()
    expect(values).toEqual(['{"ok":1}', 'first\nsecond', 'tail'])
  })
  it('依次拼接PCM且返回时间戳和用量', async () => {
    const onChunk = vi.fn()
    const mockFetch = vi.fn(async (_url, init) => {
      const request = JSON.parse(String(init?.body))
      expect(request.input.format).toBe('pcm')
      expect(request.input.word_timestamp_enabled).toBe(true)
      return responseFromChunks([
        'data: {"output":{"audio":{"data":"AQACAA=="}}}\n',
        '\ndata: {"output":{"audio":{"data":"AwAEAA=="},"sentence":{"words":[{"text":"你","begin_time":0,"end_time":100}]}},"usage":{"characters":2,"input_tokens":3,"output_tokens":10}}\n\n',
        'data: {"output":{"finish_reason":"stop"}}\n\ndata: [DONE]\n\n',
      ])
    }) as typeof fetch
    const result = await synthesizeQwen({ text: '你好', config, apiKey: 'test-key', fetch: mockFetch, onChunk })
    expect(mockFetch.mock.calls[0]?.[0]).toBe('https://workspace-test.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer')
    expect(Buffer.from(result.data!, 'base64')).toEqual(Buffer.from([1,0,2,0,3,0,4,0]))
    expect(result.words).toEqual([{ text: '你', start: 0, end: 0.1 }])
    expect(result.usage).toEqual({ inputTokens: 3, outputTokens: 10 })
    expect(result.charactersReported).toBe(true)
    expect(onChunk).toHaveBeenCalledTimes(2)
  })
  it('兼容服务返回整段音频URL', async () => {
    const mockFetch = vi.fn(async () => Response.json({ output: { audio: { url: 'https://example.com/audio.wav' } }, usage: { characters: 2 } })) as typeof fetch
    expect(await synthesizeQwen({ text: '你好', config, apiKey: 'test-key', fetch: mockFetch })).toMatchObject({ kind: 'url', url: 'https://example.com/audio.wav', characters: 2 })
  })
  it('上游错误不泄漏密钥或服务返回的原始信息', async () => {
    const mockFetch = vi.fn(async () => Response.json({ code: 'InvalidApiKey', message: 'secret-key' }, { status: 401 })) as typeof fetch
    await expect(synthesizeQwen({ text: '你好', config, apiKey: 'secret-key', fetch: mockFetch })).rejects.toThrow('百炼密钥无效')
    await expect(synthesizeQwen({ text: '你好', config, apiKey: 'secret-key', fetch: mockFetch })).rejects.not.toThrow('secret-key')
  })
  it('取消在途请求不返回过期音频', async () => {
    const controller = new AbortController()
    const mockFetch = vi.fn((_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('abort', 'AbortError'))))) as typeof fetch
    const pending = synthesizeQwen({ text: '你好', config, apiKey: 'test-key', signal: controller.signal, fetch: mockFetch })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('音频流中断保留已经收到的计费用量', async () => {
    let reads = 0
    const stream = new ReadableStream({ pull(controller) {
      if (reads++ === 0) controller.enqueue(new TextEncoder().encode('data: {"output":{"audio":{"data":"AQACAA=="}},"usage":{"characters":2,"input_tokens":3,"output_tokens":10}}\n\n'))
      else controller.error(new TypeError('network interrupted'))
    } })
    const mockFetch = vi.fn(async () => new Response(stream, { headers: { 'content-type': 'text/event-stream' } })) as typeof fetch
    await expect(synthesizeQwen({ text: '你好', config, apiKey: 'test-key', fetch: mockFetch })).rejects.toMatchObject({ chargedCharacters: 2, usage: { inputTokens: 3, outputTokens: 10 }, usageUncertain: false })
  })
  it('SSE用量取末次累计值而不按句相加，缺失token不拿字符补齐', async () => {
    const mockFetch = vi.fn(async () => responseFromChunks([
      'data: {"output":{"audio":{"data":"AQACAA=="}},"usage":{"characters":50,"input_tokens":20,"output_tokens":60}}\n\n',
      'data: {"output":{"audio":{"data":"AwAEAA=="}},"usage":{"characters":100,"input_tokens":54,"output_tokens":125}}\n\n',
    ])) as typeof fetch
    expect(await synthesizeQwen({ text: '同一句话', config, apiKey: 'offline-key', fetch: mockFetch })).toMatchObject({ characters: 100, charactersReported: true, usage: { inputTokens: 54, outputTokens: 125 } })
    const noUsage = vi.fn(async () => Response.json({ output: { audio: { data: 'AQACAA==' } } })) as typeof fetch
    const missing = await synthesizeQwen({ text: '你好', config, apiKey: 'offline-key', fetch: noUsage })
    expect(missing.characters).toBe(2); expect(missing.charactersReported).toBe(false)
    expect(missing.usage?.inputTokens).toBeUndefined(); expect(missing.usage?.outputTokens).toBeUndefined()
  })
  it('音色设计发送model绑定并正确读取preview_audio', async () => {
    const mockFetch = vi.fn(async (_url, init) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({ model: 'voice-enrollment', input: { action: 'create_voice', target_model: config.model } })
      return Response.json({ output: { voice_id: 'fatfish-original', preview_audio: { data: 'AAAA' } } })
    }) as typeof fetch
    expect(await designQwenVoice({ description: '温柔、圆润、语速稍慢的成年中性声音', previewText: '晚上好呀，欢迎来到肥鱼的深夜小店，热水一直为你留着。', config, apiKey: 'test-key', fetch: mockFetch })).toEqual({ voice: 'fatfish-original', previewUrl: 'data:audio/wav;base64,AAAA' })
    expect(mockFetch.mock.calls[0]?.[0]).toMatch(/\/customization$/)
  })
  it('错误配置和试听长度在联网前拦截', async () => {
    const mockFetch = vi.fn() as typeof fetch
    await expect(synthesizeQwen({ text: '你好', config: { ...config, workspaceId: '' }, apiKey: 'test', fetch: mockFetch })).rejects.toThrow('业务空间')
    await expect(designQwenVoice({ description: '温暖的声音', previewText: '太短了', config, apiKey: 'test', fetch: mockFetch })).rejects.toThrow('15–200')
    expect(mockFetch).not.toHaveBeenCalled()
  })
  it('onRequest只在校验和取消检查通过后、真正fetch前触发', async () => {
    const order: string[] = [], onRequest = vi.fn(() => { order.push('request') })
    const mockFetch = vi.fn(async () => { order.push('fetch'); return Response.json({ output: { audio: { data: 'AAAA' } } }) }) as typeof fetch
    await synthesizeQwen({ text: '你好', config, apiKey: 'offline-key', fetch: mockFetch, onRequest })
    expect(order).toEqual(['request', 'fetch'])
    const cancelled = new AbortController(); cancelled.abort()
    await expect(synthesizeQwen({ text: '你好', config, apiKey: 'offline-key', fetch: mockFetch, onRequest, signal: cancelled.signal })).rejects.toMatchObject({ name: 'AbortError', requestNotStarted: true })
    expect(onRequest).toHaveBeenCalledOnce(); expect(mockFetch).toHaveBeenCalledOnce()
  })
  it('已返回的HTTP500优先于同时到达的取消，不能隐藏真实失败', async () => {
    const controller = new AbortController()
    const mockFetch = vi.fn(async () => { controller.abort(); return new Response('', { status: 500 }) }) as typeof fetch
    await expect(synthesizeQwen({ text: '你好', config, apiKey: 'offline-key', fetch: mockFetch, signal: controller.signal })).rejects.toMatchObject({ name: 'Error', providerFailure: true, httpStatus: 500 })
  })
})
