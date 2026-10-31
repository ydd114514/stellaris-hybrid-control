import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultState, defaultConfig } from '../packages/core/src/defaults'
import { createRuntime, validateConfig } from '../packages/core/src/runtime'
import { PLAN_LIBRARY } from '../packages/core/src/vote'
import type { Command, LiveEvent } from '../packages/shared/src/index'

const runtimes: ReturnType<typeof createRuntime>[] = []
afterEach(() => { for (const runtime of runtimes.splice(0)) runtime.dispose(); vi.useRealTimers() })
const chat = (id: string, value: string, at = 100000): LiveEvent => ({ id, kind: 'chat', user: { id, name: id }, text: value, at })
function historical() {
  const state = createDefaultState(100000)
  state.config.music.bgmEnabled = false; state.config.voice.enabled = false; state.config.idle.enabled = false
  state.vote.round = { id: 'old-round', title: '历史投票', options: PLAN_LIBRARY.slice(0, 2), status: 'open', openedAt: 50000, closesAt: 101000, ballots: [{ userId: 'earlier', name: '老客人', optionId: PLAN_LIBRARY[0]!.id, at: 50000, boost: 0, bonus: 0 }], spare: [] }
  state.vote.plans = [{ id: 'old-plan', option: { ...PLAN_LIBRARY[0]!, title: '历史安排' }, applied: true, decidedAt: 50000, voters: 1, boosters: 0 }]
  state.vote.suggestions = [{ id: 'old-idea', userId: 'earlier', name: '老客人', text: '历史提议', at: 50000 }]
  return state
}

describe('首日投票与明日计划默认关闭', () => {
  it('新配置与旧配置缺失字段都关闭，只接受显式true开启', () => {
    expect(defaultConfig.vote.enabled).toBe(false)
    expect(validateConfig({}).vote.enabled).toBe(false)
    expect(validateConfig({ vote: { minutes: 10 } }).vote.enabled).toBe(false)
    expect(validateConfig({ vote: { enabled: 'true' } }).vote.enabled).toBe(false)
    expect(validateConfig({ vote: { enabled: true } }).vote.enabled).toBe(true)
  })

  it('关闭时历史轮次不收票、提议或助推，不自动结算，相关操作提示开启', async () => {
    vi.useFakeTimers()
    let now = 100000
    const saved = historical(), before = structuredClone(saved.vote)
    const runtime = createRuntime({ now: () => now, store: { load: () => saved, save() {} } }); runtimes.push(runtime)
    await runtime.command({ type: 'inject', event: chat('ballot', '投1') })
    await runtime.command({ type: 'inject', event: chat('idea', '提议 明天去海边') })
    await runtime.command({ type: 'inject', event: { id: 'gift', kind: 'gift', user: { id: 'fan', name: '客人' }, giftId: 'coffee', giftName: '热咖啡', count: 3, at: now } })
    await runtime.command({ type: 'inject', event: { id: 'follow', kind: 'follow', user: { id: 'fan', name: '客人' }, at: now } })
    expect(runtime.getState().queue.map(event => event.text)).toContain('投1')
    const commands: Command[] = [{ type: 'vote-open', title: '新一轮', options: PLAN_LIBRARY.slice(0, 2), minutes: 1 }, { type: 'vote-close' }, { type: 'vote-cancel' }, { type: 'plan-apply', id: 'old-plan' }, { type: 'suggestion-dismiss', id: 'old-idea' }]
    for (const command of commands) expect(await runtime.command(command)).toMatchObject({ ok: false, message: expect.stringContaining('先在设置中开启投票') })
    now += 60000; await vi.advanceTimersByTimeAsync(2000)
    const result = runtime.getState()
    expect(result.vote).toEqual(before)
    expect(result.drafts).toHaveLength(0); expect(result.history).toHaveLength(0)
    expect(result.stage.text).not.toContain('投票结束')
  })

  it('重新开启后保留历史数据，收票、提议与计划操作恢复', async () => {
    const saved = historical(), runtime = createRuntime({ now: () => 100000, store: { load: () => saved, save() {} } }); runtimes.push(runtime)
    const config = runtime.getState().config
    await runtime.command({ type: 'set-config', config: { ...config, vote: { ...config.vote, enabled: true } } })
    await runtime.command({ type: 'inject', event: chat('new-ballot', '投1') })
    await runtime.command({ type: 'inject', event: chat('new-idea', '提议 下回听海浪') })
    expect(runtime.getState().vote.round!.ballots).toHaveLength(2)
    expect(runtime.getState().vote.suggestions.map(idea => idea.text)).toEqual(['下回听海浪', '历史提议'])
    expect((await runtime.command({ type: 'vote-close' })).ok).toBe(true)
    expect(runtime.getState().vote.plans).toHaveLength(2)
    expect((await runtime.command({ type: 'plan-apply', id: runtime.getState().vote.plans[0]!.id })).ok).toBe(true)
  })

  it('真实模型的离线mock上下文不会把历史轮次或计划当成当前玩法', async () => {
    const saved = historical(), bodies: any[] = []
    saved.config.demo = false
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ say: ['来坐一会儿。'], action: 'vote_call', face: 'happy' }) } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }))
    })
    const runtime = createRuntime({ now: () => 100000, store: { load: () => saved, save() {} }, fetch, credentials: { get: provider => provider === 'deepseek' ? 'offline-test-key' : undefined, set() {}, encrypted: true } }); runtimes.push(runtime)
    await runtime.command({ type: 'start' }); await runtime.command({ type: 'inject', event: chat('question', '今天玩点什么') }); await runtime.flush()
    const context = JSON.parse(bodies[0].messages.at(-1).content).此刻
    expect(context.投票计划).toContain('尚未开启')
    expect(context.投票计划).toContain('切歌投票保护仍然有效')
    expect(context.小店).not.toContain('历史投票'); expect(context.小店).not.toContain('历史安排')
    expect(bodies[0].messages[0].content).not.toContain('vote_call=')
    expect(runtime.getState().history[0]?.action).not.toBe('vote_call')
  })
})
