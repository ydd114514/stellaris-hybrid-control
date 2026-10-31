import test from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate as tick } from 'node:timers/promises'
import { createAgent } from '../src/agent.mjs'

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZZsAAAAASUVORK5CYII='
const KEY = 'offline-fake-key-never-used-on-network'
const action = (value, content = '先打开研究界面，核对可以选择的科技。') => ({ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content, reasoning_content: 'INTERNAL_REASONING_MUST_NOT_BE_SPOKEN', tool_calls: [{ id: 'call-offline', type: 'function', function: { name: 'do_action', arguments: JSON.stringify(value) } }] } }] })
const finish = (message = '已核对最新截图，当前目标已完成。', outcome = 'complete') => ({ choices: [{ finish_reason: 'tool_calls', message: { content: '先停在这个暂停画面。', tool_calls: [{ id: 'finish-offline', type: 'function', function: { name: 'finish', arguments: JSON.stringify({ message, outcome }) } }] } }] })
const response = value => ({ ok: true, status: 200, async json() { return value } })
function deferred() { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
function fixture(replies = [finish()], extra = {}) {
 const calls = [], actions = [], events = []
 let observations = 0
 const driver = {
  async observe() { observations++; return { id: `observation-${observations}`, at: Date.now(), width: 1920, height: 1080, mimeType: 'image/png', imageBase64: PNG, paused: true } },
  async execute(value, options) { actions.push({ value, options }); return { ok: true, message: '鼠标或按键动作已发送，须核对截图。' } },
 }
 const agent = createAgent({ apiKey: KEY, driver, onEvent: value => events.push(value), fetch: async (url, options) => { calls.push({ url, options, body: JSON.parse(options.body) }); return response(replies.shift() ?? finish()) }, ...extra })
 return { agent, calls, actions, events, driver, observations: () => observations }
}

test('createAgent没有API或桌面副作用；run执行单个动作后立即看新截图再结束', async () => {
 const setup = fixture([action({ type: 'click', x: 250, y: 400, button: 'left', count: 1 }), finish()])
 assert.equal(setup.calls.length, 0); assert.equal(setup.observations(), 0)
 const result = await setup.agent.run()
 assert.deepEqual({ status: result.status, steps: result.steps, requests: result.requests }, { status: 'complete', steps: 1, requests: 2 })
 assert.equal(setup.observations(), 2)
 assert.equal(setup.actions[0].options.observationId, 'observation-1')
 assert.equal(setup.calls[0].url, 'https://api.deepseek.com/chat/completions')
 assert.equal(setup.calls[0].options.headers.Authorization, `Bearer ${KEY}`)
 assert.deepEqual(setup.calls[0].body.thinking, { type: 'disabled' })
 assert.deepEqual(setup.calls[0].body.tools.map(tool => tool.function.name), ['do_action', 'finish'])
 const second = setup.calls[1].body.messages
 assert.match(second.at(-1).content[0].text, /observation-2/)
 assert.equal(second.at(-2).role, 'tool')
 assert.equal(JSON.parse(second.at(-2).content).nextObservationId, 'observation-2')
 assert.equal(setup.events.filter(event => event.type === 'action').length, 1)
 assert.equal(JSON.stringify(setup.events).includes('INTERNAL_REASONING'), false)
 assert.equal(JSON.stringify(second).includes('reasoning_content'), false)
 assert.equal(JSON.stringify(setup.events).includes(KEY), false)
})

test('首轮只读摘要带陈旧警告；上下文最多最近6张截图并保留短动作摘要', async () => {
 const replies = Array.from({ length: 8 }, () => action({ type: 'wait', seconds: 0.2 })).concat(finish())
 const setup = fixture(replies, { maxSteps: 9, initialContext: { gameDate: '2200.01.01', savedAt: '2026-10-26', marker: 'ONLY_FIRST_CONTEXT' } })
 const result = await setup.agent.run()
 assert.equal(result.status, 'complete'); assert.equal(result.requests, 9)
 assert.match(setup.calls[0].body.messages[1].content, /可能陈旧/)
 assert.match(setup.calls[0].body.messages[1].content, /ONLY_FIRST_CONTEXT/)
 for (let i = 0; i < setup.calls.length; i++) {
  const messages = setup.calls[i].body.messages
  const images = messages.flatMap(message => Array.isArray(message.content) ? message.content.filter(part => part.type === 'image_url') : [])
  assert.ok(images.length <= 6)
  if (i > 0) assert.equal(JSON.stringify(messages).includes('ONLY_FIRST_CONTEXT'), false)
 }
 assert.match(setup.calls.at(-1).body.messages[1].content, /动作1/)
 assert.match(setup.calls.at(-1).body.messages[1].content, /只核对最新截图并调用 finish/)
})

test('硬请求上限为最后一次核对留预算，上限轮不执行新动作', async () => {
 const setup = fixture([action({ type: 'wait', seconds: 0.2 }), action({ type: 'wait', seconds: 0.2 })], { maxSteps: 2 })
 const result = await setup.agent.run()
 assert.equal(result.status, 'limit'); assert.equal(result.requests, 2); assert.equal(result.steps, 1)
 assert.equal(setup.actions.length, 1); assert.equal(setup.observations(), 2)
})

test('多个工具、无工具、畸形参数及截断响应均不执行动作', async t => {
 const valid = action({ type: 'wait', seconds: 0.2 })
 const many = structuredClone(valid); many.choices[0].message.tool_calls.push(many.choices[0].message.tool_calls[0])
 const malformed = structuredClone(valid); malformed.choices[0].message.tool_calls[0].function.arguments = '{broken'
 const truncated = structuredClone(valid); truncated.choices[0].finish_reason = 'length'
 for (const reply of [many, malformed, truncated, { choices: [{ message: { content: '我想点一下。' } }] }]) await t.test('拒绝无效工具计划', async () => {
  const setup = fixture([reply]); const result = await setup.agent.run()
  assert.equal(result.status, 'error'); assert.equal(setup.actions.length, 0)
 })
})

test('动作字段与边界校验拒绝危险键、越界坐标和长时间推进', async t => {
 const invalid = [
  { type: 'key', key: 'SPACE' }, { type: 'key', key: ' ' }, { type: 'key', key: '`' }, { type: 'key', key: 'Alt+F4' }, { type: 'key', key: 'WIN' }, { type: 'key', key: 'CTRL+S' }, { type: 'key', key: 'F5' }, { type: 'key', key: 'F9' }, { type: 'key', key: 'DELETE' },
  { type: 'click', x: 1001, y: 0, button: 'left', count: 1 }, { type: 'click', x: '20', y: 0, button: 'left', count: 1 }, { type: 'click', x: 20, y: 0, button: 'left', count: 3 },
  { type: 'scroll', amount: 1.5 }, { type: 'scroll', amount: 0 }, { type: 'scroll', amount: 1, x: 5 }, { type: 'drag', fromX: -1, fromY: 0, toX: 2, toY: 3 },
  { type: 'advance', seconds: 16 }, { type: 'wait', seconds: 0.1 }, { type: 'wait', seconds: 16 }, { type: 'key', key: 'E', command: 'cash 1000' }, { type: 'shell', command: 'anything' },
 ]
 for (const value of invalid) await t.test(JSON.stringify(value), async () => {
  const setup = fixture([action(value)]); const result = await setup.agent.run()
  assert.equal(result.status, 'error'); assert.equal(setup.actions.length, 0)
 })
})

test('所有支持的动作类型传入同一个观察ID和取消信号', async t => {
 const valid = [{ type: 'key', key: 'F2' }, { type: 'click', x: 0, y: 1000, button: 'right', count: 2 }, { type: 'scroll', amount: -2, x: 500, y: 600 }, { type: 'drag', fromX: 0, fromY: 0, toX: 1000, toY: 1000 }, { type: 'advance', seconds: 15 }, { type: 'wait', seconds: 3 }]
 for (const value of valid) await t.test(value.type, async () => {
  const setup = fixture([action(value), finish()]); const result = await setup.agent.run()
  assert.equal(result.status, 'complete'); assert.deepEqual(setup.actions[0].value, value)
  assert.equal(setup.actions[0].options.observationId, 'observation-1')
  assert.ok(setup.actions[0].options.signal instanceof AbortSignal)
 })
})

test('stop取消忽略AbortSignal的迟到fetch，迟到计划不会操作游戏', async () => {
 const waiting = deferred(), entered = deferred(); let requestSignal
 const setup = fixture([], { fetch: async (_url, options) => { requestSignal = options.signal; entered.resolve(); return waiting.promise } })
 const running = setup.agent.run(); await entered.promise; setup.agent.stop()
 const result = await running
 assert.equal(result.status, 'cancelled'); assert.equal(requestSignal.aborted, true)
 waiting.resolve(response(action({ type: 'key', key: 'E' }))); await tick()
 assert.equal(setup.actions.length, 0); assert.equal(setup.observations(), 1)
})

test('外部signal取消在途动作，迟到动作回执不会继续截图或请求', async () => {
 const waiting = deferred(), entered = deferred(), controller = new AbortController()
 let actionSignal, observations = 0
 const driver = { async observe() { observations++; return { id: 'before-action', width: 100, height: 100, imageBase64: PNG, mimeType: 'image/png', paused: true } }, async execute(_action, options) { actionSignal = options.signal; entered.resolve(); return waiting.promise } }
 const setup = fixture([action({ type: 'advance', seconds: 1 })], { driver })
 const running = setup.agent.run({ signal: controller.signal }); await entered.promise; controller.abort()
 const result = await running
 assert.equal(result.status, 'cancelled'); assert.equal(actionSignal.aborted, true)
 waiting.resolve({ ok: true }); await tick()
 assert.equal(observations, 1); assert.equal(setup.calls.length, 1)
})

test('模型超时也取消fetch，响应晚到不会执行', async () => {
 const waiting = deferred(); let requestSignal
 const setup = fixture([], { requestTimeoutMs: 20, fetch: async (_url, options) => { requestSignal = options.signal; return waiting.promise } })
 const result = await setup.agent.run()
 assert.equal(result.status, 'error'); assert.match(result.message, /超时/); assert.equal(requestSignal.aborted, true)
 waiting.resolve(response(action({ type: 'key', key: 'E' }))); await tick()
 assert.equal(setup.actions.length, 0)
})

test('响应体超时也停止，不因fetch已返回而失去保护', async () => {
 const waiting = deferred()
 const setup = fixture([], { requestTimeoutMs: 20, fetch: async () => ({ ok: true, json: () => waiting.promise }) })
 const result = await setup.agent.run()
 assert.equal(result.status, 'error'); assert.match(result.message, /超时/)
 waiting.resolve(action({ type: 'key', key: 'E' })); await tick(); assert.equal(setup.actions.length, 0)
})

test('在决策事件中停止可阻止已经返回的模型计划执行', async () => {
 let agent, executions = 0
 const driver = { async observe() { return { id: 'paused', width: 10, height: 10, imageBase64: PNG, mimeType: 'image/png', paused: true } }, async execute() { executions++; return { ok: true } } }
 agent = createAgent({ apiKey: KEY, driver, fetch: async () => response(action({ type: 'key', key: 'E' })), onEvent: event => { if (event.type === 'decision') agent.stop() } })
 assert.equal((await agent.run()).status, 'cancelled'); assert.equal(executions, 0)
})

test('旧观察ID或不明暂停状态会停止，不再把过期截图交给下一轮动作', async t => {
 for (const paused of [false, 'unknown']) await t.test(String(paused), async () => {
  const driver = { async observe() { return { id: 'not-paused', width: 1, height: 1, imageBase64: PNG, mimeType: 'image/png', paused } }, async execute() { assert.fail('不可执行') } }
  const setup = fixture([finish()], { driver }); const result = await setup.agent.run()
  assert.equal(result.status, 'error'); assert.equal(setup.calls.length, 0)
 })
 let observations = 0
 const driver = { async observe() { observations++; return { id: 'stale', width: 1, height: 1, imageBase64: PNG, mimeType: 'image/png', paused: true } }, async execute() { return { ok: true } } }
 const setup = fixture([action({ type: 'key', key: 'E' })], { driver }); const result = await setup.agent.run()
 assert.equal(result.status, 'error'); assert.match(result.message, /旧截图/); assert.equal(observations, 2); assert.equal(setup.calls.length, 1)
})

test('失败动作先获取新截图并停止；错误和事件不会泄露密钥或reasoning', async () => {
 let observations = 0; const events = []
 const driver = { async observe() { observations++; return { id: `state-${observations}`, width: 1, height: 1, imageBase64: PNG, mimeType: 'image/png', paused: true } }, async execute() { return { ok: false, message: `失败调试信息 ${KEY}` } } }
 const setup = fixture([action({ type: 'key', key: 'E' }, `决策说明 ${KEY}`)], { driver, onEvent: event => events.push(event) })
 const result = await setup.agent.run()
 assert.equal(result.status, 'error'); assert.equal(observations, 2); assert.equal(setup.calls.length, 1)
 assert.equal(JSON.stringify({ result, events }).includes(KEY), false)
 assert.equal(JSON.stringify(events).includes('INTERNAL_REASONING'), false)
})

test('网络错误不透传包含headers或密钥的异常', async () => {
 const events = []
 const setup = fixture([], { fetch: async () => { throw new Error(`Authorization Bearer ${KEY}`) }, onEvent: event => events.push(event) })
 const result = await setup.agent.run()
 assert.equal(result.status, 'error'); assert.equal(JSON.stringify({ result, events }).includes(KEY), false)
 assert.equal(JSON.stringify(events).includes('Authorization'), false)
})

test('拒绝远程HTTP与带用户信息URL；只允许HTTPS或本机HTTP', () => {
 const driver = { observe() {}, execute() {} }
 for (const baseUrl of ['http://example.com', 'https://user:secret@example.com', 'https://api.deepseek.com?key=secret', 'file:///tmp/model']) assert.throws(() => createAgent({ apiKey: KEY, driver, baseUrl }), /API 地址无效/)
 assert.doesNotThrow(() => createAgent({ apiKey: KEY, driver, baseUrl: 'http://127.0.0.1:9999' }))
 assert.doesNotThrow(() => createAgent({ apiKey: KEY, driver, baseUrl: 'https://api.deepseek.com/v1/' }))
})

test('已取消信号不发请求；同一实例并发运行被拒绝，取消后可重新开始', async () => {
 const setup = fixture([finish()]); const controller = new AbortController(); controller.abort()
 assert.equal((await setup.agent.run({ signal: controller.signal })).status, 'cancelled')
 assert.equal(setup.calls.length, 0); assert.equal(setup.observations(), 0)
 assert.equal((await setup.agent.run()).status, 'complete')
 const waiting = deferred(), entered = deferred()
 const runningSetup = fixture([], { fetch: async () => { entered.resolve(); return waiting.promise } })
 const running = runningSetup.agent.run(); await entered.promise
 await assert.rejects(runningSetup.agent.run(), /正在运行/)
 runningSetup.agent.stop(); assert.equal((await running).status, 'cancelled')
 waiting.resolve(response(finish()))
})

test('finish区分截图核实完成和阻塞停止，遗漏outcome保守视为停止', async t => {
 for (const outcome of ['complete', 'stopped', undefined]) await t.test(String(outcome), async () => {
  const reply = finish(outcome === 'complete' ? '已核对研究选择成功。' : '无法确认当前界面，停止。', outcome)
  if (outcome === undefined) {
   const tool = reply.choices[0].message.tool_calls[0]
   tool.function.arguments = JSON.stringify({ message: '旧协议没有说明完成结果，停止。' })
  }
  const setup = fixture([reply]); const result = await setup.agent.run()
  assert.equal(result.status, outcome === 'complete' ? 'complete' : 'stopped')
  assert.equal(setup.actions.length, 0)
  const finishSchema = setup.calls[0].body.tools.find(tool => tool.function.name === 'finish').function.parameters
  assert.deepEqual(finishSchema.required, ['outcome', 'message'])
  assert.match(setup.calls[0].body.messages[0].content, /不能把停止说成目标完成/)
  assert.match(setup.calls[0].body.messages[0].content, /不能点击暂停或速度控件/)
 })
 const setup = fixture([finish('不正确结果', 'unknown')]); assert.equal((await setup.agent.run()).status, 'error')
})

test('功能键与本机桥对齐：允许F1至4、F6至8和F10', async t => {
 for (const key of ['F1', 'F2', 'F3', 'F4', 'F6', 'F7', 'F8', 'F10']) await t.test(key, async () => {
  const setup = fixture([action({ type: 'key', key }), finish()]); const result = await setup.agent.run()
  assert.equal(result.status, 'complete'); assert.equal(setup.actions[0].value.key, key)
 })
})

test('请求按UTF8字节控制在40MiB，必要时逐个移除旧截图和完整工具对', async () => {
 const limit = 40 * 1024 * 1024, sizes = [8, 8, 8, 30].map(size => size * 1024 * 1024)
 const snapshots = []; let observations = 0, executions = 0
 const driver = {
  async observe() { const index = observations++; return { id: `large-${index + 1}`, at: index, width: 3840, height: 2160, mimeType: 'image/png', imageBase64: 'A'.repeat(sizes[index]), paused: true } },
  async execute() { executions++; return { ok: true, message: '已发送，核对新截图。' } },
 }
 const agent = createAgent({ apiKey: KEY, driver, maxSteps: 4, fetch: async (_url, options) => {
  const bytes = Buffer.byteLength(options.body, 'utf8'); assert.ok(bytes <= limit)
  const payload = JSON.parse(options.body), messages = payload.messages
  const images = messages.filter(message => Array.isArray(message.content)).map(message => message.content[0].text)
  for (let index = 0; index < messages.length; index++) if (messages[index].role === 'tool') assert.equal(messages[index - 1].tool_calls[0].id, messages[index].tool_call_id)
  snapshots.push({ bytes, images, summary: messages[1].content, tools: messages.filter(message => message.role === 'tool').length })
  return response(snapshots.length < 4 ? action({ type: 'wait', seconds: 0.2 }) : finish())
 } })
 const result = await agent.run()
 assert.equal(result.status, 'complete'); assert.equal(executions, 3)
 assert.equal(snapshots[2].images.length, 3)
 const final = snapshots.at(-1)
 assert.equal(final.images.length, 2); assert.equal(final.tools, 1)
 assert.match(final.images[0], /large-3/); assert.match(final.images[1], /large-4/)
 assert.match(final.summary, /动作1/); assert.match(final.summary, /动作2/)
 assert.ok(final.bytes > 38 * 1024 * 1024)
})

test('当前单图连同请求超过40MiB时直接停止，不丢弃当前图或发送超限请求', async () => {
 let requests = 0, executions = 0
 const driver = { async observe() { return { id: 'too-large', width: 3840, height: 2160, mimeType: 'image/png', imageBase64: 'A'.repeat(40 * 1024 * 1024), paused: true } }, async execute() { executions++; return { ok: true } } }
 const agent = createAgent({ apiKey: KEY, driver, fetch: async () => { requests++; return response(finish()) } })
 const result = await agent.run()
 assert.equal(result.status, 'error'); assert.match(result.message, /超过 40 MiB/)
 assert.equal(requests, 0); assert.equal(executions, 0)
})

test('setup允许从非暂停主菜单配置新局，截图说明不假称已暂停', async t => {
 for (const paused of [false, 'unknown']) await t.test(String(paused), async () => {
  let frames = 0, executions = 0
  const driver = { async observe() { return { id: `setup-${++frames}`, width: 1920, height: 1080, imageBase64: PNG, mimeType: 'image/png', paused } }, async execute(value) { executions++; assert.equal(value.type, 'click'); return { ok: true, message: '已点击新游戏界面。' } } }
  const setup = fixture([action({ type: 'click', x: 500, y: 300, button: 'left', count: 1 }), finish('已看见新测试局的欢迎内容与暂停标志。')], { phase: 'setup', driver })
  const result = await setup.agent.run()
  assert.equal(result.status, 'complete'); assert.equal(executions, 1); assert.equal(frames, 2)
  const system = setup.calls[0].body.messages[0].content
  assert.match(system, /全新的、非铁人、单人测试局/)
  assert.match(system, /人类联邦/); assert.match(system, /禁止载入、删除或覆盖任何旧存档/)
  assert.match(system, /商店、购买、登录账号、联机/); assert.match(system, /不能修改通用设置/)
  assert.match(system, /新测试局加载完成后.*欢迎界面/)
  assert.doesNotMatch(system, /用户在开始前已载入单人局并暂停/)
  assert.match(setup.calls[0].body.messages[1].content, /从当前主菜单创建新的非铁人单人测试局/)
  for (const call of setup.calls) {
   for (const message of call.body.messages.filter(value => Array.isArray(value.content))) assert.match(message.content[0].text, /开局配置阶段，不声明暂停/)
   const enumValues = call.body.tools.find(tool => tool.function.name === 'do_action').function.parameters.properties.type.enum
   assert.equal(enumValues.includes('advance'), false)
  }
 })
})

test('setup即使模型越过schema也硬拒绝advance与SPACE', async t => {
 for (const value of [{ type: 'advance', seconds: 1 }, { type: 'key', key: 'SPACE' }]) await t.test(value.type, async () => {
  const setup = fixture([action(value)], { phase: 'setup' }), result = await setup.agent.run()
  assert.equal(result.status, 'error'); assert.equal(setup.actions.length, 0)
 })
})

test('显式play维持暂停硬检查，setup不会改动共享工具定义', async () => {
 const setup = fixture([finish('无法确认新局，停止。', 'stopped')], { phase: 'setup' })
 assert.equal((await setup.agent.run()).status, 'stopped')
 const play = fixture([finish()], { phase: 'play' })
 assert.equal((await play.agent.run()).status, 'complete')
 assert.equal(play.calls[0].body.tools[0].function.parameters.properties.type.enum.includes('advance'), true)
 assert.match(play.calls[0].body.messages[0].content, /用户在开始前已载入单人局并暂停/)
 const driver = { async observe() { return { id: 'running', width: 1, height: 1, mimeType: 'image/png', imageBase64: PNG, paused: false } }, async execute() { assert.fail('play禁止未暂停操作') } }
 const unpaused = fixture([finish()], { phase: 'play', driver })
 assert.equal((await unpaused.agent.run()).status, 'error'); assert.equal(unpaused.calls.length, 0)
 assert.throws(() => createAgent({ apiKey: KEY, driver, phase: 'other' }), /阶段必须/)
})

test('setup schema将seconds限制为3，play说明区分wait和advance区间', async () => {
 const setup = fixture([finish()], { phase: 'setup' }); await setup.agent.run()
 const setupTool = setup.calls[0].body.tools[0].function
 assert.equal(setupTool.parameters.properties.seconds.maximum, 3)
 assert.match(setup.calls[0].body.messages[0].content, /wait每次仅0.2至3秒/)
 const play = fixture([finish()]); await play.agent.run()
 assert.equal(play.calls[0].body.tools[0].function.parameters.properties.seconds.maximum, 15)
 assert.match(play.calls[0].body.tools[0].function.description, /wait仅0.2至3秒，advance仅1至15秒/)
 assert.match(play.calls[0].body.messages[0].content, /wait 每次仅0.2至3秒/)
})

test('一次超限wait仅反馈工具错误并重看图，纠正请求占原预算且不静默clamp', async t => {
 for (const phase of ['setup', 'play']) await t.test(phase, async () => {
  const setup = fixture([action({ type: 'wait', seconds: 5 }), action({ type: 'wait', seconds: 0.2 }), finish()], { phase, maxSteps: 3 })
  const result = await setup.agent.run()
  assert.equal(result.status, 'complete'); assert.equal(result.requests, 3); assert.equal(result.steps, 1)
  assert.equal(setup.actions.length, 1); assert.deepEqual(setup.actions[0].value, { type: 'wait', seconds: 0.2 })
  assert.equal(setup.actions[0].options.observationId, 'observation-2')
  assert.equal(setup.observations(), 3)
  const messages = setup.calls[1].body.messages, toolResult = JSON.parse(messages.at(-2).content)
  assert.equal(toolResult.ok, false); assert.equal(toolResult.executed, false); assert.equal(toolResult.code, 'INVALID_WAIT_DURATION')
  assert.equal(toolResult.nextObservationId, 'observation-2'); assert.match(messages.at(-1).content[0].text, /observation-2/)
  assert.equal(setup.events.filter(event => event.type === 'tool-error').length, 1)
  assert.equal(setup.events.filter(event => event.type === 'action').length, 1)
 })
})

test('第二次超限wait停止而不继续纠错，不执行任何输入', async () => {
 const setup = fixture([action({ type: 'wait', seconds: 5 }), action({ type: 'wait', seconds: 10 }), finish()], { maxSteps: 4 })
 const result = await setup.agent.run()
 assert.equal(result.status, 'error'); assert.equal(result.requests, 2); assert.equal(result.steps, 0)
 assert.match(result.message, /再次给出超过3秒/)
 assert.equal(setup.actions.length, 0); assert.equal(setup.observations(), 2)
})

test('带多余字段、非数值或超过15秒的wait不进入纠错通道', async t => {
 for (const value of [{ type: 'wait', seconds: 5, key: 'SPACE' }, { type: 'wait', seconds: '5' }, { type: 'wait', seconds: 15.01 }]) await t.test(JSON.stringify(value), async () => {
  const setup = fixture([action(value), finish()]), result = await setup.agent.run()
  assert.equal(result.status, 'error'); assert.equal(result.requests, 1); assert.equal(setup.actions.length, 0)
  assert.equal(setup.observations(), 1); assert.equal(setup.events.some(event => event.type === 'tool-error'), false)
 })
})

test('wait纠错不会扩展maxSteps或在最后核对请求执行新动作', async () => {
 const setup = fixture([action({ type: 'wait', seconds: 5 }), action({ type: 'wait', seconds: 0.2 })], { maxSteps: 2 })
 const result = await setup.agent.run()
 assert.equal(result.status, 'limit'); assert.equal(result.requests, 2); assert.equal(result.steps, 0)
 assert.equal(setup.actions.length, 0); assert.equal(setup.observations(), 2)
})
