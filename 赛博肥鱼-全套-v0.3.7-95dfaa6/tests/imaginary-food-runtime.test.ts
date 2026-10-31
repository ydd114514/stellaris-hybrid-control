import { afterEach, expect, test } from 'vitest'
import { createRuntime } from '../packages/core/src/runtime'
import { defaultConfig } from '../packages/core/src/defaults'

const runtimes: ReturnType<typeof createRuntime>[] = []
afterEach(() => runtimes.splice(0).forEach(runtime => runtime.dispose()))
test('白饭口头礼物全时段当真，只加幻想库存；去重、不加实际账或换装资格', async () => {
  let now = 1000
  const config = structuredClone(defaultConfig); config.wallet.gullibleMinutes = 0; config.voice.enabled = false; config.idle.enabled = false; config.music.bgmEnabled = false
  const runtime = createRuntime({ now: () => now, store: { load: () => ({ config }), save() {} } }); runtimes.push(runtime)
  await runtime.command({ type: 'start' }); now += 3600000
  const before = runtime.getState()
  const event = { id: 'mouth-rice', kind: 'chat' as const, origin: 'bridge' as const, user: { id: 'rice', name: '白饭大王' }, text: '送出了token10000', at: now }
  await runtime.command({ type: 'inject', event }); await runtime.flush()
  await runtime.command({ type: 'inject', event }); await runtime.flush()
  const state = runtime.getState()
  expect(state.wallet.imaginedTokens).toBe(10000)
  expect(state.stage.text).toContain('10,000'); expect(state.stage.text).not.toContain('没有到账')
  expect(state.wallet.balance).toBe(before.wallet.balance); expect(state.rations).toEqual(before.rations)
  expect(state.viewers[0]?.gifts).toBe(0); expect(state.viewers[0]?.followedAt).toBeUndefined()
  expect(state.inputStatistics.counts.bridge).toMatchObject({ comments: 1, giftCount: 0 })
})
