import { createHash, createHmac, randomUUID } from 'node:crypto'
import { brotliDecompressSync, inflateSync } from 'node:zlib'
import type { LiveEvent } from '../../../packages/shared/src/index'

/** Independent implementation of Bilibili Open Live's published wire contract.
 * https://open-live.bilibili.com/document/657d8e34-f926-a133-16c0-300c1afc6e6b
 * https://open-live.bilibili.com/document/f9ce25be-312e-1f4a-85fd-fef21f1637f8
 * Header/signing cross-checked with official OpenLive_CSharpDemo a1a12430407c7e01c928637479c1b238b3a00933.
 */
export const BILIBILI_MAX_FRAME = 4 * 1024 * 1024
const MAX_PACKETS = 1000
const object = (value: unknown): Record<string, unknown> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
const clean = (value: unknown, max: number) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : ''
const id = (value: unknown): string => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(value) ? value : typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? String(value) : ''
const positive = (value: unknown, max = 100000) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= max ? value : undefined
const json = (value: Uint8Array) => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(value)) as unknown

export function signBilibiliRequest(body: string, accessKeyId: string, accessKeySecret: string, timestamp = Date.now(), nonce = randomUUID()): Record<string, string> {
  const headers: Record<string, string> = {
    'x-bili-accesskeyid': accessKeyId,
    'x-bili-content-md5': createHash('md5').update(body, 'utf8').digest('hex'),
    'x-bili-signature-method': 'HMAC-SHA256',
    'x-bili-signature-nonce': nonce,
    'x-bili-signature-version': '1.0',
    'x-bili-timestamp': String(Math.floor(timestamp / 1000)),
  }
  const canonical = Object.keys(headers).sort().map(key => `${key}:${headers[key]}`).join('\n')
  return { ...headers, Authorization: createHmac('sha256', accessKeySecret).update(canonical, 'utf8').digest('hex'), Accept: 'application/json', 'Content-Type': 'application/json' }
}

export function encodeBilibiliPacket(operation: number, body: string | Uint8Array = '', version = 1): Buffer {
  const data = typeof body === 'string' ? Buffer.from(body, 'utf8') : Buffer.from(body)
  if (data.length + 16 > BILIBILI_MAX_FRAME) throw new Error('B站消息超过大小限制。')
  const result = Buffer.alloc(16 + data.length)
  result.writeUInt32BE(result.length, 0); result.writeUInt16BE(16, 4); result.writeUInt16BE(version, 6)
  result.writeUInt32BE(operation, 8); result.writeUInt32BE(1, 12); data.copy(result, 16)
  return result
}

export interface BilibiliFrame { messages: unknown[]; authCode?: number; heartbeat: boolean }
export function decodeBilibiliFrame(input: Uint8Array): BilibiliFrame {
  if (input.byteLength > BILIBILI_MAX_FRAME) throw new Error('B站消息帧超过大小限制。')
  const result: BilibiliFrame = { messages: [], heartbeat: false }
  let packets = 0, expanded = 0
  function read(bytes: Uint8Array, depth: number) {
    if (depth > 4) throw new Error('B站压缩层数超过限制。')
    const frame = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    for (let offset = 0; offset < frame.length;) {
      if (++packets > MAX_PACKETS || frame.length - offset < 16) throw new Error('B站消息包数量或头部无效。')
      const length = frame.readUInt32BE(offset), header = frame.readUInt16BE(offset + 4), version = frame.readUInt16BE(offset + 6), operation = frame.readUInt32BE(offset + 8)
      if (header !== 16 || length < header || length > BILIBILI_MAX_FRAME || length > frame.length - offset) throw new Error('B站消息包长度无效。')
      const body = frame.subarray(offset + header, offset + length); offset += length
      if (version === 2 || version === 3) {
        const remaining = BILIBILI_MAX_FRAME - expanded
        if (remaining <= 0) throw new Error('B站解压数据超过大小限制。')
        const decoded = version === 2 ? inflateSync(body, { maxOutputLength: remaining }) : brotliDecompressSync(body, { maxOutputLength: remaining })
        expanded += decoded.length; read(decoded, depth + 1)
      } else if (version === 0 || version === 1) {
        if (operation === 3) { if (body.length < 4) throw new Error('B站心跳回应无效。'); result.heartbeat = true }
        else if (operation === 8) {
          const response = object(json(body))
          if (typeof response?.code !== 'number' || !Number.isSafeInteger(response.code)) throw new Error('B站鉴权回应无效。')
          result.authCode = response.code
        } else if (operation === 5) {
          // One bad JSON notification cannot suppress independently framed neighbours.
          try { result.messages.push(json(body)) } catch { /* Invalid notification skipped. */ }
        }
      } else throw new Error('B站消息协议版本不受支持。')
    }
  }
  read(input, 0)
  return result
}

/** No money conversion: Bilibili price/paid/r_price are never Douyin diamonds. */
export function normalizeBilibiliMessage(input: unknown, roomId: string, at: number): LiveEvent[] {
  const message = object(input), data = object(message?.data)
  if (!data || id(data.room_id) !== roomId) return []
  const command = message?.cmd
  const kind = ({ LIVE_OPEN_PLATFORM_DM: 'chat', LIVE_OPEN_PLATFORM_SEND_GIFT: 'gift', LIVE_OPEN_PLATFORM_LIVE_ROOM_ENTER: 'enter', LIVE_OPEN_PLATFORM_LIKE: 'like' } as Record<string, LiveEvent['kind']>)[typeof command === 'string' ? command : '']
  if (!kind) return []
  const openId = id(data.open_id), uid = id(data.uid), name = clean(data.uname, 60)
  if ((!openId && (!uid || uid === '0')) || !name) return []
  const userId = openId ? `bilibili:open:${openId}` : `bilibili:uid:${uid}`
  let msgId = id(data.msg_id)
  // Enter messages have no documented msg_id. Use only stable identity and platform time.
  if (!msgId && kind === 'enter' && positive(data.timestamp, Number.MAX_SAFE_INTEGER)) msgId = createHash('sha256').update(`${userId}:${data.timestamp}`).digest('hex')
  if (!msgId) return []
  const event: LiveEvent = { id: `bilibili:${roomId}:${command}:${msgId}`, origin: 'bridge', platform: 'bilibili', kind, user: { id: userId, name }, at }
  const level = positive(data.fans_medal_level, 1000)
  if (level !== undefined) event.user.level = level
  if (kind === 'chat') { event.text = clean(data.msg, 600); if (!event.text) return [] }
  if (kind === 'like') { const count = positive(data.like_count); if (count !== undefined) event.count = count }
  if (kind === 'gift') {
    const giftId = id(data.gift_id), giftName = clean(data.gift_name, 60)
    let count = positive(data.gift_num)
    if (!giftId || giftId === '0' || !giftName || count === undefined) return []
    if (data.combo_gift === true) {
      const combo = object(data.combo_info), comboId = id(combo?.combo_id), base = positive(combo?.combo_base_num), repeats = positive(combo?.combo_count)
      if (!comboId || base === undefined || repeats === undefined || base * repeats > 100000) return []
      count = base * repeats
      event.comboKey = `bilibili:${roomId}:combo:${userId}:${giftId}:${comboId}`
    }
    event.giftId = `bilibili:${giftId}`; event.giftName = giftName; event.count = count
  }
  return [event]
}
