import { gunzipSync } from 'node:zlib'
import type { LiveEvent } from '../../../packages/shared/src/index'

/** Field layout audited against qinant/dycast-desktop 43bf564c2d0c540ec912648deecc4946af5e87d1 (MIT).
 * https://github.com/qinant/dycast-desktop/tree/43bf564c2d0c540ec912648deecc4946af5e87d1/src/core/model
 * This bounded wire reader is an independent implementation; no generated decoder or app code is executed. */
type Field = bigint | Uint8Array
export type ProtoFields = Map<number, Field[]>
const MAX_FRAME = 4 * 1024 * 1024
export function readProto(input: Uint8Array): ProtoFields {
  if (input.byteLength > MAX_FRAME) throw new Error('抖音消息帧超过大小限制。')
  let offset = 0, fields = 0
  const result: ProtoFields = new Map()
  const variable = () => {
    let value = 0n
    for (let i = 0; i < 10; i++) { if (offset >= input.length) throw new Error('抖音消息帧不完整。'); const byte = input[offset++]!; if (i === 9 && byte > 1) throw new Error('抖音消息整数越界。'); value |= BigInt(byte & 127) << BigInt(i * 7); if (!(byte & 128)) return value }
    throw new Error('抖音消息整数越界。')
  }
  while (offset < input.length) {
    if (++fields > 20000) throw new Error('抖音消息字段过多。')
    const tag = variable(), field = Number(tag >> 3n), type = Number(tag & 7n)
    if (!field || field > 0x1fffffff) throw new Error('抖音消息字段无效。')
    let value: Field | undefined
    if (type === 0) value = variable()
    else if (type === 2) { const length = Number(variable()); if (!Number.isSafeInteger(length) || length > MAX_FRAME || offset + length > input.length) throw new Error('抖音消息长度无效。'); value = input.subarray(offset, offset += length) }
    else if (type === 1 || type === 5) { offset += type === 1 ? 8 : 4; if (offset > input.length) throw new Error('抖音消息帧不完整。') }
    else throw new Error('不支持的抖音消息编码。')
    if (value !== undefined) { const list = result.get(field) || []; list.push(value); result.set(field, list) }
  }
  return result
}
const integer = (fields: ProtoFields, id: number) => { const value = fields.get(id)?.[0]; return typeof value === 'bigint' ? value : undefined }
const bytes = (fields: ProtoFields, id: number) => { const value = fields.get(id)?.[0]; return value instanceof Uint8Array ? value : undefined }
const string = (fields: ProtoFields, id: number) => { const value = bytes(fields, id); return value ? new TextDecoder('utf-8', { fatal: true }).decode(value) : undefined }
const nested = (fields: ProtoFields, id: number) => { const value = bytes(fields, id); return value ? readProto(value) : new Map<number, Field[]>() }
const clean = (value: string | undefined, maximum: number) => (value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maximum)
const safeNumber = (value: bigint | undefined, minimum: number, maximum: number) => value !== undefined && value >= BigInt(minimum) && value <= BigInt(maximum) ? Number(value) : undefined
const stableId = (value: bigint | undefined) => value !== undefined && value > 0n ? value.toString() : undefined
export function encodeProto(fields: readonly [number, bigint | number | string | Uint8Array][]): Uint8Array {
  const output: number[] = []
  const variable = (input: bigint) => { let value = input; if (value < 0n || value > 0xffffffffffffffffn) throw new Error('抖音编码整数越界。'); while (value > 127n) { output.push(Number(value & 127n) | 128); value >>= 7n } output.push(Number(value)) }
  for (const [id, value] of fields) {
    if (typeof value === 'bigint' || typeof value === 'number') { variable(BigInt(id << 3)); variable(BigInt(value)) }
    else { const data = typeof value === 'string' ? new TextEncoder().encode(value) : value; variable(BigInt(id << 3 | 2)); variable(BigInt(data.length)); for (const byte of data) output.push(byte) }
  }
  return Uint8Array.from(output)
}
export function heartbeatFrame(): Uint8Array { return encodeProto([[7, 'hb']]) }

export interface DouyinFrameDiagnostics {
  methods: Record<'chat' | 'enter' | 'follow' | 'like' | 'gift' | 'control' | 'other', number>
  giftRejections: Record<'identity' | 'details' | 'count' | 'ambiguousCombo' | 'nonComboFinal' | 'malformed', number>
}
export interface DouyinFrameResult { events: LiveEvent[]; ack?: Uint8Array; ended: boolean; rawMessages: number; diagnostics?: DouyinFrameDiagnostics }
export function decodeDouyinFrame(frame: Uint8Array, roomId: string, at: number): DouyinFrameResult {
  const outer = readProto(frame), compressed = bytes(outer, 8), type = string(outer, 7)
  if (!compressed?.length || type === 'hb' || type === 'ack') return { events: [], ended: false, rawMessages: 0 }
  const encoding = string(outer, 6)
  const payload = encoding === 'gzip' || compressed[0] === 0x1f && compressed[1] === 0x8b ? gunzipSync(compressed, { maxOutputLength: MAX_FRAME }) : compressed
  const response = readProto(payload), events: LiveEvent[] = [], messages = response.get(1) || []
  if (messages.length > 1000) throw new Error('抖音单帧消息过多。')
  const diagnostics: DouyinFrameDiagnostics = { methods: { chat: 0, enter: 0, follow: 0, like: 0, gift: 0, control: 0, other: 0 }, giftRejections: { identity: 0, details: 0, count: 0, ambiguousCombo: 0, nonComboFinal: 0, malformed: 0 } }
  let ended = false
  for (const raw of messages) {
    if (!(raw instanceof Uint8Array)) continue
    let isGift = false
    try {
      const message = readProto(raw), method = string(message, 1)
      const kind = ({ WebcastChatMessage: 'chat', WebcastMemberMessage: 'enter', WebcastSocialMessage: 'follow', WebcastLikeMessage: 'like', WebcastGiftMessage: 'gift' } as Record<string, LiveEvent['kind']>)[method || '']
      diagnostics.methods[method === 'WebcastControlMessage' ? 'control' : kind || 'other']++; isGift = kind === 'gift'
      const body = nested(message, 2)
      if (method === 'WebcastControlMessage') { if (integer(body, 2) === 3n) ended = true; continue }
      if (!kind || kind === 'follow' && integer(body, 4) !== 1n) continue
      const common = nested(body, 1), user = nested(body, kind === 'gift' ? 7 : kind === 'like' ? 5 : 2)
      const msgId = stableId(integer(common, 2)) || stableId(integer(message, 3)), userId = stableId(integer(user, 1)), name = clean(string(user, 3), 60)
      if (!msgId || !userId || !name) { if (isGift) diagnostics.giftRejections.identity++; continue }
      const event: LiveEvent = { id: `douyin:${roomId}:${msgId}`, kind, user: { id: userId, name }, at }
      if (kind === 'chat') { event.text = clean(string(body, 3), 600); if (!event.text) continue }
      if (kind === 'gift') {
        const gift = nested(body, 15), giftId = stableId(integer(body, 2)) || stableId(integer(gift, 5)), giftName = clean(string(gift, 16), 60)
        const repeatCount = integer(body, 5), count = safeNumber(repeatCount === undefined || repeatCount === 0n ? integer(body, 6) : repeatCount, 1, 100000), groupId = stableId(integer(body, 11))
        if (!giftId || !giftName) { diagnostics.giftRejections.details++; continue }
        if (count === undefined) { diagnostics.giftRejections.count++; continue }
        if (groupId) { event.comboKey = `douyin:${roomId}:${groupId}`; event.id += `:${count}` }
        else {
          const giftType = integer(gift, 11), combo = integer(gift, 10), sendType = integer(body, 17), final = integer(body, 9) === 1n
          const streakable = combo === 1n || giftType === 1n || giftType === 4n || sendType === 1n || sendType === 4n
          // Only explicit non-combo metadata permits an initial/only notification.
          // Its later final notification is ignored even with a different msgId.
          const single = !streakable && (combo === 0n || giftType === 2n || sendType === 5n)
          if (single && final) { diagnostics.giftRejections.nonComboFinal++; continue }
          if (!single && !final) { diagnostics.giftRejections.ambiguousCombo++; continue }
        }
        event.giftId = giftId; event.giftName = giftName; event.count = count
        const diamonds = safeNumber(integer(gift, 12), 0, 10000000)
        if (diamonds !== undefined) event.unitDiamonds = diamonds
      }
      events.push(event)
    } catch { if (isGift) diagnostics.giftRejections.malformed++ /* A malformed individual message cannot suppress other independently framed messages. */ }
  }
  const logId = integer(outer, 2)
  return { events, ended, rawMessages: messages.length, diagnostics, ...(integer(response, 9) === 1n && logId !== undefined ? { ack: encodeProto([[2, logId], [7, 'ack'], [8, string(response, 5) || '']]) } : {}) }
}
