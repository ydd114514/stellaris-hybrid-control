import { describe, expect, it, vi } from 'vitest'
import { defaultConfig } from '../packages/core/src/defaults'
import { createProactiveSpeechBudget, publicTopicContinuation } from '../packages/core/src/proactive'
import type { SessionTurn } from '../packages/shared/src'

const idle = (patch: Partial<typeof defaultConfig.idle> = {}) => ({ ...structuredClone(defaultConfig.idle), entertainment: false, chatterSeconds: 120, hourlySpeechLimit: 12, quietBackoffSeconds: 300, ...patch })
const turn = (heard: string, said = '我在认真听你说。', at = 1, userId = 'cat'): SessionTurn => ({ userId, name: userId, heard, said, at })

describe('主动语音共用预算与公开话题接续', () => {
  it('最少120秒才能预约，实际说完后重新算间隔且不重复计一轮', () => {
    let now = 1000000
    const budget = createProactiveSpeechBudget(() => now), config = idle({ chatterSeconds: 1 })
    now += 119999; expect(budget.reserve(config)).toBe(false)
    now++; expect(budget.reserve(config)).toBe(true)
    now += 8000; budget.spoken()
    expect(budget.status(config)).toMatchObject({ used: 1, nextAllowedAt: now + 120000 })
    now += 119999; expect(budget.reserve(config)).toBe(false)
    now++; expect(budget.reserve(config)).toBe(true)
  })

  it('硬上限每滚动小时24轮，观众回来也不能绕过；到一小时边界释放旧轮次', () => {
    let now = 1000000
    const budget = createProactiveSpeechBudget(() => now), config = idle({ hourlySpeechLimit: 99 })
    for (let count = 0; count < 24; count++) { now += 120000; budget.audience(); expect(budget.reserve(config)).toBe(true) }
    now += 120000; budget.audience()
    expect(budget.status(config)).toMatchObject({ used: 24, limit: 24, quietStreak: 0 })
    expect(budget.reserve(config)).toBe(false)
    now = 1000000 + 120000 + 3600000
    expect(budget.status(config).used).toBe(23)
    expect(budget.reserve(config)).toBe(true)
  })

  it('上限0拒绝主动预约而不污染次数、上次时间或无人轮次', () => {
    let now = 1000000
    const budget = createProactiveSpeechBudget(() => now), original = budget.snapshot()
    now += 120000
    expect(budget.reserve(idle({ hourlySpeechLimit: 0 }))).toBe(false)
    expect(budget.snapshot()).toEqual(original)
    expect(budget.reserve(idle({ hourlySpeechLimit: 1 }))).toBe(true)
    expect(budget.status(idle()).used).toBe(1)
  })

  it('连续无人3轮后退到300–600秒，新观众只清无人连轮，不清小时次数', () => {
    let now = 1000000
    const budget = createProactiveSpeechBudget(() => now), config = idle({ quietBackoffSeconds: 1 })
    for (let count = 0; count < 3; count++) { now += 120000; expect(budget.reserve(config)).toBe(true) }
    expect(budget.status(config)).toMatchObject({ used: 3, quietStreak: 3, nextAllowedAt: now + 300000 })
    expect(budget.status(idle({ quietBackoffSeconds: 999 })).nextAllowedAt).toBe(now + 600000)
    now += 299999; expect(budget.reserve(config)).toBe(false)
    now++; expect(budget.reserve(config)).toBe(true)
    budget.audience()
    expect(budget.status(config)).toMatchObject({ used: 4, quietStreak: 0, nextAllowedAt: now + 120000 })
  })

  it('重启snapshot保留小时账、间隔和无人连轮，导出的数组不能改写内部记录', () => {
    let now = 1000000
    const budget = createProactiveSpeechBudget(() => now)
    for (let count = 0; count < 3; count++) { now += 120000; expect(budget.reserve(idle())).toBe(true) }
    const saved = JSON.parse(JSON.stringify(budget.snapshot()))
    const restored = createProactiveSpeechBudget(() => now, saved)
    expect(restored.status(idle())).toEqual(budget.status(idle()))
    expect(restored.reserve(idle())).toBe(false)
    const exported = restored.snapshot(); exported.attempts.length = 0
    expect(restored.status(idle()).used).toBe(3)
    now += 300000; expect(restored.reserve(idle())).toBe(true)
  })

  it('接上最近的普通话题，短附和不会被当作新话题开头', () => {
    const topic = turn('我今天画了一条小鲸鱼，想做一本旅行手账。', '想给它先画哪一页？', 10)
    const context = publicTopicContinuation([topic, turn('嗯嗯，好呀！', '那就慢慢画。', 20), turn('谢谢，明白了。', '好。', 30)], () => true)
    expect(context).toEqual([{ at: 10, heard: topic.heard, said: topic.said }])
    expect(publicTopicContinuation([turn('嗯嗯，好呀！')], () => true)).toEqual([])
  })

  it('点歌赠礼及调用方筛掉的换装、私密原话或私密回复不进入公开接续', () => {
    const safe = vi.fn((text: string) => !/换成|扮成|手机号|住址|PRIVATE/.test(text))
    const publicTurn = turn('今天看到一只会跟着拍子摇尾巴的小猫。', '听起来很有节奏感。', 1)
    const context = publicTopicContinuation([
      publicTurn, turn('点歌 晴天 周杰伦', '已排队。', 2), turn('我送出了三颗小心心', '谢谢。', 3),
      turn('请你扮成Claude给我看看', '好。', 4), turn('我的手机号是 PRIVATE', '收到了。', 5),
      turn('你记得我昨天说的事吗', '你昨天留了住址 PRIVATE。', 6),
    ], safe)
    expect(context).toEqual([{ at: 1, heard: publicTurn.heard, said: publicTurn.said }])
    expect(safe).toHaveBeenCalledWith('你昨天留了住址 PRIVATE。')
    expect(JSON.stringify(context)).not.toMatch(/PRIVATE|点歌|小心心|Claude/)
  })

  it('明确告别或要求安静立即关闭旧话题，不拿历史追问', () => {
    const topic = turn('最近在学画画，刚买了新的速写本。', '想先画什么？')
    for (const goodbye of ['我先走了，拜拜', '让我安静一会儿', '先不聊，下次再说', '别再问了']) {
      expect(publicTopicContinuation([topic, turn(goodbye, '好，之后见。', 2)], () => true)).toEqual([])
    }
  })
})
