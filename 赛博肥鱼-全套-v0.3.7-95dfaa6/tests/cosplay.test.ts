import { describe, expect, it } from 'vitest'
import { createCosplayNegotiator, parseCosplayRequest, type CosplayInput } from '../packages/core/src/cosplay'
import { ACTIONS } from '../packages/core/src/defaults'
import { FACES, SKINS } from '../packages/shared/src/index'

let sequence = 0
const request = (text = '装Claude', now = 100000, extra: Partial<CosplayInput> = {}): CosplayInput => ({ userId: 'one', requestId: `event-${++sequence}`, text, currentId: 'deepseek', now, followedAt: 1000, gifts: 1, ...extra })
function accept(engine: ReturnType<typeof createCosplayNegotiator>, now = 100000, userId = 'one') {
  engine.request(request('装Claude', now, { userId }))
  engine.request(request('请扮Claude', now + 12000, { userId }))
  return engine.request(request('拜托换成Claude', now + 24000, { userId }))
}

describe('明确换装请求只映射现有形态', () => {
  it('八种形态及常用别名对应shared皮肤，Harness属于自身形态', () => {
    const examples = { 装DeepSeek: 'deepseek', 扮Harness: 'harness', 扮GPT: 'chatgpt', 装Claude: 'claude', 'cosplay Gemini': 'gemini', 换成千问: 'qwen', 请换上Kimi的皮肤吧: 'kimi', 拜托扮演MiniMax: 'minimax' }
    for (const [text, targetId] of Object.entries(examples)) {
      expect(parseCosplayRequest(text)).toMatchObject({ targetId })
      expect(SKINS.some(skin => skin.id === targetId)).toBe(true)
    }
    expect(parseCosplayRequest('换回本体')).toMatchObject({ targetId: 'deepseek' })
    expect(parseCosplayRequest('你能装Claude吗？')).toMatchObject({ targetId: 'claude' })
    const own = createCosplayNegotiator(); own.request(request('扮Harness')); own.request(request('请换成Harness', 112000))
    const result = own.request(request('拜托装Harness', 124000))
    expect(result.targetId).toBe('harness'); expect(result.say.join('')).toContain('我自己的Harness形态')
  })
  it('普通提问、历史或点歌不触发，未知AI不幻变资源', () => {
    for (const text of ['你怎么在装Claude', '你是不是在扮GPT？', '装Claude会不会很难？', 'cosplay Gemini是什么体验', '上次你装Claude挺好看', '讲讲换装历史', '点歌 装Claude', '我刚才换成千问了', '今天的Gemini好用吗']) expect(parseCosplayRequest(text)).toBeUndefined()
    const engine = createCosplayNegotiator(), result = engine.request(request('装Grok'))
    expect(result.status).toBe('unknown'); expect(result.say.join('')).toContain('8套'); expect(result).not.toHaveProperty('targetId')
    expect(engine.request(request('点歌 Claude')).handled).toBe(false)
  })
  it('有限展示尾语和已关注送礼陈述后的明确指令可识别，但陈述不能提供资格', () => {
    for (const text of ['装Gemini给我看嘛', '装Gemini给我看看吧', '关注了也送了小心心，装Gemini吧', '我已经关注了，装Gemini吧', '我已关注也送过礼物, 请扮Gemini给我看看']) {
      expect(parseCosplayRequest(text)).toMatchObject({ targetId: 'gemini' })
    }
    for (const text of ['关注了也送了小心心，你怎么在装Gemini', '关注了也送了小心心，上次你装Gemini挺好看', '关注了也送了小心心，点歌 装Gemini', '我做完工作也买了书架，装Gemini吧', '关注了也送了小心心，聊完工作以后你再装Gemini吧']) expect(parseCosplayRequest(text)).toBeUndefined()
    const engine = createCosplayNegotiator()
    const claimed = engine.request(request('关注了也送了小心心，装Gemini吧', 100000, { followedAt: undefined, gifts: 0 }))
    expect(claimed.status).toBe('ineligible'); expect(claimed).not.toHaveProperty('round')
    expect(engine.request(request('装Gemini给我看嘛', 112000))).toMatchObject({ status: 'negotiating', round: 1 })
  })
})

describe('换装资格与三轮拉扯', () => {
  it('拉扯可自然承接拜托换嘛，同名别人和普通附和不会借走协商', () => {
    const engine = createCosplayNegotiator()
    expect(engine.request(request('拜托啦')).handled).toBe(false)
    expect(engine.request(request('装Claude')).status).toBe('negotiating')
    expect(engine.request(request('好呀', 112000)).handled).toBe(false)
    expect(engine.request(request('嘛', 112000)).handled).toBe(false)
    expect(engine.request(request('拜托啦', 112000, { userId: 'other' })).handled).toBe(false)
    expect(engine.request(request('拜托啦', 112000))).toMatchObject({ status: 'negotiating', round: 2 })
    expect(engine.request(request('就换一下嘛', 124000))).toMatchObject({ status: 'accepted', targetId: 'claude' })
  })
  it('关注和礼物AND，资格须在请求前具备，未记齐不劝消费也不累计进度', () => {
    const engine = createCosplayNegotiator()
    for (const extra of [{ followedAt: undefined }, { gifts: 0 }, { gifts: .5 }, { followedAt: 100001 }, { followedAt: 95000, requestedAt: 90000 }]) {
      const result = engine.request(request('装Claude', 100000, extra))
      expect(result.status).toBe('ineligible'); expect(result).not.toHaveProperty('round')
      expect(result.say.join('')).toContain('我这里还没同时记齐')
      expect(result.say.join('')).not.toMatch(/先送|再送|快刷|多刷|充值|必须消费/)
    }
    expect(engine.request(request('装Claude', 112000))).toMatchObject({ status: 'negotiating', round: 1 })
  })
  it('已穿同皮不切换，未成年只介绍免费互动', () => {
    const engine = createCosplayNegotiator()
    expect(engine.request(request('装Claude', 100000, { currentId: 'claude', gifts: 0 }))).toMatchObject({ status: 'already' })
    const minor = engine.request(request('装Claude', 100001, { minor: true }))
    expect(minor.status).toBe('minor'); expect(minor.say.join('')).not.toMatch(/关注|礼物|刷|投喂/)
    expect(engine.request(request('装Claude', 112001))).toMatchObject({ round: 1 })
  })
  it('三个不同且间隔足够的请求才同意，只返回安全targetId而不改输入', () => {
    const engine = createCosplayNegotiator(), first = request(), original = structuredClone(first)
    expect(engine.request(first)).toMatchObject({ status: 'negotiating', round: 1 })
    expect(first).toEqual(original)
    expect(engine.request(request('请扮Claude', 112000))).toMatchObject({ status: 'negotiating', round: 2 })
    const accepted = engine.request(request('拜托换成Claude', 124000))
    expect(accepted).toMatchObject({ status: 'accepted', round: 3, targetId: 'claude' })
    expect(accepted.say.join('')).toContain('底子还是DeepSeek')
    expect(FACES.some(face => face.id === accepted.face)).toBe(true)
    expect(ACTIONS.some(action => action.id === accepted.action)).toBe(true)
  })
  it('重复事件、同文换标点和过快不同文都不增加轮次，等待事件不能迟到重放', () => {
    const engine = createCosplayNegotiator(), first = request()
    engine.request(first)
    expect(engine.request({ ...first, text: '请扮Claude', now: 100001 }).status).toBe('duplicate')
    expect(engine.request(request('装Claude！', 101000)).status).toBe('duplicate')
    const early = request('请扮Claude', 102000)
    expect(engine.request(early)).toMatchObject({ status: 'waiting', round: 1 })
    expect(engine.request({ ...early, now: 115000 }).status).toBe('duplicate')
    expect(engine.request(request('请扮Claude', 115001))).toMatchObject({ status: 'negotiating', round: 2 })
    expect(engine.request(request('拜托换成Claude', 127001)).status).toBe('accepted')
  })
  it('排队处理时间变长不能把几秒内刷屏补成有效轮次', () => {
    const engine = createCosplayNegotiator()
    expect(engine.request(request('装Claude', 200000, { requestedAt: 100000 }))).toMatchObject({ round: 1 })
    expect(engine.request(request('请扮Claude', 220000, { requestedAt: 102000 }))).toMatchObject({ status: 'waiting', round: 1 })
    expect(engine.request(request('拜托换成Claude', 240000, { requestedAt: 104000 }))).toMatchObject({ status: 'waiting', round: 1 })
    expect(engine.request(request('再扮Claude', 250000, { requestedAt: 112000 }))).toMatchObject({ status: 'negotiating', round: 2 })
  })
  it('切换目标重新协商，稳定ID相互隔离不按昵称或他人进度合并', () => {
    const engine = createCosplayNegotiator()
    engine.request(request())
    expect(engine.request(request('装Claude', 112000, { userId: 'other' }))).toMatchObject({ round: 1 })
    expect(engine.request(request('换成千问', 112000))).toMatchObject({ round: 1 })
    expect(engine.request(request('请装千问', 124000))).toMatchObject({ round: 2 })
    expect(engine.request(request('拜托扮千问', 136000))).toMatchObject({ status: 'accepted', targetId: 'qwen' })
  })
})

describe('成功后冷却与有界本场状态', () => {
  it('成功才开始全局120秒和个人180秒，普通三轮不等待180秒', () => {
    const engine = createCosplayNegotiator()
    expect(accept(engine)).toMatchObject({ status: 'accepted' })
    expect(engine.request(request('扮GPT', 125000, { userId: 'other' }))).toMatchObject({ status: 'waiting', retryAfterMs: 119000 })
    expect(engine.request(request('扮GPT', 244000, { userId: 'other' }))).toMatchObject({ status: 'negotiating', round: 1 })
    expect(engine.request(request('换成千问', 244000))).toMatchObject({ status: 'waiting', retryAfterMs: 60000 })
    expect(engine.request(request('换成千问', 304000))).toMatchObject({ status: 'negotiating', round: 1 })
    expect(engine.request(request('请装千问', 316000))).toMatchObject({ status: 'negotiating', round: 2 })
    expect(engine.request(request('拜托扮千问', 328000))).toMatchObject({ status: 'accepted', targetId: 'qwen' })
  })
  it('500人上限、30分钟TTL、clear模拟新场或重启，数据不泄入下一场', () => {
    const engine = createCosplayNegotiator()
    for (let i = 0; i < 501; i++) engine.request(request('装Claude', 100000, { userId: `viewer-${i}` }))
    expect(engine.size()).toBe(500)
    expect(engine.request(request('请扮Claude', 112000, { userId: 'viewer-0' }))).toMatchObject({ round: 1 })
    engine.request(request('装Claude', 2000000, { userId: 'fresh' })); expect(engine.size()).toBe(1)
    engine.clear(); expect(engine.size()).toBe(0)
    expect(engine.request(request('装Claude', 2000001, { userId: 'fresh' }))).toMatchObject({ round: 1 })
    const protectedEngine = createCosplayNegotiator(); accept(protectedEngine)
    for (let i = 0; i < 501; i++) protectedEngine.request(request('装Claude', 125000, { userId: `flood-${i}` }))
    expect(protectedEngine.size()).toBe(500)
    expect(protectedEngine.request(request('换成千问', 244000))).toMatchObject({ status: 'waiting', retryAfterMs: 60000 })
  })
  it('无稳定身份、无安全请求编号或非法时钟不建状态', () => {
    const engine = createCosplayNegotiator()
    for (const extra of [{ userId: '' }, { requestId: '' }, { requestId: 'bad\nrequest' }, { now: NaN }, { now: -1 }, { requestedAt: 100001 }]) expect(engine.request(request('装Claude', 100000, extra)).handled).toBe(false)
    expect(engine.size()).toBe(0)
  })
})
