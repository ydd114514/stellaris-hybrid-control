import { describe, expect, it } from 'vitest'
import { createDirector, DEFAULT_DIRECTOR, type Directive, type Spoken } from '../packages/core/src/ai-director'
import { briefFor } from '../packages/core/src/ai-blackboard'
import { digestSnapshot, HOST_SYSTEM } from '../packages/core/src/ai-prompts'
import type { AiAgentConfig } from '../packages/shared/src/ai'
import type { AiMessage } from '../packages/core/src/ai-providers'

const agents: AiAgentConfig[] = [
  { id: 'host', role: 'host', label: '场控老师', enabled: true, providerId: 'gemini', model: 'gemini-2.5-flash', temperature: 1, maxTokens: 600, thinking: false },
  { id: 'strategist', role: 'strategist', label: '游戏参谋', enabled: true, providerId: 'deepseek', model: 'deepseek-flash', temperature: 0.4, maxTokens: 1200, thinking: true },
]
const snapshot = { state: { date: '2230.05.01', resources: { energy: { amount: 300, net: 12.5 }, alloys: { amount: 80, net: -2 } }, capacities: { colonies: 4 }, military: { fleets: [{ total_ships: 6 }, { total_ships: 3 }] }, pendingEvents: [] }, metrics: { orders: 10, verified: 9 } }
const chat = (id: string, name: string, text: string, at: number) => ({ id, kind: 'chat' as const, platform: 'bilibili' as const, user: { id: name, name }, text, at })

function setup(reply: (agent: AiAgentConfig, messages: AiMessage[]) => unknown, config = { ...DEFAULT_DIRECTOR, replyIntervalSeconds: 5, idleCommentSeconds: 0 }) {
  let t = 1_000_000
  const calls: { agent: string; messages: AiMessage[] }[] = [], said: Spoken[] = [], directives: Directive[] = []
  const director = createDirector({ now: () => t, agents: () => agents, config: () => config, readSnapshot: async () => snapshot,
    call: async (agent, messages) => { calls.push({ agent: agent.id, messages }); return { text: JSON.stringify(reply(agent, messages)), usage: { inputTokens: 100, outputTokens: 20 }, latencyMs: 5 } },
    onSay: lines => said.push(...lines), onDirective: d => directives.push(d) })
  return { director, calls, said, directives, advance: (ms: number) => { t += ms }, now: () => t }
}

describe('AI director', () => {
  it('参谋先复盘局势，场控读到参谋的话题并成批回弹幕', async () => {
    const { director, calls, said, advance } = setup(agent => agent.role === 'strategist'
      ? { date: '2230.05.01', summary: '经济稳定，合金略亏。', threats: ['合金赤字'], goals: ['扩张到6颗星球'], focus: '先补合金再扩张', nextSteps: ['新建合金厂'], talkingPoint: '舰长的合金快不够了', suggestions: [], directive: null }
      : { replies: [{ to: '阿黎', text: '阿黎来啦，合金正在补！' }], toStrategist: [], mood: '热闹', hotTopics: ['合金'] })
    expect(director.start().ok).toBe(true)
    director.feed(chat('1', '阿黎', '舰长晚上好', 1)); director.feed(chat('1', '阿黎', '重复', 1)); director.feed(chat('2', '小明', '点歌 晴天', 2))
    await director.tick()
    expect(calls.map(c => c.agent).sort()).toEqual(['host', 'strategist'])
    advance(6000); director.feed(chat('3', '小明', '现在在干嘛', 3)); await director.tick()
    const hostCall = calls.filter(c => c.agent === 'host').at(-1)!
    expect(hostCall.messages[0]!.content).toBe(HOST_SYSTEM)
    expect(hostCall.messages[1]!.content).toContain('先补合金再扩张'); expect(hostCall.messages[1]!.content).toContain('舰长的合金快不够了')
    expect(hostCall.messages[1]!.content).toContain('"name":"小明","firstVisit":true,"text":"现在在干嘛"')
    expect(calls.filter(c => c.agent === 'host')[0]!.messages[1]!.content).not.toContain('点歌')
    expect(said.map(s => s.text)).toContain('按上次游戏记录，阿黎来啦，合金正在补！')
    expect(director.board.audience).toMatchObject({ mood: '热闹', hotTopics: ['合金'] })
  })
  it('观众建议经场控转给参谋，参谋判断后场控下一轮公布，并给控制器下达指令', async () => {
    let round = 0
    const { director, calls, directives, advance } = setup((agent, messages) => {
      if (agent.role === 'host') return round++ === 0 ? { replies: [{ to: '老王', text: '这个主意我转给参谋！' }], toStrategist: [{ name: '老王', text: '去打旁边的机械帝国' }], mood: '期待开战', hotTopics: [] } : { replies: [{ to: '老王', text: '参谋说先攒舰队，三年后再打！' }], toStrategist: [] }
      const pending = /\[(s[0-9a-z]+)\] 老王/.exec(messages[1]!.content)
      return { summary: '军力不足。', focus: '先攒舰队', nextSteps: ['造 5 艘护卫舰'], talkingPoint: '', suggestions: pending ? [{ id: pending[1], decision: 'adopted', reply: '会打，但要等舰队到 20 艘' }] : [], directive: pending ? { priority: 'high', text: '优先建造护卫舰，准备对机械帝国开战' } : null }
    })
    director.start(); director.feed(chat('1', '老王', '去打旁边的机械帝国！', 1))
    await director.tick()
    expect(director.board.audience.suggestions).toMatchObject([{ name: '老王', status: 'new' }])
    advance(21000); await director.tick()
    expect(director.board.audience.suggestions[0]).toMatchObject({ status: 'adopted', reply: '会打，但要等舰队到 20 艘' })
    expect(directives).toMatchObject([{ priority: 'high', text: '优先建造护卫舰，准备对机械帝国开战', focus: '先攒舰队' }])
    // No new danmaku, but the verdict must still be announced on the next host turn.
    advance(1000); await director.tick()
    const hostCalls = calls.filter(c => c.agent === 'host')
    expect(hostCalls).toHaveLength(2); expect(hostCalls[1]!.messages[1]!.content).toContain('已采纳：会打，但要等舰队到 20 艘')
  })
  it('快照没变时参谋不重复花钱；超过每小时上限就停止调用', async () => {
    const { director, calls, advance } = setup(agent => agent.role === 'host' ? { replies: [{ to: '', text: '收到' }] } : { summary: '稳', focus: '种田', nextSteps: [] }, { ...DEFAULT_DIRECTOR, replyIntervalSeconds: 3, idleCommentSeconds: 0, strategyIntervalSeconds: 30, maxRequestsPerHour: 10 })
    director.start(); await director.tick(); advance(31000); await director.tick()
    expect(calls.filter(c => c.agent === 'strategist')).toHaveLength(1)
    for (let n = 0; n < 20; n++) { director.feed(chat(`m${n}`, `观众${n}`, `弹幕${n}`, n)); advance(4000); await director.tick() }
    expect(calls.length).toBe(10); expect(director.status().message).toContain('本小时已用满 10 次')
  })
  it('停止后迟到的回复被丢弃，不再说话', async () => {
    let release!: () => void
    const said: Spoken[] = []
    const director = createDirector({ now: () => 100_000, agents: () => agents.slice(0, 1), config: () => DEFAULT_DIRECTOR, readSnapshot: async () => undefined, onSay: l => said.push(...l),
      call: (_agent, _messages, signal) => new Promise((done, fail) => { release = () => done({ text: '{"replies":[{"to":"","text":"迟到"}]}', usage: {}, latencyMs: 1 }); signal.addEventListener('abort', () => fail(new Error('aborted'))) }) })
    director.start(); director.feed(chat('1', 'a', 'hi', 1))
    const pending = director.tick(); await Promise.resolve(); await Promise.resolve()
    director.stop(); release(); await pending
    expect(said).toEqual([]); expect(director.status()).toMatchObject({ running: false, busy: [] })
  })
  it('未配置模型时拒绝启动并说明原因', () => {
    const director = createDirector({ agents: () => [{ ...agents[0]!, model: '' }], config: () => DEFAULT_DIRECTOR, readSnapshot: async () => undefined, call: async () => { throw new Error('不应调用') } })
    expect(director.start()).toMatchObject({ ok: false, message: expect.stringContaining('选好服务商和模型') })
  })
  it('读取快照期间停止再启动，旧轮次不能恢复调用', async () => {
    let release!: (value: unknown) => void
    const calls: string[] = []
    const director = createDirector({ now: () => 1000000, agents: () => agents, config: () => DEFAULT_DIRECTOR,
      readSnapshot: () => new Promise(done => { release = done }),
      call: async agent => { calls.push(agent.id); return { text:'{}', usage:{}, latencyMs:0 } } })
    director.start();const old=director.tick();director.stop();director.start();release(snapshot);await old
    expect(calls).toEqual([]);expect(director.status().hourRequests).toBe(0);director.stop()
  })
  it('快照摘要包含关键字段，黑板提示参谋没判断前不要编造', () => {
    const digest = digestSnapshot(snapshot)
    expect(digest.text).toContain('星历 2230.05.01'); expect(digest.text).toContain('energy 300（+12.5/月）'); expect(digest.text).toContain('舰队 2 支，共 9 艘')
    expect(digestSnapshot(undefined)).toEqual({ text: '', signature: '' })
    const director = createDirector({ agents: () => agents, config: () => DEFAULT_DIRECTOR, readSnapshot: async () => undefined, call: async () => { throw new Error() } })
    expect(briefFor(director.board, 'host', 0)).toContain('不要编造')
  })
  it('经济与战争变化触发复盘，快照编号和无关大字段不会扩大摘要', () => {
    const base={...snapshot,sessionId:'game-1',state:{...snapshot.state,resources:{energy:{stockpile:300,net:12.5}},snapshotId:'a',raw:'x'.repeat(100000)}}
    const a=digestSnapshot(base)
    expect(a.text).toContain('energy 300（+12.5/月）');expect(a.gameSessionId).toBe('game-1');expect(a.text.length).toBeLessThanOrEqual(3500)
    expect(digestSnapshot({...base,metrics:{orders:99},state:{...base.state,snapshotId:'b'}}).signature).toBe(a.signature)
    expect(digestSnapshot({...base,state:{...base.state,resources:{energy:{stockpile:299,net:-1}}}}).signature).not.toBe(a.signature)
    expect(digestSnapshot({...base,state:{...base.state,wars:[{id:1}]}}).signature).not.toBe(a.signature)
    expect(digestSnapshot({...base,stopped:true}).gameSessionId).toBeUndefined()
  })
  it('参谋摘要保留当前战略瓶颈和恢复条件，不因矿物盈余忽略修复',()=>{
    const digest=digestSnapshot({...snapshot,state:{...snapshot.state,strategy:{version:1,route:'regular',focus:'消化疆域，修复内政',ordinaryExpansionAllowed:false,priorities:['先查消费品和食物岗位填充'],resumeWhen:'赤字改善后重评'}}})
    expect(digest.text).toContain('普通扩张暂缓');expect(digest.text).toContain('消费品和食物岗位填充');expect(digest.text).toContain('赤字改善后重评');expect(digest.text.length).toBeLessThanOrEqual(3500)
  })
  it('参谋建议绑定读取的当前游戏局，缓存未知量单独统计',async()=>{
    let t=1000000,calls=0;const directives:Directive[]=[]
    const director=createDirector({now:()=>t,agents:()=>agents.slice(1),config:()=>DEFAULT_DIRECTOR,readSnapshot:async()=>({...snapshot,sessionId:'game-1'}),onDirective:d=>directives.push(d),
      call:async()=>({text:JSON.stringify({focus:'先补科研',directive:{priority:'normal',text:'优先科研和探索',targetResource:'research'}}),latencyMs:1,usage:++calls===1?{inputTokens:100,outputTokens:20,cachedTokens:80,cacheWriteTokens:10}:{inputTokens:100,outputTokens:20}})})
    director.start();await director.tick();expect(directives[0]?.gameSessionId).toBe('game-1');expect(directives[0]?.targetResource).toBe('research')
    t+=200000;director.board.audience.suggestions.push({id:'s1',text:'看看科研',name:'观众',at:t,status:'new'});await director.tick()
    expect(director.status().usage.strategist).toMatchObject({requests:2,inputTokens:200,cachedTokens:80,cacheWriteTokens:10,cacheUsageMissing:1});director.stop()
  })
})
