import { describe, expect, it } from 'vitest'
import { calculateRoomMood, type RoomActivity, type RoomMoodInput } from '../packages/core/src/room-mood'
import { ACTIONS } from '../packages/core/src/defaults'
import { FACES } from '../packages/shared/src/index'

const mood = (now: number, extra: Partial<RoomMoodInput> = {}) => calculateRoomMood({ now, sessionStartedAt: 0, activity: [], ...extra })
const event = (userId: string, at: number, kind: RoomActivity['kind'] = 'chat'): RoomActivity => ({ userId, at, kind })

describe('直播间最近互动心情是纯状态，不冒充在线人数', () => {
  it('静默三分钟坐不住、六分钟小吐槽，边界准确', () => {
    expect(mood(179999).kind).toBe('cozy')
    expect(mood(180000).kind).toBe('restless')
    expect(mood(359999).kind).toBe('restless')
    expect(mood(360000).kind).toBe('lonely')
    expect(mood(360000).description).toContain('不求救或施压')
    expect(mood(360000).description).toContain('不把安静和礼物挂钩')
  })
  it('最近不同稳定身份热闹就开心，同一个人刷屏或重复入场不虚增人数', () => {
    const one = mood(100000, { activity: Array.from({ length: 30 }, () => event('same-user', 99000, 'enter')) })
    expect(one).toMatchObject({ kind: 'cozy', activeParticipants: 1, activeChatters: 0, heat: 25 })
    const many = mood(100000, { activity: [event('a', 99000), event('b', 99000, 'gift'), event('a', 99500)] })
    expect(many).toMatchObject({ kind: 'lively', activeParticipants: 2, activeChatters: 1 })
    expect(many.heat).toBeLessThanOrEqual(100)
    expect(many.description).toContain('不是真实在线人数')
    expect(many).not.toHaveProperty('onlineCount')
  })
  it('未来、上场、空身份和非有效互动不构造热度', () => {
    const result = mood(500000, { sessionStartedAt: 400000, activity: [event('old', 300000), event('future', 500001), event('', 500000), { ...event('noise', 500000), meaningful: false }, { ...event('like', 500000), kind: 'like' } as unknown as RoomActivity] })
    expect(result).toMatchObject({ kind: 'cozy', activeParticipants: 0, activeChatters: 0, heat: 0, lastAudienceAt: 400000 })
  })
  it('最后真实互动决定静默，自己的回复不充当观众互动，近期多说话先做动作', () => {
    expect(mood(400000, { lastAudienceAt: 350000 }).kind).toBe('cozy')
    const alone = mood(400000, { lastReplyAt: 399999, recentReplies: [{ at: 370000 }, { at: 390000 }] })
    expect(alone).toMatchObject({ kind: 'lonely', lastAudienceAt: 0, activeParticipants: 0, heat: 0 })
    expect(alone.description).toContain('先用动作或停顿')
  })
  it('安静后新互动短暂高兴，不编造熟客；30秒后平稳恢复', () => {
    const quiet = mood(200000)
    const returned = mood(210000, { previous: quiet, activity: [event('new-or-returning', 210000)] })
    expect(returned).toMatchObject({ kind: 'reunited', since: 210000, lastReunitedAt: 210000 })
    expect(returned.description).toContain('不要凭心情编造熟客')
    const hold = mood(230000, { previous: returned, activity: [event('new-or-returning', 210000)] })
    expect(hold).toMatchObject({ kind: 'reunited', since: 210000 })
    expect(mood(240001, { previous: hold, activity: [event('new-or-returning', 210000)] }).kind).toBe('cozy')
  })
  it('一人频繁进出或新消息不不断重启重逢心情', () => {
    const quiet = mood(200000), initial = mood(210000, { previous: quiet, activity: [event('one', 210000)] })
    const repeated = mood(220000, { previous: initial, activity: [event('one', 210000), event('one', 220000, 'enter')] })
    expect(repeated).toMatchObject({ kind: 'reunited', since: 210000, lastReunitedAt: 210000 })
    const settled = mood(250000, { previous: repeated, activity: [event('one', 250000)] })
    expect(settled.kind).toBe('cozy')
    expect(mood(255000, { previous: settled, activity: [event('one', 255000, 'enter')] })).toMatchObject({ kind: 'cozy', since: 250000, activeParticipants: 1 })
  })
  it('热闹状态有一分钟余温，不随两分钟窗口边缘立刻翻脸', () => {
    const happy = mood(100000, { activity: [event('a', 99000), event('b', 99000)] })
    const warm = mood(250000, { previous: happy, activity: [event('a', 249000), event('b', 99000)] })
    expect(warm).toMatchObject({ kind: 'lively', since: 100000, activeParticipants: 1 })
    expect(warm.description).toContain('热闹劲还没散')
    expect(mood(280000, { previous: warm, activity: [event('a', 279000), event('b', 99000)] }).kind).toBe('cozy')
  })
  it('同种心情保持since，新场不继承上场沉默或重逢时间', () => {
    const first = mood(1000), same = mood(2000, { previous: first })
    expect(same.since).toBe(first.since)
    const newSession = mood(500100, { sessionStartedAt: 500000, previous: mood(400000), lastAudienceAt: 1000 })
    expect(newSession).toMatchObject({ kind: 'cozy', since: 500100, lastAudienceAt: 500000 })
    expect(newSession.lastReunitedAt).toBeUndefined()
  })
  it('不修改调用方数组或previous，也不把返回动作数组共享给下一次', () => {
    const activity = [event('a', 1000), event('b', 1000)], previous = mood(1000, { activity }), snapshot = structuredClone(previous)
    const input = { now: 2000, sessionStartedAt: 0, activity, previous }
    const before = structuredClone(input), result = calculateRoomMood(input)
    result.allowedActions.length = 0
    expect(input).toEqual(before); expect(previous).toEqual(snapshot)
    expect(calculateRoomMood(input).allowedActions.length).toBeGreaterThan(0)
  })
  it('所有心情的表情与动作都存在，不会生成非法动作；无效时间不产生NaN', () => {
    const quiet = mood(200000)
    const results = [mood(0), mood(180000), mood(360000), mood(1000, { activity: [event('a', 1000), event('b', 1000)] }), mood(210000, { previous: quiet, activity: [event('a', 210000)] }), mood(NaN)]
    expect(new Set(results.map(result => result.kind)).size).toBe(5)
    for (const result of results) {
      expect(FACES.some(face => face.id === result.face)).toBe(true)
      for (const action of result.allowedActions) expect(ACTIONS.some(definition => definition.id === action)).toBe(true)
      expect(Number.isFinite(result.heat)).toBe(true); expect(Number.isFinite(result.since)).toBe(true)
    }
  })
})
