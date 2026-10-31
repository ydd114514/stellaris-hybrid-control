import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAgent } from '../src/agent.mjs'
import { createWindowsDriver } from '../src/driver.mjs'

const frame = { ok: true, width: 1920, height: 1080, imageBase64: 'iVBORw0KGgo=', mimeType: 'image/png', windowId: '101:44:77', window: { windowId: '101:44:77' } }
const finish = { id: 'finish-1', type: 'function', function: { name: 'finish', arguments: JSON.stringify({ outcome: 'complete', message: '已核对。' }) } }
const response = call => ({ ok: true, async json() { return { choices: [{ finish_reason: 'tool_calls', message: { content: '', tool_calls: [call] } }] } } })
test('every fresh game observation carries its own current-run mod data to DeepSeek', async () => {
  let contexts = 0; const requests = []
  const driver = createWindowsDriver({ assumePaused: true, invoke: async command => command.command === 'observe' ? frame : { ok: true }, observeContext: async () => ({ source: 'mod-log', gameDate: '2200.01.01', player: { name: '测试帝国', resources: { stockpiles: { energy: ++contexts * 10 } } } }) })
  const agent = createAgent({ apiKey: 'offline-test-key', driver, maxSteps: 3, fetch: async (_url, request) => {
    requests.push(JSON.parse(request.body))
    return response(requests.length === 1 ? { id: 'action-1', type: 'function', function: { name: 'do_action', arguments: JSON.stringify({ type: 'wait', seconds: 0.2 }) } } : finish)
  } })
  assert.equal((await agent.run()).status, 'complete')
  const lastObservation = requests.at(-1).messages.at(-1).content[0].text
  assert.match(lastObservation, /"energy":20/u)
  assert.match(lastObservation, /月度快照不代表上一步已成功/u)
  await driver.stop()
})
test('unavailable mod log leaves the screenshot loop usable with an explicit fallback', async () => {
  let text
  const driver = createWindowsDriver({ assumePaused: true, invoke: async () => frame, observeContext: async () => { throw new Error('log missing') } })
  const agent = createAgent({ apiKey: 'offline-test-key', driver, maxSteps: 2, fetch: async (_url, request) => { text = JSON.parse(request.body).messages.at(-1).content[0].text; return response(finish) } })
  assert.equal((await agent.run()).status, 'complete')
  assert.match(text, /暂未提供可核验摘要，以截图为准/u)
  await driver.stop()
})
