import type { LiveEvent, LivePlatform } from '../../shared/src/index'

export type InputFormat = 'auto' | 'normalized' | 'douyin-barrage'
const kinds = new Set(['chat', 'gift', 'enter', 'follow', 'like'])
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const clean = (value: unknown, limit: number) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, limit) : ''
const identifier = (value: unknown, label: string): string => {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error(`${label}超过安全整数范围，请用字符串发送。`)
  const result = typeof value === 'number' && value >= 0 ? String(value) : clean(value, 201)
  if (result.length > 200) throw new Error(`${label}不能超过 200 字。`)
  if (!result || result === '0') throw new Error(`消息缺少稳定${label}，不能用昵称代替。`)
  return result
}
const positiveCount = (value: unknown, fallback = 1) => {
  const count = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  if (count === undefined) return fallback
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 1 || count > 100000) throw new Error('礼物数量需要是 1–100000 的整数。')
  return count
}
// Only the protocol's documented per-item diamond field crosses this boundary.
const unitDiamonds = (value: unknown): number | undefined => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 10000000 ? value : undefined
type EventPlatform = LivePlatform
const eventPlatform = (value: unknown): EventPlatform | undefined => value === 'douyin' || value === 'bilibili' ? value : undefined
// Open IDs are opaque and may contain colons. Only this platform's exact prefix is meaningful.
const namespace = (id: string, platform?: EventPlatform): string => {
  if (!platform || id.startsWith(`${platform}:`)) return id
  const result = `${platform}:${id}`
  if (result.length > 200) throw new Error('添加平台标识后 ID 不能超过 200 字。')
  return result
}
const user = (value: unknown, barrage = false, platform?: EventPlatform): LiveEvent['user'] => {
  const obj = record(value)
  const id = identifier(barrage ? obj.Id ?? obj.SecUid : obj.id, '用户 ID')
  const name = clean(barrage ? obj.Nickname ?? obj.NickName : obj.name, 60)
  if (!name) throw new Error('消息缺少观众昵称。')
  const level = Number(barrage ? obj.PayLevel ?? obj.Level : obj.level)
  return { id: namespace(id, platform), name, ...(Number.isFinite(level) ? { level: Math.max(0, Math.min(100, Math.floor(level))) } : {}) }
}

/** Native adapters and runtime injection share the transport's idempotent identity boundary. */
export function namespaceLiveEvent(event: LiveEvent, platform: LivePlatform): LiveEvent {
  const selected = eventPlatform(platform)
  if (!selected) throw new Error('不支持的直播平台。')
  const result: LiveEvent = {
    ...event, platform: selected,
    id: namespace(identifier(event.id, '事件 ID'), selected),
    user: { ...event.user, id: namespace(identifier(event.user?.id, '用户 ID'), selected) },
    ...(event.comboKey !== undefined ? { comboKey: namespace(identifier(event.comboKey, '连击标识'), selected) } : {}),
  }
  if (selected === 'bilibili') delete result.unitDiamonds
  return result
}

/** Preserve 64-bit platform IDs before JSON.parse can round them. No executable source is evaluated. */
export function parseTransportJson(source: string): unknown {
  if (Buffer.byteLength(source, 'utf8') > 65536) throw new Error('单条输入超过 64 KiB。')
  let quoted = false, escaped = false, result = ''
  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!
    if (quoted) {
      result += ch
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') quoted = false
      continue
    }
    if (ch === '"') { quoted = true; result += ch; continue }
    if (ch === '-' || /[0-9]/.test(ch)) {
      const token = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(source.slice(i))?.[0]
      if (token) {
        result += /^-?\d{16,}$/.test(token) && !Number.isSafeInteger(Number(token)) ? JSON.stringify(token) : token
        i += token.length - 1
        continue
      }
    }
    result += ch
  }
  try { return JSON.parse(result) } catch { throw new Error('输入不是有效的 JSON。') }
}

function normalized(obj: Record<string, unknown>, at: number): LiveEvent {
  if (!kinds.has(String(obj.kind))) throw new Error('不支持这种直播事件。')
  const platform = eventPlatform(obj.platform)
  const event: LiveEvent = { id: namespace(identifier(obj.id, '事件 ID'), platform), kind: obj.kind as LiveEvent['kind'], user: user(obj.user, false, platform), at: typeof obj.at === 'number' && Number.isFinite(obj.at) ? obj.at : at, ...(platform ? { platform } : {}) }
  if (event.kind === 'chat') {
    event.text = clean(obj.text, 600)
    if (!event.text) throw new Error('弹幕文字不能为空。')
  }
  if (event.kind === 'gift') {
    event.giftId = identifier(obj.giftId, '礼物 ID')
    event.giftName = clean(obj.giftName, 60)
    if (!event.giftName) throw new Error('礼物名称不能为空。')
    event.count = positiveCount(obj.count)
    const price = platform === 'bilibili' ? undefined : unitDiamonds(obj.unitDiamonds)
    if (price !== undefined) event.unitDiamonds = price
    if (obj.comboKey !== undefined) {
      event.comboKey = platform ? namespace(identifier(obj.comboKey, '连击标识'), platform) : clean(obj.comboKey, 200)
      if (!event.comboKey) throw new Error('连击标识不能为空。')
    }
  }
  // Claimed gifts, arbitrary yuan/price fields, role flags and credentials never cross this boundary.
  return event
}
function barrage(obj: Record<string, unknown>, at: number): LiveEvent[] {
  const type = Number(obj.Type)
  if ([0, 6, 7, 8, 9, 101, 102].includes(type)) return []
  const map: Record<number, LiveEvent['kind']> = { 1: 'chat', 2: 'like', 3: 'enter', 4: 'follow', 5: 'gift' }
  if (!map[type]) throw new Error('无法识别弹幕工具的消息类型。')
  const data = typeof obj.Data === 'string' ? record(parseTransportJson(obj.Data)) : record(obj.Data)
  const messageId = identifier(data.MsgId, '事件 ID')
  const room = clean(String(data.WebRoomId ?? data.RoomId ?? 'room'), 100)
  const event: LiveEvent = { id: `douyin:${room}:${messageId}`, kind: map[type]!, user: user(data.User, true, 'douyin'), at, platform: 'douyin' }
  if (event.kind === 'chat') {
    event.text = clean(data.Content, 600)
    if (!event.text) throw new Error('弹幕文字不能为空。')
  }
  if (event.kind === 'gift') {
    event.giftId = identifier(data.GiftId, '礼物 ID')
    event.giftName = clean(data.GiftName, 60)
    const price = unitDiamonds(data.DiamondCount)
    if (price !== undefined) event.unitDiamonds = price
    if (!event.giftName) throw new Error('礼物名称不能为空。')
    const group = data.GroupId === undefined || String(data.GroupId) === '0' ? '' : identifier(data.GroupId, '礼物分组 ID')
    if (data.Combo === true && group && Number(data.RepeatCount) >= 1) {
      event.count = positiveCount(data.RepeatCount)
      event.comboKey = `douyin:${room}:${group}`
      // Some tools retain MsgId through cumulative updates. Count makes each snapshot idempotent.
      event.id += `:${event.count}`
    } else event.count = positiveCount(data.GiftCount)
  }
  return [event]
}
function dycast(obj: Record<string, unknown>, at: number): LiveEvent[] {
  const map: Record<string, LiveEvent['kind']> = { WebcastChatMessage: 'chat', WebcastEmojiChatMessage: 'chat', WebcastGiftMessage: 'gift', WebcastLikeMessage: 'like', WebcastMemberMessage: 'enter', WebcastSocialMessage: 'follow' }
  const kind = map[String(obj.method)]
  const follows = /^(?:关注(?:了)?主播|follow(?:ed)?(?:\s|$))/i.test(String(obj.content || '').trim())
  if (!kind || obj.method === 'WebcastSocialMessage' && !follows) return []
  const event: LiveEvent = { id: namespace(`dycast:${identifier(obj.id, '事件 ID')}`, 'douyin'), kind, user: user(obj.user, false, 'douyin'), at, platform: 'douyin' }
  if (kind === 'chat') {
    event.text = clean(obj.content, 600)
    if (!event.text) throw new Error('弹幕文字不能为空。')
  }
  if (kind === 'gift') {
    const gift = record(obj.gift)
    // The public dycast transport omits the group ID. Only the explicit final snapshot is bookable.
    if (gift.repeatEnd !== 1) return []
    event.giftId = identifier(gift.id, '礼物 ID'); event.giftName = clean(gift.name, 60)
    if (!event.giftName) throw new Error('礼物名称不能为空。')
    event.count = positiveCount(gift.count)
    const price = unitDiamonds(gift.price)
    if (price !== undefined) event.unitDiamonds = price
  }
  return [event]
}

/** Adapters are independent implementations of documented JSON protocols, not copied upstream code. */
export function normalizeLivePayload(payload: unknown, format: InputFormat = 'auto', at = Date.now()): LiveEvent[] {
  let total = 0
  const visit = (value: unknown, depth: number): LiveEvent[] => {
    if (depth > 4) throw new Error('输入批次嵌套过深，请直接发送事件数组。')
    if (typeof value === 'string') value = parseTransportJson(value)
    const obj = record(value)
    const batch = Array.isArray(value) ? value : Array.isArray(obj.events) ? obj.events : undefined
    if (batch) {
      if (batch.length > 50) throw new Error('每批最多接收 50 条事件。')
      return batch.flatMap(item => visit(item, depth + 1))
    }
    if (++total > 50) throw new Error('每批最多接收 50 条事件，嵌套批次也计入总数。')
    if (!Object.keys(obj).length) throw new Error('输入事件不能为空。')
    if (format === 'douyin-barrage' || format === 'auto' && 'Type' in obj) return barrage(obj, at)
    if (format === 'auto' && 'method' in obj) return dycast(obj, at)
    return [normalized(obj, at)]
  }
  return visit(payload, 0)
}

export function validateLocalUpstream(value: string): string {
  if (!value.trim()) return ''
  let url: URL
  try { url = new URL(value) } catch { throw new Error('请填写本机弹幕工具的完整 WebSocket 地址。') }
  if (!['ws:', 'wss:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('上游只连接本机弹幕工具，请使用 ws://127.0.0.1:端口。')
  if (url.username || url.password || url.search || url.hash) throw new Error('上游地址不要包含账号、密码、查询参数或片段。')
  if (url.hostname === 'localhost') url.hostname = '127.0.0.1'
  return url.toString()
}
