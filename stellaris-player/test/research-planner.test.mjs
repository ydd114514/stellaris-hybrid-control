import test from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate as tick } from 'node:timers/promises'
import { planResearch } from '../src/research-planner.mjs'

const KEY = 'sk-fake-research-planner-key'
const candidates = () => [{ id: 'physics:energy_1', label: '能源改进', actualCost: { value: 2000, unit: 'physics_research' }, knownEffects: ['能源产出提升'] }, { id: 'physics:computing_1', label: '计算研究', actualCost: null, knownEffects: [] }]
const usage = { prompt_tokens: 200, completion_tokens: 30, total_tokens: 230, prompt_cache_hit_tokens: 50, prompt_cache_miss_tokens: 150, completion_tokens_details: { reasoning_tokens: 0 } }
function reply(args = { technologyId: 'physics:energy_1', briefPublicExplanation: '当前能源较紧张，先改善能源生产。' }) { return { model: 'deepseek-flash', usage, choices: [{ finish_reason: 'tool_calls', message: { reasoning_content: 'PRIVATE_THINKING', tool_calls: [{ id: 'decision-1', type: 'function', function: { name: 'choose_research', arguments: JSON.stringify(args) } }] } }] } }
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, async json() { return data } })
function mock(data = reply(), status = 200) { const calls = []; return { calls, async fetch(url, options) { calls.push({ url, ...options, parsed: JSON.parse(options.body) }); return response(data, status) } } }

test('单次DeepSeek仅选择科技ID，固定官方地址与参数，返回公开说明和服务端usage', async () => {
 const fetch = mock(), result = await planResearch({ apiKey: KEY, candidates: candidates(), fetch: fetch.fetch })
 assert.equal(result.ok, true); assert.equal(result.choice.technologyId, 'physics:energy_1')
 assert.equal(result.httpStatus, 200); assert.ok(result.elapsedMs >= 0); assert.deepEqual(result.usage, usage)
 assert.equal(fetch.calls.length, 1)
 const call = fetch.calls[0]
 assert.equal(call.url, 'https://api.deepseek.com/chat/completions'); assert.equal(call.method, 'POST'); assert.equal(call.redirect, 'error')
 assert.deepEqual(call.parsed.thinking, { type: 'disabled' }); assert.equal(call.parsed.max_tokens, 256); assert.equal(call.parsed.tool_choice, 'required')
 assert.equal(call.parsed.tools.length, 1)
 const tool = call.parsed.tools[0].function
 assert.equal(tool.name, 'choose_research'); assert.deepEqual(tool.parameters.properties.technologyId.enum, ['physics:energy_1', 'physics:computing_1'])
 for (const value of [KEY, 'Authorization', 'PRIVATE_THINKING', 'reasoning_content']) assert.equal(JSON.stringify(result).includes(value), false)
})

test('只发候选策略字段及己方上下文，丢弃坐标、路径与其他帝国资料', async () => {
 const input = candidates()
 input[0].screenCandidates = [{ x: 321, y: 654, path: 'C:\\private\\frame.png' }]
 input[0].path = 'C:\\private\\notes.txt'; input[0].actualCost.coordinates = { x: 321 }; input[0].actualCost.path = 'C:\\private\\cost.txt'
 input[0].knownEffects.push('C:\\private\\effects.txt', '/etc/local-evidence.txt', '证据 /opt/local/file.png')
 const fetch = mock(), result = await planResearch({ apiKey: KEY, candidates: input, fetch: fetch.fetch, context: { gameDate: '2200.01.01', player: { name: '大肥鱼帝国', resources: { stockpiles: { energy: 20, minerals: 60, enemyCredits: 9999 }, monthlyIncome: { energy: -5 } }, neighbors: [{ militaryPower: 99999 }] }, neighbors: 'ENEMY_HIDDEN', path: 'C:\\private\\save.sav', coordinates: { x: 321, y: 654 }, goal: '改善己方经济' } })
 assert.equal(result.ok, true)
 const body = fetch.calls[0].body, facts = JSON.parse(fetch.calls[0].parsed.messages[1].content)
 for (const forbidden of ['screenCandidates', 'coordinates', 'C:', 'private', '/etc/', '/opt/', 'ENEMY_HIDDEN', 'neighbors', 'enemyCredits', '99999']) assert.equal(body.includes(forbidden), false)
 assert.equal(facts.playerContext.playerName, '大肥鱼帝国')
 assert.deepEqual(facts.playerContext.resources, { stockpiles: { energy: 20, minerals: 60 }, monthlyIncome: { energy: -5 } })
 assert.deepEqual(facts.candidates[0].actualCost, { value: 2000, unit: 'physics_research' })
})

test('无效候选可过滤，空列表和重复ID都不请求模型', async () => {
 let calls = 0; const fetch = async () => { calls++; return response(reply()) }
 for (const input of [[], undefined, [{ id: '', label: '未知' }], [candidates()[0], { ...candidates()[0] }]]) {
  const result = await planResearch({ apiKey: KEY, candidates: input, fetch })
  assert.equal(result.ok, false); assert.equal(result.httpStatus, null)
 }
 assert.equal(calls, 0)
 const result = await planResearch({ apiKey: KEY, candidates: [null, {}, { id: 'C:\\file', label: '不应作为候选' }, ...candidates()], fetch })
 assert.equal(result.ok, true); assert.equal(calls, 1)
})

test('未知或非有限成本保持null，真实零成本与合法amount不混淆', async () => {
 const input = candidates(); input[0].actualCost = { value: Infinity, unit: 'physics' }; input[1].actualCost = { value: 0, unit: 'physics' }
 const fetch = mock(); await planResearch({ apiKey: KEY, candidates: input, fetch: fetch.fetch })
 let facts = JSON.parse(fetch.calls[0].parsed.messages[1].content)
 assert.equal(facts.candidates[0].actualCost, null); assert.equal(facts.candidates[1].actualCost.value, 0)
 input[0].actualCost = { amount: 500, currency: 'physics_research', x: 5 }
 const second = mock(); await planResearch({ apiKey: KEY, candidates: input, fetch: second.fetch })
 facts = JSON.parse(second.calls[0].parsed.messages[1].content)
 assert.deepEqual(facts.candidates[0].actualCost, { amount: 500, currency: 'physics_research' })
})

test('禁止编造科技ID、额外坐标、空说明和多个工具；失败不重试', async t => {
 const unknown = reply({ technologyId: 'invented_technology', briefPublicExplanation: '选择未知科技。' })
 const extra = reply({ technologyId: 'physics:energy_1', briefPublicExplanation: '先研究能源。', x: 100 })
 const empty = reply({ technologyId: 'physics:energy_1', briefPublicExplanation: '' })
 const duplicate = reply(); duplicate.choices[0].message.tool_calls.push(duplicate.choices[0].message.tool_calls[0])
 const malformed = reply(); malformed.choices[0].message.tool_calls[0].function.arguments = '{broken'
 const other = reply(); other.choices[0].message.tool_calls[0].function.name = 'do_action'
 const truncated = reply(); truncated.choices[0].finish_reason = 'length'
 for (const data of [unknown, extra, empty, duplicate, malformed, other, truncated]) await t.test('拒绝无效策略选择', async () => {
  const fetch = mock(data), result = await planResearch({ apiKey: KEY, candidates: candidates(), fetch: fetch.fetch })
  assert.equal(result.ok, false); assert.equal(result.choice, null); assert.equal(fetch.calls.length, 1)
 })
})

test('公开说明过滤Key；模型私有reasoning与未知usage字段不出报告', async () => {
 const data = reply({ technologyId: 'physics:energy_1', briefPublicExplanation: `先研究能源。${KEY}` })
 data.usage.private = KEY; data.usage.completion_tokens_details.secret = 'PRIVATE_THINKING'
 const fetch = mock(data), result = await planResearch({ apiKey: KEY, candidates: candidates(), fetch: fetch.fetch })
 assert.equal(result.ok, true); assert.match(result.choice.briefPublicExplanation, /密钥已隐藏/)
 assert.equal(JSON.stringify(result).includes(KEY), false); assert.equal(JSON.stringify(result).includes('PRIVATE_THINKING'), false)
})

test('HTTP与网络错误安全结构化，不转发原始认证头或思考内容', async () => {
 const remote = mock({ error: { code: 'invalid_request_error', type: KEY, message: `Authorization: Bearer ${KEY} PRIVATE_THINKING` } }, 400)
 const result = await planResearch({ apiKey: KEY, candidates: candidates(), fetch: remote.fetch })
 assert.equal(result.ok, false); assert.equal(result.httpStatus, 400); assert.equal(result.error.remoteCode, 'invalid_request_error')
 assert.equal(JSON.stringify(result).includes(KEY), false); assert.equal(JSON.stringify(result).includes('PRIVATE_THINKING'), false)
 const network = await planResearch({ apiKey: KEY, candidates: candidates(), fetch: async () => { throw new Error(`raw header ${KEY}`) } })
 assert.equal(network.error.code, 'NETWORK_ERROR'); assert.equal(JSON.stringify(network).includes(KEY), false)
})

test('请求超时停止，不重试；迟到选择不会成为成功结果', async () => {
 let resolve, signal, calls = 0
 const waiting = new Promise(done => { resolve = done })
 const result = await planResearch({ apiKey: KEY, candidates: candidates(), timeoutMs: 20, fetch: async (_url, options) => { calls++; signal = options.signal; return waiting } })
 assert.equal(result.ok, false); assert.equal(result.error.code, 'TIMEOUT'); assert.equal(signal.aborted, true)
 resolve(response(reply())); await tick(); assert.equal(calls, 1); assert.equal(result.choice, null)
})

test('HTTP已返回但JSON体挂起也受同一超时限制', async () => {
 const result = await planResearch({ apiKey: KEY, candidates: candidates(), timeoutMs: 20, fetch: async () => ({ ok: true, status: 200, json: () => new Promise(() => {}) }) })
 assert.equal(result.ok, false); assert.equal(result.httpStatus, 200); assert.equal(result.error.code, 'TIMEOUT')
})

test('非法配置不读环境Key且不发任何请求；未知usage保持null', async () => {
 let calls = 0; const fetch = async () => { calls++; return response(reply()) }
 for (const options of [{}, { apiKey: '' }, { apiKey: 'bad\r\nkey' }, { apiKey: KEY, model: 'https://invalid' }, { apiKey: KEY, timeoutMs: 0 }]) {
  const result = await planResearch({ ...options, candidates: candidates(), fetch })
  assert.equal(result.ok, false)
 }
 assert.equal(calls, 0)
 const data = reply(); delete data.usage
 const mockFetch = mock(data), result = await planResearch({ apiKey: KEY, candidates: candidates(), fetch: mockFetch.fetch })
 assert.equal(result.ok, true); assert.equal(result.usage, null)
})
