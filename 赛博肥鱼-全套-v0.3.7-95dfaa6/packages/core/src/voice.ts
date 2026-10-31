/**
 * Qwen HTTP TTS adapter. No network requests occur until explicitly called.
 * Reference (verified 2026-10-26):
 * https://help.aliyun.com/en/model-studio/qwen-audio-tts-http-api
 * https://help.aliyun.com/en/model-studio/voice-design-user-guide
 */
import type { AppConfig, VoiceUsage } from '../../shared/src/index'
import { usageNumber } from './usage'

export interface VoiceResult {
  kind: 'pcm' | 'url'
  data?: string
  url?: string
  sampleRate: number
  characters: number
  charactersReported?: boolean
  usage?: VoiceUsage
  words: { text: string; start: number; end: number }[]
}
export interface QwenOptions {
  text: string
  config: AppConfig['voice']
  apiKey: string
  signal?: AbortSignal
  onChunk?: (chunk: Uint8Array) => void
  /** Called exactly before fetch after local validation and abort checks. */
  onRequest?: () => void
  fetch?: typeof fetch
}

type SseObject = Record<string, any>

/** Incremental SSE framing; handles network splits, CRLF, comments and multi-line data. */
export class SseParser {
  private buffer = ''
  constructor(private receive: (data: string) => void) {}
  push(text: string): void {
    this.buffer += text
    let match: RegExpExecArray | null
    while ((match = /\r?\n\r?\n/.exec(this.buffer))) {
      const frame = this.buffer.slice(0, match.index)
      this.buffer = this.buffer.slice(match.index + match[0].length)
      this.frame(frame)
    }
  }
  finish(): void {
    if (this.buffer.trim()) this.frame(this.buffer)
    this.buffer = ''
  }
  private frame(frame: string): void {
    const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n')
    if (data && data !== '[DONE]') this.receive(data)
  }
}

function linkedAbort(signal?: AbortSignal, timeoutMs = 45_000) {
  const controller = new AbortController()
  const abort = () => controller.abort(signal?.reason)
  if (signal?.aborted) abort()
  else signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => controller.abort(new Error('配音请求超时，请检查网络或稍后重试。')), timeoutMs)
  return { signal: controller.signal, close() { clearTimeout(timer); signal?.removeEventListener('abort', abort) } }
}

function endpoint(config: AppConfig['voice'], customization = false): string {
  let base = config.baseUrl.trim().replace(/\/$/, '')
  if (!base) {
    if (!config.workspaceId.trim()) throw new Error('请先填写百炼业务空间 ID。')
    if (!/^[a-zA-Z0-9-]+$/.test(config.workspaceId.trim())) throw new Error('百炼业务空间 ID 格式不正确。')
    base = `https://${config.workspaceId.trim()}.cn-beijing.maas.aliyuncs.com`
  }
  base = base.replaceAll('{WorkspaceId}', config.workspaceId.trim()).replaceAll('{workspaceId}', config.workspaceId.trim())
  const url = new URL(base)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('配音地址必须使用 HTTPS。')
  if (!customization && /^qwen(?:3)?-tts-/i.test(config.model)) {
    const path = '/api/v1/services/aigc/multimodal-generation/generation'
    if (!url.pathname.endsWith(path)) url.pathname = url.pathname.replace(/\/(?:api\/v1)?\/?$/, '') + path
    return url.toString()
  }
  const path = customization ? 'customization' : 'SpeechSynthesizer'
  if (/\/api\/v1\/services\/audio\/tts\/(SpeechSynthesizer|customization)$/.test(url.pathname)) url.pathname = url.pathname.replace(/(SpeechSynthesizer|customization)$/, path)
  else url.pathname = `${url.pathname.replace(/\/$/, '')}/api/v1/services/audio/tts/${path}`
  return url.toString()
}

function providerError(body: SseObject, status?: number): Error {
  const code = String(body.code || body.error?.code || '')
  const serverCode = !code || /^(?:5\d\d|InternalError|InternalServerError|ServiceUnavailable|ServiceError|SystemError|ServerError|GatewayTimeout|BadGateway)(?:[._-]|$)/i.test(code)
  const tagged = (message: string) => Object.assign(new Error(message), { providerFailure: true, retryableVoice: !!status && status >= 500 && status <= 599 && serverCode, ...(status ? { httpStatus: status } : {}) })
  if (status === 401 || status === 403 || /InvalidApiKey|Unauthorized|AccessDenied/i.test(code)) return tagged('百炼密钥无效、地域不匹配或尚未开通语音服务，请检查设置。')
  if (status === 429 || /Throttling|RateLimit|LimitExceeded/i.test(code)) return tagged('千问配音请求过于频繁或额度不足，请稍后重试。')
  // Do not echo upstream messages: proxies can include Authorization headers.
  return tagged(`千问配音服务返回错误${status ? `（HTTP ${status}）` : ''}，请检查模型、音色与业务空间设置。`)
}

/** Only the adapter can label a failure transient; never infer it from user-visible text. */
export function canRetryQwenVoice(error: unknown): boolean {
  const value = error as { retryableVoice?: boolean; requestNotStarted?: boolean; usage?: VoiceUsage; chargedCharacters?: number; receivedAudio?: boolean }
  return value?.retryableVoice === true && !value.requestNotStarted && !value.receivedAudio && value.usage === undefined && value.chargedCharacters === undefined && !(error instanceof Error && error.name === 'AbortError')
}

/** Read at most a small error envelope, retaining no upstream text or credentials. */
async function responseFailure(response: Response): Promise<Error> {
  let body: SseObject = {}
  let reported: { usage?: VoiceUsage; chargedCharacters?: number; receivedAudio?: boolean } = {}
  if (response.body) {
    const reader = response.body.getReader(), parts: Uint8Array[] = []; let size = 0
    try {
      while (true) {
        const part = await reader.read(); if (part.done) break
        size += part.value.byteLength
        if (size > 65536) { await reader.cancel().catch(() => {}); break }
        parts.push(part.value)
      }
      if (size <= 65536) {
        const raw = JSON.parse(Buffer.concat(parts).toString('utf8')), code = raw?.code ?? raw?.error?.code
        if (typeof code === 'string' || typeof code === 'number') body = { code: String(code).slice(0, 160) }
        const inputTokens = usageNumber(raw?.usage?.input_tokens), outputTokens = usageNumber(raw?.usage?.output_tokens), characters = usageNumber(raw?.usage?.characters)
        if (inputTokens !== undefined || outputTokens !== undefined) reported.usage = { inputTokens, outputTokens }
        if (characters !== undefined) reported.chargedCharacters = characters
        if (typeof raw?.output?.audio?.data === 'string' && raw.output.audio.data || typeof raw?.output?.audio?.url === 'string' && raw.output.audio.url) reported.receivedAudio = true
      }
    } catch { /* HTTP status remains authoritative even with an unreadable error body. */ }
    finally { reader.releaseLock() }
  }
  return Object.assign(providerError(body, response.status), reported)
}

function validateKey(key: string) {
  if (!key.trim()) throw new Error('请先保存百炼 API 密钥。')
}

/** Consume PCM events as they arrive and return a complete PCM buffer for the current stage protocol. */
export async function synthesizeQwen(options: QwenOptions): Promise<VoiceResult> {
  const { config, apiKey, onChunk } = options
  const text = options.text.trim()
  const legacy = /^qwen(?:3)?-tts-/i.test(config.model)
  const instructed = /^qwen3-tts-instruct-flash(?:-\d{4}-\d{2}-\d{2})?$/i.test(config.model)
  const direction = config.instruction.trim()
  let url: string
  try {
    validateKey(apiKey)
    if (!text) throw new Error('请输入试听或配音文字。')
    if (text.length > 4000) throw new Error('单次配音文字请控制在 4000 字以内。')
    url = endpoint(config)
  } catch (error) { throw Object.assign(error instanceof Error ? error : new Error('配音参数不正确。'), { requestNotStarted: true }) }
  const abort = linkedAbort(options.signal)
  let requestStarted = false
  let receivedAudio = false
  let receivedResponseData = false
  let chargedCharacters: number | undefined
  let partialUsage: VoiceResult['usage']
  try {
    abort.signal.throwIfAborted()
    options.onRequest?.()
    requestStarted = true
    const response = await (options.fetch || fetch)(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...(!legacy ? { 'X-DashScope-SSE': 'enable' } : {}) },
      body: JSON.stringify({ model: config.model, input: legacy ? { text, voice: config.voice, language_type: 'Chinese' } : { text, voice: config.voice, format: 'pcm', sample_rate: 24000, rate: config.rate, instruction: config.instruction, word_timestamp_enabled: true, language_hints: ['zh'] }, ...(instructed && direction ? { parameters: { instructions: direction, optimize_instructions: true } } : {}) }),
      signal: abort.signal,
    })
    if (!response.ok) throw await responseFailure(response)
    const chunks: Uint8Array[] = []
    const words: VoiceResult['words'] = []
    let byteLength = 0
    let audioUrl: string | undefined
    let characters = text.length
    let inputTokens: number | undefined
    let outputTokens: number | undefined
    const consume = (event: SseObject) => {
      if (event.code || event.error || event.status_code && event.status_code !== 200) throw providerError(event)
      if (event.usage) {
        const reportedCharacters = usageNumber(event.usage.characters)
        if (reportedCharacters !== undefined) { characters = reportedCharacters; chargedCharacters = reportedCharacters }
        inputTokens = usageNumber(event.usage.input_tokens) ?? inputTokens
        outputTokens = usageNumber(event.usage.output_tokens) ?? outputTokens
        partialUsage = { inputTokens, outputTokens }
      }
      const output = event.output || {}
      const audio = output.audio || {}
      if (typeof audio.data === 'string' && audio.data) {
        const decoded = Uint8Array.from(Buffer.from(audio.data, 'base64'))
        byteLength += decoded.byteLength
        if (byteLength > 32 * 1024 * 1024) throw new Error('配音返回的音频过大，已停止接收。')
        chunks.push(decoded)
        receivedAudio = true
        onChunk?.(decoded)
      }
      if (typeof audio.url === 'string' && /^https?:\/\//.test(audio.url)) audioUrl = audio.url
      if (Array.isArray(output.sentence?.words)) {
        for (const word of output.sentence.words) {
          if (typeof word.text === 'string' && Number.isFinite(word.begin_time) && Number.isFinite(word.end_time)) words.push({ text: word.text, start: word.begin_time / 1000, end: word.end_time / 1000 })
        }
      }
    }
    if (/text\/event-stream/i.test(response.headers.get('content-type') || '')) {
      if (!response.body) throw new Error('千问没有返回音频流。')
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      const parser = new SseParser(data => { let event; try { event = JSON.parse(data) } catch { throw new Error('千问配音返回了无法解析的数据。') } consume(event) })
      try {
        while (true) { const { done, value } = await reader.read(); if (done) break; receivedResponseData ||= value.byteLength > 0; parser.push(decoder.decode(value, { stream: true })) }
        parser.push(decoder.decode())
        parser.finish()
      } catch (error) { await reader.cancel().catch(() => {}); throw error }
      finally { reader.releaseLock() }
    } else {
      let body: SseObject
      try { body = await response.json() as SseObject; receivedResponseData = true } catch { throw new Error('千问配音没有返回有效的数据。') }
      consume(body)
    }
    if (chunks.length) return { kind: 'pcm', data: Buffer.concat(chunks).toString('base64'), sampleRate: 24000, characters, charactersReported: chargedCharacters !== undefined, usage: { inputTokens, outputTokens }, words }
    if (audioUrl) return { kind: 'url', url: audioUrl, sampleRate: 24000, characters, charactersReported: chargedCharacters !== undefined, usage: { inputTokens, outputTokens }, words }
    throw new Error('千问已响应，但没有返回可播放的音频，请检查音色与模型是否匹配。')
  } catch (error) {
    let failure: Error
    if ((error as { providerFailure?: boolean })?.providerFailure && error instanceof Error) failure = error
    else if (abort.signal.aborted) failure = options.signal?.aborted ? new DOMException('配音已取消。', 'AbortError') : new Error('配音请求超时，请检查网络或稍后重试。')
    else if (error instanceof TypeError) failure = Object.assign(new Error('无法连接千问配音服务，请检查网络、业务空间与接口地址。'), { retryableVoice: !receivedResponseData && !receivedAudio && partialUsage === undefined && chargedCharacters === undefined })
    else failure = error instanceof Error ? error : new Error('千问配音未完成，请稍后重试。')
    if (!requestStarted || (error as { requestNotStarted?: boolean })?.requestNotStarted) Object.assign(failure, { requestNotStarted: true })
    // An interrupted stream can still be billed. Preserve reported usage; if only
    // audio arrived, conservatively estimate text characters and mark uncertainty.
    if (receivedAudio || chargedCharacters !== undefined || partialUsage) Object.assign(failure, { chargedCharacters: chargedCharacters ?? text.length, usage: partialUsage, usageUncertain: chargedCharacters === undefined, receivedAudio })
    throw failure
  } finally { abort.close() }
}

export async function designQwenVoice(options: {
  description: string; previewText: string; config: AppConfig['voice']; apiKey: string; signal?: AbortSignal; fetch?: typeof fetch
}): Promise<{ voice: string; previewUrl?: string }> {
  validateKey(options.apiKey)
  const description = options.description.trim()
  const previewText = options.previewText.trim()
  if (!description || description.length > 500) throw new Error('声音描述需要 1–500 字。')
  if (previewText.length < 15 || previewText.length > 200) throw new Error('声音设计的试听文字需要 15–200 字。')
  const abort = linkedAbort(options.signal, 120_000)
  try {
    const response = await (options.fetch || fetch)(endpoint(options.config, true), {
      method: 'POST', headers: { Authorization: `Bearer ${options.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'voice-enrollment', input: { action: 'create_voice', target_model: options.config.model, voice_prompt: description, preview_text: previewText, prefix: 'fatfish', language_hints: ['zh'] }, parameters: { sample_rate: 24000, response_format: 'wav' } }),
      signal: abort.signal,
    })
    if (!response.ok) throw providerError({}, response.status)
    const body = await response.json() as SseObject
    if (body.code || body.error) throw providerError(body)
    const output = body.output || {}
    const voice = output.voice_id || output.voice
    if (typeof voice !== 'string' || !voice) throw new Error('声音设计未返回音色 ID，请稍后重试。')
    const audio = output.preview_audio || {}
    let previewUrl: string | undefined
    if (typeof audio.data === 'string' && audio.data.length < 10 * 1024 * 1024) previewUrl = `data:audio/wav;base64,${audio.data}`
    else if (typeof audio.url === 'string' && /^https?:\/\//.test(audio.url)) previewUrl = audio.url
    return { voice, previewUrl }
  } catch (error) {
    if (abort.signal.aborted) {
      if (options.signal?.aborted) throw new DOMException('声音设计已取消。', 'AbortError')
      throw new Error('声音设计超时，请稍后重试。')
    }
    if (error instanceof TypeError) throw new Error('无法连接百炼声音设计服务，请检查网络与业务空间。')
    throw error
  } finally { abort.close() }
}
