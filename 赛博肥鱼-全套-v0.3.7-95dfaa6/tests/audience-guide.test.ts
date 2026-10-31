import { afterEach, expect, test, vi } from 'vitest'
import { createRuntime } from '../packages/core/src/runtime'
import { createDefaultState } from '../packages/core/src/defaults'
import { audienceGuideContext, audienceGuideLines, audienceGuideTopic, audienceWarmupLines } from '../packages/core/src/audience-guide'

const runtimes: ReturnType<typeof createRuntime>[] = []
afterEach(() => { for (const runtime of runtimes.splice(0)) runtime.dispose(); vi.useRealTimers() })

test('只识别玩法问题，不吞普通点歌命令和闲聊', () => {
  for (const query of ['怎么点歌', '切歌规则是什么', '教教我听歌教程']) expect(audienceGuideTopic(query)).toBe('music')
  for (const query of ['怎么养你', 'token是什么', '口粮怎么补']) expect(audienceGuideTopic(query)).toBe('tokens')
  expect(audienceGuideTopic('灯牌有什么用')).toBe('follow')
  expect(audienceGuideTopic('怎么玩呀')).toBe('play')
  for (const query of ['点歌 稻香 周杰伦', '今天有什么好喝的', '讲个笑话', '切歌']) expect(audienceGuideTopic(query)).toBeUndefined()
})

test('说明随QQ开关和保护时长变化，未成年只教免费互动', () => {
  const state = createDefaultState()
  state.config.music.qqAutoSearch = false; state.config.music.minPlaySeconds = 70
  expect(audienceGuideLines(state, 'music').join('')).toContain('现有曲库')
  expect(audienceGuideLines(state, 'music').join('')).toContain('70秒')
  state.config.music.enabled = false
  expect(audienceGuideLines(state, 'music').join('')).toContain('关着')
  expect(audienceGuideLines(state, 'tokens', '我12岁怎么养你').join('')).toContain('礼物和灯牌先不用')
  expect(audienceGuideContext(state).点歌).toBe('点歌台已关闭。')
})

test('问怎么玩直接走可配音的预设回答，不调用DeepSeek，也不把已报token或灯牌权益编造出来', async () => {
  const fetch = vi.fn(), spoken: string[] = []
  const runtime = createRuntime({ fetch, credentials: { get: () => 'offline-key', set() {}, encrypted: true }, voice: { async synthesize(text, _config, _key, _signal, onRequest) { spoken.push(text); onRequest?.(); return { audio: { kind: 'pcm', data: '', sampleRate: 24000 }, usage: { inputTokens: 2, outputTokens: 3 }, characters: text.length, charactersReported: true } } } })
  runtimes.push(runtime)
  const config = runtime.getState().config
  await runtime.command({ type: 'set-config', config: { ...config, demo: false, voice: { ...config.voice, provider: 'qwen' }, idle: { ...config.idle, enabled: false } } })
  await runtime.command({ type: 'start' })
  await runtime.command({ type: 'inject', event: { id: 'how-to', origin: 'simulator', kind: 'chat', user: { id: 'learner', name: '新客人' }, text: '怎么点歌呀', at: Date.now() } })
  await runtime.flush()
  expect(fetch).not.toHaveBeenCalled()
  expect(spoken.join('')).toContain('点歌 歌名 歌手')
  expect(spoken.join('')).toContain('不多算')
  expect(runtime.getState().costs.voiceApiRequests).toBe(1)
  expect(runtime.getState().drafts.some(reply => reply.requiresReview)).toBe(false)
})

test('冷场介绍五分钟最多一次，人工确认时保持为草稿', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-26T04:00:00Z'))
  const runtime = createRuntime(); runtimes.push(runtime)
  const config = runtime.getState().config
  await runtime.command({ type: 'set-config', config: { ...config, mode: 'manual', voice: { ...config.voice, enabled: false }, idle: { ...config.idle, enabled: true, entertainment: false, aiChatter: false, seconds: 300 } } })
  await runtime.command({ type: 'start' })
  await runtime.command({ type: 'inject', event: { id: 'guest', kind: 'chat', user: { id: 'guest', name: '客人' }, text: '来坐坐', at: Date.now() } })
  await runtime.flush()
  await vi.advanceTimersByTimeAsync(301000)
  const count = () => runtime.getState().logs.filter(row => row.category === '互动介绍').length
  expect(count()).toBe(1)
  expect(runtime.getState().drafts.some(reply => reply.status === 'draft' && reply.say.join('').includes('精神'))).toBe(false)
  expect(runtime.getState().drafts.some(reply => reply.status === 'draft' && reply.say.join('').includes('点歌 歌名'))).toBe(true)
  await vi.advanceTimersByTimeAsync(30000)
  expect(count()).toBe(1)
})

test('没有人发言也能在暖场语音揽客，关闭点歌时不招呼点歌', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-26T04:00:00Z'))
  const runtime = createRuntime(); runtimes.push(runtime)
  const config = runtime.getState().config
  await runtime.command({ type: 'set-config', config: { ...config, mode: 'manual', voice: { ...config.voice, enabled: false }, idle: { ...config.idle, enabled: true, entertainment: false, aiChatter: false, seconds: 300 } } })
  await runtime.command({ type: 'start' })
  await vi.advanceTimersByTimeAsync(301000)
  expect(runtime.getState().drafts.some(reply => reply.say.join('').includes('路过的朋友'))).toBe(true)
  const state = createDefaultState(); state.config.music.enabled = false
  expect(audienceWarmupLines(state, 'play').join('')).not.toContain('点歌 歌名')
  expect(audienceWarmupLines(state, 'music').join('')).toContain('歇着')
})
