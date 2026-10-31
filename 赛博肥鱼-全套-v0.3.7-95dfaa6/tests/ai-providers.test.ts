import { describe, expect, it } from 'vitest'
import { chat, listModels, parseJsonObject, validateBaseUrl, type Fetch } from '../packages/core/src/ai-providers'
import type { AiProvider } from '../packages/shared/src/ai'

const KEY = 'sk-offline-test-key-123456'
const provider = (over: Partial<AiProvider> = {}): AiProvider => ({ id: 'p', name: '测试', kind: 'openai', preset: 'custom', baseUrl: 'https://relay.example/v1', enabled: true, models: [], ...over })
function fake(body: unknown, status = 200) {
  const calls: { url: string; init: Parameters<Fetch>[1] }[] = []
  const fetcher: Fetch = async (url, init) => { calls.push({ url, init }); return { ok: status < 400, status, json: async () => body } }
  return { fetcher, calls }
}

describe('AI providers', () => {
  it('OpenAI 兼容：拼接地址、带 Bearer、过滤非对话模型', async () => {
    const { fetcher, calls } = fake({ data: [{ id: 'gpt-b' }, { id: 'text-embedding-3' }, { id: 'gpt-a', owned_by: 'x' }, { id: 'gpt-a' }] })
    const models = await listModels(fetcher, provider({ baseUrl: 'https://relay.example/v1/chat/completions' }), KEY)
    expect(calls[0]!.url).toBe('https://relay.example/v1/models')
    expect(calls[0]!.init.headers.Authorization).toBe(`Bearer ${KEY}`)
    expect(models.map(m => m.id)).toEqual(['gpt-a', 'gpt-b'])
  })
  it('Gemini 原生：密钥放请求头不进地址，只保留 generateContent 模型并翻页', async () => {
    const pages = [{ models: [{ name: 'models/gemini-2.5-flash', displayName: 'Flash', supportedGenerationMethods: ['generateContent'], inputTokenLimit: 1000000 }, { name: 'models/embedding-001', supportedGenerationMethods: ['embedContent'] }], nextPageToken: 'n2' }, { models: [{ name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] }] }]
    const urls: string[] = []
    const fetcher: Fetch = async (url, init) => { urls.push(url); expect(init.headers['x-goog-api-key']).toBe(KEY); return { ok: true, status: 200, json: async () => pages.shift() } }
    const models = await listModels(fetcher, provider({ kind: 'gemini', preset: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' }), KEY)
    expect(urls.every(u => !u.includes(KEY))).toBe(true); expect(urls[1]).toContain('pageToken=n2')
    expect(models).toEqual([{ id: 'gemini-2.5-flash', name: 'Flash', contextWindow: 1000000 }, { id: 'gemini-2.5-pro', name: undefined, contextWindow: undefined }])
  })
  it('Anthropic 原生：x-api-key 与版本头', async () => {
    const { fetcher, calls } = fake({ data: [{ id: 'claude-x', display_name: 'Claude X' }], has_more: false })
    expect(await listModels(fetcher, provider({ kind: 'anthropic', baseUrl: 'https://api.anthropic.com' }), KEY)).toEqual([{ id: 'claude-x', name: 'Claude X' }])
    expect(calls[0]!.url).toBe('https://api.anthropic.com/v1/models?limit=1000'); expect(calls[0]!.init.headers['x-api-key']).toBe(KEY)
  })
  it('DeepSeek 对话带思考开关与 JSON 模式，用量缺失不当成零', async () => {
    const { fetcher, calls } = fake({ choices: [{ message: { content: '{"ok":true}' } }] })
    const result = await chat(fetcher, { provider: provider({ preset: 'deepseek', baseUrl: 'https://api.deepseek.com' }), key: KEY, model: 'deepseek-flash', messages: [{ role: 'user', content: 'hi' }], json: true, thinking: true })
    const body = JSON.parse(calls[0]!.init.body!)
    expect(calls[0]!.url).toBe('https://api.deepseek.com/chat/completions')
    expect(body).toMatchObject({ model: 'deepseek-flash', thinking: { type: 'enabled' }, response_format: { type: 'json_object' } })
    expect(result.usage).toEqual({ inputTokens: undefined, outputTokens: undefined, cachedTokens: undefined })
  })
  it('自定义中转不收到厂商专属字段', async () => {
    const { fetcher, calls } = fake({ choices: [{ message: { content: 'x' } }], usage: { prompt_tokens: 3, completion_tokens: 4 } })
    const result = await chat(fetcher, { provider: provider(), key: KEY, model: 'm', messages: [{ role: 'user', content: 'hi' }], thinking: true })
    const body = JSON.parse(calls[0]!.init.body!)
    expect(body.thinking).toBeUndefined(); expect(body.enable_thinking).toBeUndefined(); expect(result.usage).toMatchObject({ inputTokens: 3, outputTokens: 4 })
  })
  it('Gemini 对话：系统提示词进 systemInstruction，过滤思考片段', async () => {
    const { fetcher, calls } = fake({ candidates: [{ content: { parts: [{ text: '想法', thought: true }, { text: '{"a":1}' }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } })
    const result = await chat(fetcher, { provider: provider({ kind: 'gemini', preset: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' }), key: KEY, model: 'gemini-2.5-flash', messages: [{ role: 'system', content: '人设' }, { role: 'user', content: '弹幕' }], json: true })
    const body = JSON.parse(calls[0]!.init.body!)
    expect(calls[0]!.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent')
    expect(body.systemInstruction.parts[0].text).toBe('人设'); expect(body.contents).toEqual([{ role: 'user', parts: [{ text: '弹幕' }] }])
    expect(body.generationConfig).toMatchObject({ responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } })
    expect(result.text).toBe('{"a":1}'); expect(result.usage).toMatchObject({ inputTokens: 10, outputTokens: 5 })
  })
  it('Anthropic 对话：system 单独传，开启思考时不传温度', async () => {
    const { fetcher, calls } = fake({ content: [{ type: 'thinking', thinking: '...' }, { type: 'text', text: '好' }], usage: { input_tokens: 1, output_tokens: 2 } })
    expect((await chat(fetcher, { provider: provider({ kind: 'anthropic', baseUrl: 'https://api.anthropic.com' }), key: KEY, model: 'claude-x', messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }], thinking: true, temperature: 0.5, maxTokens: 500 })).text).toBe('好')
    const body = JSON.parse(calls[0]!.init.body!)
    expect(body).toMatchObject({ system:[{type:'text',text:'s',cache_control:{type:'ephemeral'}}], messages: [{ role: 'user', content: 'u' }], thinking: { type: 'enabled', budget_tokens: 1024 }, max_tokens: 1524 }); expect(body.temperature).toBeUndefined()
  })
  it('错误信息为中文且隐藏密钥', async () => {
    const { fetcher } = fake({ error: { message: `bad key ${KEY}` } }, 401)
    await expect(chat(fetcher, { provider: provider(), key: KEY, model: 'm', messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow(/401：密钥无效.*\[密钥已隐藏\]/)
    await expect(listModels(fetcher, provider(), '')).rejects.toThrow('请先保存')
  })
  it('只接受 https 或本机 http，拒绝地址里带凭据', () => {
    expect(validateBaseUrl('https://a.example/v1/')).toBe('https://a.example/v1')
    expect(validateBaseUrl('http://127.0.0.1:8080/v1')).toBe('http://127.0.0.1:8080/v1')
    expect(() => validateBaseUrl('http://evil.example')).toThrow('https')
    expect(() => validateBaseUrl('https://u:p@a.example')).toThrow('账号密码')
    expect(() => validateBaseUrl('https://a.example?key=1')).toThrow('参数')
  })
  it('从带说明文字或代码块的回复中解析 JSON', () => {
    expect(parseJsonObject('好的：\n```json\n{"replies":[]}\n```')).toEqual({ replies: [] })
    expect(() => parseJsonObject('没有 JSON')).toThrow('JSON')
  })
  it('Anthropic缓存读取/写入计入总输入，缓存缺失和零区分',async()=>{
    const {fetcher}=fake({content:[{type:'text',text:'ok'}],usage:{input_tokens:10,output_tokens:5,cache_read_input_tokens:1000,cache_creation_input_tokens:200}})
    const result=await chat(fetcher,{provider:provider({kind:'anthropic'}),key:KEY,model:'claude-x',messages:[{role:'user',content:'x'}]})
    expect(result.usage).toMatchObject({inputTokens:1210,cachedTokens:1000,cacheWriteTokens:200,outputTokens:5})
    const miss=fake({choices:[{message:{content:'ok'}}],usage:{prompt_tokens:100,completion_tokens:5,prompt_cache_hit_tokens:0}})
    expect((await chat(miss.fetcher,{provider:provider(),key:KEY,model:'x',messages:[]})).usage.cachedTokens).toBe(0)
  })
})
