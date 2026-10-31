import type { Face, RoomMood } from '../../shared/src/index'
export type { RoomMood } from '../../shared/src/index'

export type RoomMoodKind = 'lively' | 'cozy' | 'restless' | 'lonely' | 'reunited'
export interface RoomActivity { userId: string; kind: 'chat' | 'enter' | 'gift'; at: number; meaningful?: boolean }
export interface RoomMoodInput {
  now: number; sessionStartedAt: number; activity: readonly RoomActivity[]
  lastAudienceAt?: number; lastReplyAt?: number; recentReplies?: readonly { at: number; text?: string }[]
  previous?: RoomMood
}
const ACTIVE_WINDOW = 120000, WARM_WINDOW = 180000, RESTLESS_AFTER = 180000, LONELY_AFTER = 360000, REUNION_HOLD = 30000
const kinds: readonly RoomMoodKind[] = ['lively', 'cozy', 'restless', 'lonely', 'reunited']
const display: Record<RoomMoodKind, { label: string; face: Face; actions: string[] }> = {
  lively: { label: '热闹开心', face: 'happy', actions: ['cheer', 'heart', 'flap', 'giggle', 'toast'] },
  cozy: { label: '慢慢陪你', face: 'neutral', actions: ['listen', 'tea', 'cocoa', 'water_plant'] },
  restless: { label: '尾巴坐不住', face: 'pout', actions: ['akimbo', 'wipe_cup', 'tidy_shelf', 'sweep'] },
  lonely: { label: '安静得冒泡', face: 'pout', actions: ['lean', 'listen', 'yawn', 'write_note'] },
  reunited: { label: '来客啦', face: 'excited', actions: ['wave', 'heart', 'cheer'] },
}

/** Pure, ephemeral mood calculation. Caller owns previous state and accepted audience receipts. */
export function calculateRoomMood(input: RoomMoodInput): RoomMood {
  const now = Number.isFinite(input.now) && input.now >= 0 ? input.now : 0
  const start = Number.isFinite(input.sessionStartedAt) ? Math.max(0, Math.min(now, input.sessionStartedAt)) : now
  const validTime = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= start && value <= now
  const previous = input.previous && kinds.includes(input.previous.kind) && validTime(input.previous.since) && validTime(input.previous.lastAudienceAt) ? input.previous : undefined
  const events = input.activity.filter(event => event && typeof event.userId === 'string' && event.userId.trim().length > 0 && event.userId.length <= 200 && ['chat', 'enter', 'gift'].includes(event.kind) && event.meaningful !== false && validTime(event.at))
  let lastAudienceAt = validTime(input.lastAudienceAt) ? input.lastAudienceAt : start
  if (previous) lastAudienceAt = Math.max(lastAudienceAt, previous.lastAudienceAt)
  for (const event of events) lastAudienceAt = Math.max(lastAudienceAt, event.at)
  const latest = new Map<string, number>(), warmIds = new Set<string>(), chatIds = new Set<string>()
  for (const event of events) {
    if (now - event.at <= WARM_WINDOW) warmIds.add(event.userId)
    if (now - event.at > ACTIVE_WINDOW) continue
    latest.set(event.userId, Math.max(latest.get(event.userId) ?? start, event.at))
    if (event.kind === 'chat') chatIds.add(event.userId)
  }
  const silentFor = now - lastAudienceAt, activeParticipants = latest.size
  const heat = Math.min(100, Math.round([...latest.values()].reduce((sum, at) => sum + 25 * Math.max(0, 1 - (now - at) / ACTIVE_WINDOW), 0)))
  let kind: RoomMoodKind = silentFor >= LONELY_AFTER ? 'lonely' : silentFor >= RESTLESS_AFTER ? 'restless' : activeParticipants >= 2 ? 'lively' : 'cozy'
  let lastReunitedAt = previous && validTime(previous.lastReunitedAt) ? previous.lastReunitedAt : undefined
  const returnedAfterQuiet = previous && lastAudienceAt > previous.lastAudienceAt && lastAudienceAt - previous.lastAudienceAt >= RESTLESS_AFTER && now - lastAudienceAt <= REUNION_HOLD
  if (returnedAfterQuiet && (lastReunitedAt === undefined || now - lastReunitedAt >= RESTLESS_AFTER)) { kind = 'reunited'; lastReunitedAt = now }
  else if (previous?.kind === 'reunited' && now - previous.since < REUNION_HOLD && silentFor < RESTLESS_AFTER) kind = 'reunited'
  else if (previous?.kind === 'lively' && kind === 'cozy' && (warmIds.size >= 2 || now - previous.since < 45000)) kind = 'lively'
  const since = previous?.kind === kind ? previous.since : now
  const justSpoke = validTime(input.lastReplyAt) && now - input.lastReplyAt < 45000
  const recentReplies = (input.recentReplies ?? []).filter(reply => validTime(reply.at) && now - reply.at < ACTIVE_WINDOW).length
  let description = kind === 'lively'
    ? (activeParticipants >= 2 ? `最近两分钟有${activeParticipants}位不同客人发起互动，气氛热闹，开心接住新话题。` : '刚才多位客人互动的热闹劲还没散，保持轻快，不急着翻心情。')
    : kind === 'cozy' ? '互动节奏舒缓，轻松陪着客人，按具体话题回应，也可以擦杯子或照顾小植物。'
      : kind === 'restless' ? '最近三分钟没有新互动，尾巴有点坐不住；自己找件好玩的事，把小剧场接下去，不光站着等弹幕。'
        : kind === 'lonely' ? '安静超过六分钟，更要自己接梗演小剧场、跟店猫和尾巴找乐子，让路过的人有内容可看；不责怪观众，不把安静和礼物挂钩，不求救或施压。'
          : '安静后收到了新互动，明显高兴地接住这一句；不要凭心情编造熟客关系。'
  description += '这里只描述最近互动热度，不是真实在线人数。'
  if (justSpoke || recentReplies >= 2) description += '刚说过话，先用动作或停顿继续陪着，不接连独白。'
  return { kind, label: display[kind].label, description, face: display[kind].face, allowedActions: [...display[kind].actions], since, lastAudienceAt, ...(lastReunitedAt === undefined ? {} : { lastReunitedAt }), heat, activeChatters: chatIds.size, activeParticipants }
}
