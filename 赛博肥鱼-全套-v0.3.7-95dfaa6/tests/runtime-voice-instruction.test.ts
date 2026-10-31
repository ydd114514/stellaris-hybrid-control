import { afterEach, expect, test, vi } from 'vitest'
import { createRuntime } from '../packages/core/src/runtime'
import { defaultConfig } from '../packages/core/src/defaults'
import type { AppConfig } from '../packages/shared/src'

const runtimes: ReturnType<typeof createRuntime>[] = []
afterEach(() => runtimes.splice(0).forEach(runtime => runtime.dispose()))

function setup(instruction: string, style = '带一点得意地接梗。') {
  const config = structuredClone(defaultConfig)
  config.demo = false; config.mode = 'supervised'
  config.voice.enabled = true; config.voice.provider = 'qwen'; config.voice.instruction = instruction
  config.idle.enabled = false; config.music.enabled = false; config.music.bgmEnabled = false
  const synthesize = vi.fn(async (_text: string, _config: AppConfig['voice']) => ({ audio: { kind: 'pcm' as const, data: 'AAA=', sampleRate: 24000 } }))
  const fetch = vi.fn(async () => Response.json({ choices: [{ message: { content: JSON.stringify({ say: ['这个主意不错，我先记下了。'], face: 'neutral', action: 'listen', voice_style: style }) } }], usage: { prompt_tokens: 2, completion_tokens: 2 } }))
  const runtime = createRuntime({ fetch, credentials: { get: () => 'offline-voice-guidance-key', set() {}, encrypted: true }, voice: { synthesize }, store: { load: () => ({ config }), save() {} } })
  runtimes.push(runtime)
  return { runtime, synthesize, fetch }
}

test.each([
  ['活泼嘴贫，像聊天而不是播报。', '活泼嘴贫，像聊天而不是播报。\n带一点得意地接梗。'],
  ['', '带一点得意地接梗。'],
])('实际回复配音保留稳定指导与本句情绪：%s', async (instruction, expected) => {
  const { runtime, synthesize } = setup(instruction)
  await runtime.command({ type: 'start' })
  await runtime.command({ type: 'inject', event: { id: 'voice-guidance', kind: 'chat', user: { id: 'guest', name: '小叶' }, text: '这个主意你觉得怎么样？', at: Date.now() } })
  await runtime.flush()
  expect(synthesize).toHaveBeenCalledTimes(1)
  expect(synthesize.mock.calls[0]![1].instruction).toBe(expected)
  expect(synthesize.mock.calls[0]![0]).toBe(runtime.getState().stage.text)
})

test.each(['稳定的自然聊天声线。', ''])('直接试听没有本句情绪时不添加多余指导：%s', async instruction => {
  const { runtime, synthesize, fetch } = setup(instruction)
  const result = await runtime.command({ type: 'voice-preview', text: '欸，这个主意不错。' })
  expect(result.ok).toBe(true)
  expect(fetch).not.toHaveBeenCalled()
  expect(synthesize).toHaveBeenCalledTimes(1)
  expect(synthesize.mock.calls[0]![1].instruction).toBe(instruction)
})
