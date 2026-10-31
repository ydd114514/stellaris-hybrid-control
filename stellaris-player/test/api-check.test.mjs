import test from 'node:test'
import assert from 'node:assert/strict'
import { inflateSync } from 'node:zlib'
import { setImmediate as tick } from 'node:timers/promises'
import { createColorProbePng, verifyDeepSeekApi } from '../src/api-check.mjs'

const KEY = 'sk-offline-verification-key-do-not-use'
const models = () => ({ object: 'list', data: [{ id: 'deepseek-flash', input_modalities: ['text', 'image'] }] })
const usage = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, prompt_cache_hit_tokens: 40, prompt_cache_miss_tokens: 60, prompt_tokens_details: { cached_tokens: 40 }, completion_tokens_details: { reasoning_tokens: 5 } }
const text = () => ({ model: 'deepseek-flash', choices: [{ finish_reason: 'stop', message: { content: 'DEEPSEEK_CONNECTION_OK', reasoning_content: 'PRIVATE_REASONING' } }], usage })
const vision = colors => ({ model: 'deepseek-flash', choices: [{ finish_reason: 'tool_calls', message: { content: null, reasoning_content: 'PRIVATE_REASONING', tool_calls: [{ id: 'probe', type: 'function', function: { name: 'report_colors', arguments: JSON.stringify(colors ?? { left: 'red', right: 'blue' }) } }] } }], usage })
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, async json() { return data } })
function setup(replies = [response(models()), response(text()), response(vision())]) {
 const calls = []
 return { calls, async fetch(url, options) { calls.push({ url, ...options, parsed: options.body ? JSON.parse(options.body) : undefined }); const next = replies.shift(); if (!next) throw new Error('Unexpected additional request'); return next } }
}

test('内存PNG有合法签名、CRC、尺寸和真实左右双色像素', () => {
 const png = createColorProbePng(), signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
 assert.ok(png.subarray(0, 8).equals(signature))
 let offset = 8, header, compressed = [], ended = false
 while (offset < png.length) {
  const length = png.readUInt32BE(offset), type = png.toString('ascii', offset + 4, offset + 8), data = png.subarray(offset + 8, offset + 8 + length)
  let crc = -1
  for (const byte of png.subarray(offset + 4, offset + 8 + length)) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0) }
  assert.equal((crc ^ -1) >>> 0, png.readUInt32BE(offset + 8 + length))
  if (type === 'IHDR') header = data
  if (type === 'IDAT') compressed.push(data)
  if (type === 'IEND') ended = true
  offset += length + 12
 }
 assert.equal(offset, png.length); assert.equal(ended, true)
 const width = header.readUInt32BE(0), height = header.readUInt32BE(4)
 assert.equal(width % 2, 0); assert.ok(width >= 64 && height >= 32)
 assert.equal(header[8], 8); assert.equal(header[9], 2)
 const rows = inflateSync(Buffer.concat(compressed))
 assert.equal(rows.length, height * (1 + width * 3))
 for (let y = 0; y < height; y++) {
  assert.equal(rows[y * (1 + width * 3)], 0)
  for (let x = 0; x < width; x++) assert.deepEqual([...rows.subarray(y * (1 + width * 3) + 1 + x * 3, y * (1 + width * 3) + 4 + x * 3)], x < width / 2 ? [255, 0, 0] : [0, 0, 255])
 }
})

test('三步成功记录真实usage和请求计数，不把颜色答案写进视觉prompt', async () => {
 const mock = setup(), result = await verifyDeepSeekApi({ apiKey: KEY, fetch: mock.fetch })
 assert.equal(result.ok, true); assert.deepEqual(result.checks, { models: true, text: true, vision: true, tools: true })
 assert.equal(result.actualRequests, 3); assert.equal(result.generatedRequests, 2)
 assert.deepEqual(mock.calls.map(call => [call.method, call.url]), [['GET', 'https://api.deepseek.com/models'], ['POST', 'https://api.deepseek.com/chat/completions'], ['POST', 'https://api.deepseek.com/chat/completions']])
 for (const call of mock.calls) { assert.equal(call.redirect, 'error'); assert.equal(call.headers.Authorization, `Bearer ${KEY}`) }
 assert.equal(mock.calls[0].body, undefined)
 assert.equal(mock.calls[1].parsed.max_tokens, 32); assert.equal(mock.calls[2].parsed.max_tokens, 128)
 for (const call of mock.calls.slice(1)) assert.deepEqual(call.parsed.thinking, { type: 'disabled' })
 assert.equal(mock.calls[2].parsed.tool_choice, 'required')
 assert.equal(mock.calls[2].parsed.tools.length, 1)
 assert.equal(mock.calls[2].parsed.tools[0].function.name, 'report_colors')
 const content = mock.calls[2].parsed.messages[0].content
 assert.doesNotMatch(content[0].text, /red|blue|红|蓝/i)
 const image = Buffer.from(content[1].image_url.url.split(',')[1], 'base64')
 assert.ok(image.equals(createColorProbePng()))
 for (const record of result.requests) { assert.equal(record.httpStatus, 200); assert.ok(record.elapsedMs >= 0); assert.equal(record.ok, true) }
 assert.deepEqual(result.requests[1].usage, usage); assert.deepEqual(result.requests[2].usage, usage)
 const output = JSON.stringify(result)
 for (const forbidden of [KEY, 'Authorization', 'headers', 'base64', 'PRIVATE_REASONING', 'reasoning_content', 'DEEPSEEK_CONNECTION_OK']) assert.equal(output.includes(forbidden), false)
})

test('模型不存在或未声明图像能力时不产生任何生成请求', async t => {
 for (const data of [{ object: 'list', data: [] }, { object: 'list', data: [{ id: 'deepseek-flash', input_modalities: ['text'] }] }, { object: 'list', data: [{ id: 'deepseek-flash' }] }]) await t.test('拒绝不适配模型', async () => {
  const mock = setup([response(data)]), result = await verifyDeepSeekApi({ apiKey: KEY, fetch: mock.fetch })
  assert.equal(result.ok, false); assert.equal(result.actualRequests, 1); assert.equal(result.generatedRequests, 0)
  assert.equal(mock.calls.length, 1); assert.equal(result.error.stage, 'models')
 })
})

test('文本标记错误、截断、非字符串或错误工具调用即停止，不进入视觉', async t => {
 const replies = [text(), text(), text(), text()]
 replies[0].choices[0].message.content = 'OTHER'
 replies[1].choices[0].finish_reason = 'length'
 replies[2].choices[0].message.content = 123
 replies[3].choices[0].message.tool_calls = [{ function: { name: 'unexpected' } }]
 for (const reply of replies) await t.test('拒绝不符合文本协议的响应', async () => {
  const mock = setup([response(models()), response(reply)]), result = await verifyDeepSeekApi({ apiKey: KEY, fetch: mock.fetch })
  assert.equal(result.ok, false); assert.equal(result.checks.text, false); assert.equal(result.actualRequests, 2); assert.equal(result.generatedRequests, 1)
  assert.equal(result.error.code, 'TEXT_MISMATCH'); assert.equal(mock.calls.length, 2)
 })
})

test('正确工具语法与正确视觉答案分别报告，不把格式成功当视觉成功', async t => {
 const wrongColors = vision({ left: 'blue', right: 'red' })
 const duplicate = vision(); duplicate.choices[0].message.tool_calls.push(duplicate.choices[0].message.tool_calls[0])
 const invalidJson = vision(); invalidJson.choices[0].message.tool_calls[0].function.arguments = '{broken'
 const extra = vision({ left: 'red', right: 'blue', secret: KEY })
 const wrongTool = vision(); wrongTool.choices[0].message.tool_calls[0].function.name = 'do_action'
 for (const [reply, tools] of [[wrongColors, true], [duplicate, false], [invalidJson, false], [extra, false], [wrongTool, false]]) await t.test('拒绝视觉工具错误', async () => {
  const mock = setup([response(models()), response(text()), response(reply)]), result = await verifyDeepSeekApi({ apiKey: KEY, fetch: mock.fetch })
  assert.equal(result.ok, false); assert.equal(result.checks.vision, false); assert.equal(result.checks.tools, tools)
  assert.equal(result.actualRequests, 3); assert.equal(result.generatedRequests, 2)
  assert.equal(JSON.stringify(result).includes(KEY), false)
 })
})

test('HTTP错误保留状态与脱敏错误标识，不输出密钥、请求体或推理', async t => {
 const failures = [
  { message: `invalid token ${KEY}`, code: 'invalid_api_key', type: 'authentication_error' },
  { message: `Authorization: Bearer ${KEY}; {"messages":[{"content":"data:image/png;base64,AAAAAAAA"}]}`, code: KEY, type: 'bad_type' },
  { message: 'reasoning_content: PRIVATE_REASONING', code: 'bad_request', type: 'invalid_request_error' },
 ]
 for (const remote of failures) await t.test('脱敏远程错误', async () => {
  const mock = setup([response({ error: remote }, 401)]), result = await verifyDeepSeekApi({ apiKey: KEY, fetch: mock.fetch })
  assert.equal(result.ok, false); assert.equal(result.error.httpStatus, 401); assert.equal(result.requests[0].httpStatus, 401)
  assert.equal(result.actualRequests, 1); assert.equal(result.generatedRequests, 0)
  for (const forbidden of [KEY, 'Bearer', 'Authorization', 'base64', 'PRIVATE_REASONING', 'reasoning_content']) assert.equal(JSON.stringify(result).includes(forbidden), false)
 })
})

test('405 HTML和200非JSON均返回结构化错误，不抛出原始响应', async () => {
 for (const status of [405, 200]) {
  const mock = setup([{ ok: status === 200, status, async json() { throw new Error(`raw html ${KEY}`) } }])
  const result = await verifyDeepSeekApi({ apiKey: KEY, fetch: mock.fetch })
  assert.equal(result.ok, false); assert.equal(result.error.httpStatus, status)
  assert.equal(JSON.stringify(result).includes(KEY), false); assert.equal(result.actualRequests, 1)
 }
})

test('network错误不传播原始异常或凭据，固定官方目的地不跟随重定向', async () => {
 let calls = 0
 const result = await verifyDeepSeekApi({ apiKey: KEY, baseUrl: 'https://untrusted.invalid', fetch: async (url, options) => {
  calls++; assert.equal(url, 'https://api.deepseek.com/models'); assert.equal(options.redirect, 'error')
  throw new Error(`request headers Authorization Bearer ${KEY}`)
 } })
 assert.equal(calls, 1); assert.equal(result.error.code, 'NETWORK_ERROR'); assert.equal(result.actualRequests, 1)
 assert.equal(JSON.stringify(result).includes(KEY), false); assert.equal(JSON.stringify(result).includes('headers'), false)
})

test('单次超时立即停止，无重试；迟到响应不会触发文本生成', async () => {
 let resolve, signal, calls = 0
 const waiting = new Promise(done => { resolve = done })
 const result = await verifyDeepSeekApi({ apiKey: KEY, timeoutMs: 20, fetch: async (_url, options) => { calls++; signal = options.signal; return waiting } })
 assert.equal(result.ok, false); assert.equal(result.error.code, 'TIMEOUT'); assert.equal(signal.aborted, true)
 assert.equal(result.actualRequests, 1); assert.equal(result.generatedRequests, 0)
 resolve(response(models())); await tick(); assert.equal(calls, 1)
})

test('响应体读取也受超时约束，并保留已经收到的HTTP状态', async () => {
 const result = await verifyDeepSeekApi({ apiKey: KEY, timeoutMs: 20, fetch: async () => ({ ok: true, status: 200, json: () => new Promise(() => {}) }) })
 assert.equal(result.ok, false); assert.equal(result.error.code, 'TIMEOUT'); assert.equal(result.error.httpStatus, 200)
})

test('usage只保留服务端数值字段，不编造缺失统计或复制未知秘密字段', async () => {
 const reply = text(); reply.usage = { ...usage, unknown: KEY, prompt_tokens_details: { cached_tokens: 40, key: KEY }, completion_tokens_details: { reasoning_tokens: 5, content: 'PRIVATE_REASONING' } }
 const visual = vision(); delete visual.usage
 const mock = setup([response(models()), response(reply), response(visual)]), result = await verifyDeepSeekApi({ apiKey: KEY, fetch: mock.fetch })
 assert.equal(result.ok, true); assert.deepEqual(result.requests[1].usage, usage); assert.equal(result.requests[2].usage, null)
 assert.equal(JSON.stringify(result).includes(KEY), false)
})

test('未提供合法密钥或配置时无网络副作用', async () => {
 let calls = 0; const fetch = async () => { calls++; assert.fail('不应请求') }
 for (const options of [{}, { apiKey: '' }, { apiKey: 'bad\r\nkey' }, { apiKey: KEY, model: 'https://bad.invalid' }, { apiKey: KEY, timeoutMs: 0 }]) {
  const result = await verifyDeepSeekApi({ ...options, fetch })
  assert.equal(result.ok, false); assert.equal(result.actualRequests, 0); assert.equal(result.generatedRequests, 0)
 }
 assert.equal(calls, 0)
})
