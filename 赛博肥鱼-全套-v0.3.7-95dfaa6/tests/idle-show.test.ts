import { describe, expect, it } from 'vitest'
import { createIdleShow } from '../packages/core/src/idle-show'
import { createProactiveSpeechBudget } from '../packages/core/src/proactive'
import { defaultConfig, ACTIONS } from '../packages/core/src/defaults'
import { FACES } from '../packages/shared/src'
import { createRuntime } from '../packages/core/src/runtime'

describe('冷场节目有完整小冲突、衔接与轻巧邀聊', () => {
  it('五个节目各四段，所有动作表情来自现有清单，轮换前台词不重复', () => {
    const show = createIdleShow(), lines = new Set<string>(), titles = new Set<string>()
    for (let n = 0; n < 20; n++) {
      const plan = show.plan(); titles.add(plan.title); lines.add(plan.line)
      expect(plan.beat).toBe(n % 4)
      expect(ACTIONS.some(action => action.id === plan.action)).toBe(true)
      expect(FACES.some(face => face.id === plan.face)).toBe(true)
      expect(plan.line.length).toBeLessThanOrEqual(100)
      expect(plan.useModel).toBe(n % 2 === 0)
      if (n % 4 === 3) expect(plan.line).toMatch(/[？?]/)
      show.completed(plan)
    }
    expect(lines.size).toBe(20); expect(titles.size).toBe(5)
    expect(show.plan()).toMatchObject({ episode: 0, beat: 0 })
  })
  it('等到真实完成回执才推进，中断和旧回执不会跳过或重复推进', () => {
    const show = createIdleShow(), first = show.plan()
    expect(show.plan()).toEqual(first)
    show.completed({ ...first, beat: 3 }); expect(show.plan()).toEqual(first)
    show.completed(first); expect(show.plan().beat).toBe(1)
    show.completed(first); expect(show.plan().beat).toBe(1)
    expect(createIdleShow(show.snapshot()).plan()).toEqual(show.plan())
    expect(createIdleShow({ episode: -1, beat: Infinity }).plan()).toMatchObject({ episode: 0, beat: 0 })
  })
  it('默认额度均匀铺满小时，长时间无人也不逐步退成十分钟一句；配额与重启记录保留', () => {
    let now = 1000000
    const budget = createProactiveSpeechBudget(() => now), config = structuredClone(defaultConfig.idle)
    expect(budget.status(config)).toMatchObject({ limit: 24, nextAllowedAt: now + 150000 })
    for (let n = 0; n < 24; n++) { now += 150000; expect(budget.reserve(config)).toBe(true); expect(budget.status(config).nextAllowedAt).toBe(now + 150000) }
    expect(budget.status(config).used).toBe(24)
    const restored = createProactiveSpeechBudget(() => now, budget.snapshot())
    expect(restored.status(config)).toEqual(budget.status(config)); expect(restored.reserve(config)).toBe(false)
    now += 149999; expect(restored.reserve(config)).toBe(false)
    now++; expect(restored.reserve(config)).toBe(true)
  })
  it('只迁移旧默认冷场节奏，不覆盖店长自定义限额或关闭开关', () => {
    function load(limit: number, enabled = true) {
      const config = structuredClone(defaultConfig); const legacy = config.idle as Partial<typeof config.idle>
      delete legacy.entertainment; Object.assign(legacy, { enabled, chatterSeconds: 120, hourlySpeechLimit: limit, quietBackoffSeconds: 300 })
      const runtime = createRuntime({ store: { load: () => ({ config }), save() {} } })
      const result = runtime.getState().config.idle; runtime.dispose(); return result
    }
    expect(load(12)).toMatchObject({ hourlySpeechLimit: 24, quietBackoffSeconds: 120, entertainment: true })
    expect(load(0)).toMatchObject({ hourlySpeechLimit: 0, quietBackoffSeconds: 300 })
    expect(load(6)).toMatchObject({ hourlySpeechLimit: 6, quietBackoffSeconds: 300 })
    expect(load(12, false).enabled).toBe(false)
  })
})
