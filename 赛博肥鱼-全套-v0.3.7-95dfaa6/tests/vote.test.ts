import { afterEach, describe, expect, it } from 'vitest'
import { createRuntime, validateConfig } from '../packages/core/src/runtime'
import { defaultConfig } from '../packages/core/src/defaults'
import { PLAN_LIBRARY, parseSuggestion, parseVote, tally, winner } from '../packages/core/src/vote'
import type { LiveEvent, VoteRound } from '../packages/shared/src/index'

const runtimes: ReturnType<typeof createRuntime>[] = []
const runtime = () => { const rt = createRuntime({ store: { load: () => ({ config: { vote: { enabled: true } } }), save() {} } }); runtimes.push(rt); return rt }
let n = 0
const chat = (userId: string, text: string): LiveEvent => ({ id: `e-${++n}`, kind: 'chat', user: { id: userId, name: `客人${userId}` }, text, at: Date.now() })
const gift = (userId: string, count: number): LiveEvent => ({ id: `g-${++n}`, kind: 'gift', user: { id: userId, name: `客人${userId}` }, giftId: 'coffee', giftName: '热咖啡', count, at: Date.now() })
const options = PLAN_LIBRARY.slice(0, 3)
afterEach(() => { for (const rt of runtimes.splice(0)) rt.dispose() })

describe('明日投票', () => {
  it('识别投票和提议弹幕，不把普通聊天当成票', () => {
    expect(parseVote('投1', 3)).toBe(0)
    expect(parseVote('选 2号', 3)).toBe(1)
    expect(parseVote('支持三！', 3)).toBe(2)
    expect(parseVote('3', 3)).toBe(2)
    expect(parseVote('投4', 3)).toBeUndefined()
    expect(parseVote('我1点才下班', 3)).toBeUndefined()
    expect(parseSuggestion('提议 肥鱼讲鬼故事')).toBe('肥鱼讲鬼故事')
    expect(parseSuggestion('今天好累')).toBeUndefined()
  })

  it('人人一票，以最后一次为准，投票不进入 AI 回复队列', async () => {
    const rt = runtime()
    await rt.command({ type: 'start' })
    await rt.command({ type: 'vote-open', title: '明晚演什么？', options, minutes: 10 })
    await rt.command({ type: 'inject', event: chat('a', '投1') })
    await rt.command({ type: 'inject', event: chat('a', '投2') })
    await rt.command({ type: 'inject', event: chat('b', '投2') })
    const s = rt.getState()
    expect(s.vote.round!.ballots).toHaveLength(2)
    expect(s.vote.round!.ballots.find(b => b.userId === 'a')!.optionId).toBe(options[1]!.id)
    expect(s.queue).toHaveLength(0)
    expect(s.drafts).toHaveLength(0)
  })

  it('礼物只能助推：平方根递减、每人有上限，过半数不会被礼物翻盘', () => {
    const cfg = validateConfig({ vote: { headWeight: .6, boostCap: 100, minutes: 10, regularBonus: 0 } }).vote
    const round: VoteRound = { id: 'r', title: 't', status: 'open', options, spare: [], openedAt: 0, closesAt: 1, ballots: [
      ...['a', 'b', 'c', 'd'].map(u => ({ userId: u, name: u, optionId: options[0]!.id, boost: 0, bonus: 0, at: 0 })),
      { userId: 'whale', name: 'whale', optionId: options[1]!.id, boost: 1_000_000, bonus: 0, at: 0 },
    ] }
    const rows = tally(round, cfg)
    expect(rows[1]!.boost).toBe(10) // sqrt(min(1_000_000, cap 100))
    expect(rows[0]!.majority).toBe(true)
    expect(winner(round, cfg)).toBe(options[0]!.id)
  })

  it('票数接近时助推可以决定结果', () => {
    const cfg = defaultConfig.vote
    const round: VoteRound = { id: 'r', title: 't', status: 'open', options, spare: [], openedAt: 0, closesAt: 1, ballots: [
      { userId: 'a', name: 'a', optionId: options[0]!.id, boost: 0, bonus: 0, at: 0 },
      { userId: 'b', name: 'b', optionId: options[0]!.id, boost: 0, bonus: 0, at: 0 },
      { userId: 'c', name: 'c', optionId: options[1]!.id, boost: 25, bonus: 0, at: 0 },
      { userId: 'd', name: 'd', optionId: options[1]!.id, boost: 0, bonus: 0, at: 0 },
      { userId: 'e', name: 'e', optionId: options[2]!.id, boost: 0, bonus: 0, at: 0 },
    ] }
    expect(winner(round, cfg)).toBe(options[1]!.id)
  })

  it('投票前送的礼物先攒着，投票后计入；结束后生成计划，执行时切换场景', async () => {
    const rt = runtime()
    await rt.command({ type: 'start' })
    await rt.command({ type: 'vote-open', title: '明晚演什么？', options, minutes: 10 })
    await rt.command({ type: 'inject', event: gift('fan', 3) })
    expect(rt.getState().vote.round!.spare[0]!.boost).toBe(30)
    await rt.command({ type: 'inject', event: chat('fan', '投1') })
    await rt.command({ type: 'inject', event: chat('x', '投1') })
    expect(rt.getState().vote.round!.ballots.find(b => b.userId === 'fan')!.boost).toBe(30)
    const closed = await rt.command({ type: 'vote-close' })
    expect(closed.ok).toBe(true)
    const s = rt.getState()
    expect(s.vote.plans[0]!.option.id).toBe(options[0]!.id)
    await rt.flush()
    const said = [...rt.getState().drafts, ...rt.getState().history].map(r => r.say.join('')).join('|') + rt.getState().stage.text
    expect(said).toContain(`下次我们就「${options[0]!.title}」`)
    await rt.command({ type: 'plan-apply', id: s.vote.plans[0]!.id })
    expect(rt.getState().shop.scene).toBe(options[0]!.scene)
  })

  it('没有人投票时本轮作废，不生成计划', async () => {
    const rt = runtime()
    await rt.command({ type: 'vote-open', title: '', options, minutes: 10 })
    await rt.command({ type: 'vote-close' })
    expect(rt.getState().vote.plans).toHaveLength(0)
  })

  it('选项少于两个或含屏蔽词时拒绝开始', async () => {
    const rt = runtime()
    expect((await rt.command({ type: 'vote-open', title: '', options: options.slice(0, 1), minutes: 5 })).ok).toBe(false)
    expect((await rt.command({ type: 'vote-open', title: '', options: [options[0]!, { ...options[1]!, title: '刷礼物才理你' }], minutes: 5 })).ok).toBe(false)
  })

  it('配色和服装只接受形象包里存在的值', () => {
    expect(validateConfig({ look: { scheme: 'claude', outfit: 'cape' } }).look).toEqual({ scheme: 'claude', outfit: 'cape', timeOfDay: 'auto' })
    expect(validateConfig({ look: { scheme: 'nope', outfit: 'nope' } }).look).toEqual(defaultConfig.look)
  })
})
