/*
 * 自定义 API 服务商：三种接口形态的统一调用与模型列表拉取。
 *
 * - openai：OpenAI 兼容的 /chat/completions 与 /models（DeepSeek、千问兼容模式、Kimi、OpenRouter、硅基流动、自建中转都走这里）。
 * - gemini：Google 原生 generateContent 与 /models，密钥放 x-goog-api-key 请求头，不进地址。
 * - anthropic：/v1/messages 与 /v1/models。
 * 密钥只作为参数传入，绝不写进错误信息；所有错误都是中文。fetch 由调用方注入，测试全部离线。
 */
import type { AiModelInfo, AiProvider, AiProviderKind, AiProviderPreset } from '../../shared/src/ai'

export const AI_PROVIDER_PRESETS: AiProviderPreset[] = [
  { id: 'deepseek', name: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com', keyHint: 'sk-…', suggestedModels: ['deepseek-flash', 'deepseek-chat', 'deepseek-reasoner'] },
  { id: 'gemini', name: 'Google Gemini', kind: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', keyHint: 'AIza…', suggestedModels: ['gemini-2.5-flash', 'gemini-2.5-pro'] },
  { id: 'openai', name: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', keyHint: 'sk-…', suggestedModels: ['gpt-4.1-mini', 'gpt-4.1'] },
  { id: 'anthropic', name: 'Anthropic Claude', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', keyHint: 'sk-ant-…', suggestedModels: ['claude-sonnet-5-5', 'claude-haiku-5-5'] },
  { id: 'qwen', name: '千问（百炼兼容模式）', kind: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', keyHint: 'sk-…', suggestedModels: ['qwen-plus', 'qwen-turbo'] },
  { id: 'kimi', name: 'Kimi（月之暗面）', kind: 'openai', baseUrl: 'https://api.moonshot.cn/v1', keyHint: 'sk-…', suggestedModels: ['kimi-latest'] },
  { id: 'openrouter', name: 'OpenRouter', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1', keyHint: 'sk-or-…', suggestedModels: [] },
  { id: 'siliconflow', name: '硅基流动', kind: 'openai', baseUrl: 'https://api.siliconflow.cn/v1', keyHint: 'sk-…', suggestedModels: [] },
  { id: 'custom', name: '自定义（OpenAI 兼容）', kind: 'openai', baseUrl: '', keyHint: '服务商提供的密钥', suggestedModels: [] },
]
export const AI_PROVIDER_KINDS: { id: AiProviderKind; name: string }[] = [{ id: 'openai', name: 'OpenAI 兼容' }, { id: 'gemini', name: 'Gemini 原生' }, { id: 'anthropic', name: 'Anthropic 原生' }]

export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; headers?: { get(name: string): string | null }; json(): Promise<any>; text?(): Promise<string> }>
export interface AiMessage { role: 'system' | 'user' | 'assistant'; content: string }
export interface AiChatRequest { provider: AiProvider; key: string; model: string; messages: AiMessage[]; json?: boolean; temperature?: number; maxTokens?: number; thinking?: boolean; signal?: AbortSignal; timeoutMs?: number }
/** inputTokens/outputTokens stay undefined when the provider does not report them; a missing number is never a zero. */
export interface AiChatResult { text: string; usage: { inputTokens?: number; outputTokens?: number; cachedTokens?: number; cacheWriteTokens?: number }; latencyMs: number }

const ERRORS: Record<number, string> = { 400: '请求参数不被该模型支持，请核对模型名和接口形态', 401: '密钥无效，请重新保存', 402: '账户余额不足', 403: '密钥没有访问该模型或接口的权限', 404: '接口地址或模型不存在', 408: '服务端超时', 413: '请求内容过长', 429: '请求过于频繁或额度用尽，请稍后重试', 500: '服务商内部错误', 502: '服务商网关错误', 503: '服务商暂时不可用', 529: '服务商过载' }
export type AiFailureCategory = 'authentication' | 'billing' | 'rate_limit' | 'timeout' | 'network' | 'server' | 'configuration' | 'invalid_response' | 'cancelled' | 'unknown'
export class AiProviderError extends Error { constructor(message: string, readonly status?: number, readonly category?: AiFailureCategory, readonly retryAfterMs?: number) { super(message) } }
/** Allowlisted diagnosis only: provider response bodies, URLs and reflected secrets never enter audit/status. */
export function aiFailure(error: unknown) {
  const status = error instanceof AiProviderError ? error.status : undefined
  const category: AiFailureCategory = error instanceof AiProviderError && error.category || (status === 401 || status === 403 ? 'authentication' : status === 402 ? 'billing' : status === 429 ? 'rate_limit' : status === 408 || status === 504 ? 'timeout' : status && status >= 500 ? 'server' : status && status >= 400 ? 'configuration' : 'unknown')
  const descriptions: Record<AiFailureCategory,string> = { authentication:'密钥或模型权限异常，请检查服务商配置。', billing:'服务商报告余额不足，请检查账户。', rate_limit:'服务商限流或额度受限，等待后再试。', timeout:'模型请求超时。', network:'模型服务连接失败。', server:'模型服务暂时异常。', configuration:'模型或接口配置不被服务商支持。', invalid_response:'模型返回内容不符合要求。', cancelled:'请求已取消。', unknown:'请求失败，错误类别暂未识别。' }
  return { category, ...(status !== undefined ? { httpStatus: status } : {}), message: descriptions[category], retryable: !['authentication','billing','configuration','cancelled'].includes(category), ...(error instanceof AiProviderError && Number.isFinite(error.retryAfterMs) ? { retryAfterMs: Math.min(86400000, Math.max(0,error.retryAfterMs!)) } : {}) }
}

export function validateBaseUrl(value: string): string {
  let url: URL
  try { url = new URL(value.trim()) } catch { throw new AiProviderError('接口地址格式不正确，应以 https:// 开头。') }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new AiProviderError('接口地址必须使用 https；只有本机 127.0.0.1 / localhost 中转可以用 http。')
  if (url.username || url.password) throw new AiProviderError('接口地址里不能带账号密码，请把密钥填到密钥栏。')
  if (url.search || url.hash) throw new AiProviderError('接口地址不要带 ? 或 # 参数。')
  return url.href.replace(/\/+$/, '')
}
function join(base: string, path: string) {
  const root = validateBaseUrl(base)
  // Users often paste the full chat endpoint; strip it so both chat and model listing resolve.
  return root.replace(/\/(chat\/completions|messages|models)$/, '') + path
}
const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined

function headers(provider: AiProvider, key: string): Record<string, string> {
  if (provider.kind === 'gemini') return { 'Content-Type': 'application/json', 'x-goog-api-key': key }
  if (provider.kind === 'anthropic') return { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }
}

async function send(fetcher: Fetch, url: string, init: Parameters<Fetch>[1], label: string, timeoutMs = 30000) {
  const timeout = AbortSignal.timeout(timeoutMs)
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout
  let response: Awaited<ReturnType<Fetch>>
  try { response = await fetcher(url, { ...init, signal }) }
  catch (error) {
    if (init.signal?.aborted) throw new AiProviderError('请求已取消。', undefined, 'cancelled')
    if (timeout.aborted) throw new AiProviderError(`${label}超时（${Math.round(timeoutMs / 1000)} 秒），请检查网络或换个更快的模型。`, undefined, 'timeout')
    throw new AiProviderError(`${label}无法连接，请检查接口地址、代理和网络。`, undefined, 'network')
  }
  if (!response.ok) {
    let detail = ''
    // Provider messages help diagnose a wrong model name; trimmed so a reflected key or long HTML page cannot flood the log.
    try { const body = await response.json(); const message = body?.error?.message || body?.message || body?.error; if (typeof message === 'string') detail = message.replace(/\s+/g, ' ').slice(0, 160) } catch { /* Non-JSON error page. */ }
    const after=response.headers?.get('retry-after'), seconds=after === null || after === undefined || after.trim()==='' ? NaN : Number(after)
    const retryAfterMs=Number.isFinite(seconds)?seconds*1000:after?Date.parse(after)-Date.now():undefined
    throw new AiProviderError(`${label} ${response.status}：${ERRORS[response.status] || '服务暂时不可用'}${detail ? `（${detail}）` : ''}。`, response.status, undefined, retryAfterMs)
  }
  try { return await response.json() } catch {
    if(init.signal?.aborted)throw new AiProviderError('请求已取消。',undefined,'cancelled')
    if(timeout.aborted)throw new AiProviderError(`${label}读取响应超时，请检查网络。`,undefined,'timeout')
    throw new AiProviderError(`${label}返回的不是有效 JSON，请确认接口形态选择正确。`, undefined, 'invalid_response')
  }
}
export function redact(message: string, secrets: (string | undefined)[]) {
  let result = message
  for (const secret of secrets) if (secret && secret.length >= 6) result = result.split(secret).join('[密钥已隐藏]')
  return result
}

/** Pulls the provider's model catalogue. Chat models are kept; obvious embedding/audio/image-only ids are dropped. */
export async function listModels(fetcher: Fetch, provider: AiProvider, key: string, signal?: AbortSignal): Promise<AiModelInfo[]> {
  if (!key) throw new AiProviderError('请先保存这个服务商的密钥，再拉取模型列表。')
  const models: AiModelInfo[] = []
  if (provider.kind === 'gemini') {
    let pageToken = ''
    for (let page = 0; page < 10; page++) {
      const body = await send(fetcher, join(provider.baseUrl, `/models?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`), { method: 'GET', headers: headers(provider, key), signal }, '拉取模型列表')
      for (const m of Array.isArray(body?.models) ? body.models : []) {
        if (typeof m?.name !== 'string' || Array.isArray(m.supportedGenerationMethods) && !m.supportedGenerationMethods.includes('generateContent')) continue
        models.push({ id: m.name.replace(/^models\//, ''), name: typeof m.displayName === 'string' ? m.displayName : undefined, contextWindow: count(m.inputTokenLimit) })
      }
      pageToken = typeof body?.nextPageToken === 'string' ? body.nextPageToken : ''
      if (!pageToken) break
    }
  } else if (provider.kind === 'anthropic') {
    let after = ''
    for (let page = 0; page < 10; page++) {
      const body = await send(fetcher, join(provider.baseUrl, `/v1/models?limit=1000${after ? `&after_id=${encodeURIComponent(after)}` : ''}`), { method: 'GET', headers: headers(provider, key), signal }, '拉取模型列表')
      for (const m of Array.isArray(body?.data) ? body.data : []) if (typeof m?.id === 'string') models.push({ id: m.id, name: typeof m.display_name === 'string' ? m.display_name : undefined })
      after = body?.has_more && typeof body?.last_id === 'string' ? body.last_id : ''
      if (!after) break
    }
  } else {
    const body = await send(fetcher, join(provider.baseUrl, '/models'), { method: 'GET', headers: headers(provider, key), signal }, '拉取模型列表')
    for (const m of Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : []) {
      if (typeof m?.id !== 'string') continue
      models.push({ id: m.id, name: typeof m.name === 'string' && m.name !== m.id ? m.name : undefined, ownedBy: typeof m.owned_by === 'string' ? m.owned_by : undefined, contextWindow: count(m.context_length ?? m.context_window) })
    }
  }
  const seen = new Set<string>()
  return models.filter(m => !/(embed|embedding|tts|whisper|transcribe|dall-e|imagen|image-generation|moderation|rerank|aqa)/i.test(m.id) && !seen.has(m.id) && !!seen.add(m.id))
    .sort((a, b) => a.id.localeCompare(b.id)).slice(0, 2000)
}

/** Vendor-only switches. Unknown vendors get nothing extra, so a custom relay never receives a field it may reject. */
function openaiExtras(provider: AiProvider, model: string, thinking: boolean | undefined): Record<string, unknown> {
  if (provider.preset === 'deepseek') return { thinking: { type: thinking ? 'enabled' : 'disabled' } }
  if (provider.preset === 'qwen') return { enable_thinking: !!thinking }
  if (provider.preset === 'openai' && thinking && /^(o\d|gpt-5)/.test(model)) return { reasoning_effort: 'medium' }
  return {}
}

export async function chat(fetcher: Fetch, request: AiChatRequest): Promise<AiChatResult> {
  const { provider, key, model, messages } = request
  if (!key) throw new AiProviderError(`「${provider.name}」还没有保存密钥。`, undefined, 'configuration')
  if (!model.trim()) throw new AiProviderError(`请先给「${provider.name}」选择模型。`, undefined, 'configuration')
  const started = Date.now(), maxTokens = Math.max(64, Math.min(32000, Math.round(request.maxTokens || 800)))
  const temperature = typeof request.temperature === 'number' ? Math.max(0, Math.min(2, request.temperature)) : undefined
  const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n')
  const turns = messages.filter(m => m.role !== 'system')
  let text = '', usage: AiChatResult['usage'] = {}
  try {
    if (provider.kind === 'gemini') {
      const body = await send(fetcher, join(provider.baseUrl, `/models/${encodeURIComponent(model.replace(/^models\//, ''))}:generateContent`), {
        method: 'POST', headers: headers(provider, key), signal: request.signal,
        body: JSON.stringify({ ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          contents: turns.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
          generationConfig: { maxOutputTokens: maxTokens, ...(temperature !== undefined ? { temperature } : {}), ...(request.json ? { responseMimeType: 'application/json' } : {}),
            // Flash models think by default and bill it as output; Pro cannot turn it off, so only Flash gets the switch.
            ...(!request.thinking && /2\.5-flash/.test(model) ? { thinkingConfig: { thinkingBudget: 0 } } : {}) } }),
      }, '对话请求', request.timeoutMs)
      const candidate = body?.candidates?.[0]
      if (!candidate && body?.promptFeedback?.blockReason) throw new AiProviderError(`Gemini 拒绝了这次内容（${body.promptFeedback.blockReason}）。`)
      text = (candidate?.content?.parts || []).filter((p: any) => !p.thought && typeof p.text === 'string').map((p: any) => p.text).join('')
      usage = { inputTokens: count(body?.usageMetadata?.promptTokenCount), outputTokens: count((body?.usageMetadata?.candidatesTokenCount ?? 0) + (body?.usageMetadata?.thoughtsTokenCount ?? 0)), cachedTokens: count(body?.usageMetadata?.cachedContentTokenCount) }
      if (body?.usageMetadata?.candidatesTokenCount === undefined) usage.outputTokens = undefined
    } else if (provider.kind === 'anthropic') {
      const budget = request.thinking ? Math.max(1024, Math.min(8000, maxTokens)) : 0
      const body = await send(fetcher, join(provider.baseUrl, '/v1/messages'), {
        method: 'POST', headers: headers(provider, key), signal: request.signal,
        body: JSON.stringify({ model, max_tokens: maxTokens + budget, ...(system ? { system:[{type:'text',text:system,cache_control:{type:'ephemeral'}}] } : {}), messages: turns.map(m => ({ role: m.role, content: m.content })),
          ...(budget ? { thinking: { type: 'enabled', budget_tokens: budget } } : temperature !== undefined ? { temperature: Math.min(1, temperature) } : {}) }),
      }, '对话请求', request.timeoutMs)
      text = (Array.isArray(body?.content) ? body.content : []).filter((p: any) => p?.type === 'text').map((p: any) => p.text).join('')
      const uncached=count(body?.usage?.input_tokens),read=count(body?.usage?.cache_read_input_tokens),write=count(body?.usage?.cache_creation_input_tokens)
      usage = { inputTokens:uncached===undefined?undefined:uncached+(read??0)+(write??0), outputTokens:count(body?.usage?.output_tokens),cachedTokens:read,cacheWriteTokens:write }
    } else {
      const body = await send(fetcher, join(provider.baseUrl, '/chat/completions'), {
        method: 'POST', headers: headers(provider, key), signal: request.signal,
        body: JSON.stringify({ model, messages, stream: false, max_tokens: maxTokens, ...(temperature !== undefined ? { temperature } : {}),
          ...(request.json ? { response_format: { type: 'json_object' } } : {}), ...openaiExtras(provider, model, request.thinking) }),
      }, '对话请求', request.timeoutMs)
      const content = body?.choices?.[0]?.message?.content
      text = typeof content === 'string' ? content : Array.isArray(content) ? content.map((p: any) => p?.text || '').join('') : ''
      usage = { inputTokens: count(body?.usage?.prompt_tokens), outputTokens: count(body?.usage?.completion_tokens), cachedTokens: count(body?.usage?.prompt_cache_hit_tokens ?? body?.usage?.prompt_tokens_details?.cached_tokens) }
    }
  } catch (error) { throw error instanceof AiProviderError ? new AiProviderError(redact(error.message, [key]), error.status, error.category, error.retryAfterMs) : error }
  if (!text.trim()) throw new AiProviderError('模型返回了空内容，可能是输出上限太小或内容被拦截。', undefined, 'invalid_response')
  return { text, usage, latencyMs: Date.now() - started }
}

/** Models wrap JSON in fences or add a sentence before it; take the outermost object and parse that. */
export function parseJsonObject(text: string): Record<string, any> {
  const cleaned = text.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '')
  const start = cleaned.indexOf('{'), end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) throw new AiProviderError('模型没有按要求返回 JSON。', undefined, 'invalid_response')
  try { const value = JSON.parse(cleaned.slice(start, end + 1)); if (value && typeof value === 'object' && !Array.isArray(value)) return value } catch { /* Reported below. */ }
  throw new AiProviderError('模型返回的 JSON 无法解析。', undefined, 'invalid_response')
}
