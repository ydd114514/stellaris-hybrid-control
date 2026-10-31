import { open, stat } from 'node:fs/promises'
import { StringDecoder } from 'node:string_decoder'

const RESOURCE_KEYS = ['energy', 'minerals', 'food', 'consumer_goods', 'alloys', 'influence', 'unity']
const MONTHLY_WARNING = 'Mod 资源日志按游戏月度更新，并非逐帧状态；操作前仍须核对当前游戏画面。'
const MAX_LINE_LENGTH = 4096
const NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/
const MARKER_PATTERN = /^\uFEFF?(?:(?:\[[^\]\r\n]{1,160}\]){1,4}:\s*)?(FISH_OBS\|[^\r\n]*)$/
const validName = value => typeof value === 'string' && value.length > 0 && value.length <= 200 && value === value.trim() && !/[|\u0000-\u001f\u007f]/.test(value) && !/\[(?:this|root|prev|getdate|getname)[^\]]*\]/i.test(value)
function validDate(value) {
 const match = /^(\d{4,6})\.(\d{1,2})\.(\d{1,2})$/.exec(value)
 return !!match && Number(match[2]) >= 1 && Number(match[2]) <= 12 && Number(match[3]) >= 1 && Number(match[3]) <= 31
}
function numeric(value) { return NUMBER_PATTERN.test(value) && Number.isFinite(Number(value)) ? Number(value) : undefined }
function frameParser({ minOffset = 0, playerName } = {}) {
 let frame = null, latest = null, invalidSinceLatest = false, firstName, ambiguousNames = false
 const invalidate = () => { frame = null; invalidSinceLatest = true }
 function feed(line, lineOffset = 0) {
  if (line.length > MAX_LINE_LENGTH) { invalidate(); return }
  const match = MARKER_PATTERN.exec(line.replace(/\r$/, ''))
  if (!match) return
  const fields = match[1].split('|'), markerOffset = lineOffset + match.index + match[0].length - match[1].length
  if (fields[0] !== 'FISH_OBS' || fields[1] !== '1') { invalidate(); return }
  if (fields[2] === 'BEGIN') {
   frame = null
   if (fields.length !== 5 || !validDate(fields[3]) || !validName(fields[4])) { invalidate(); return }
   if (markerOffset < minOffset) return
   frame = { gameDate: fields[3], name: fields[4], stockpiles: {}, monthlyIncome: {}, keys: new Set() }
  } else if (fields[2] === 'RESOURCE') {
   if (!frame) return
   const stock = numeric(fields[4]), income = numeric(fields[5]), key = fields[3]
   if (fields.length !== 6 || !RESOURCE_KEYS.includes(key) || frame.keys.has(key) || stock === undefined || income === undefined) { invalidate(); return }
   frame.keys.add(key); frame.stockpiles[key] = stock; frame.monthlyIncome[key] = income
  } else if (fields[2] === 'END') {
   if (!frame) return
   if (fields.length !== 5 || fields[3] !== frame.gameDate || fields[4] !== frame.name || frame.keys.size !== RESOURCE_KEYS.length) { invalidate(); return }
   if (firstName === undefined) firstName = frame.name
   else if (frame.name !== firstName) ambiguousNames = true
   if (playerName === undefined || frame.name === playerName) {
    latest = { source: 'mod-log', gameDate: frame.gameDate, player: { name: frame.name, resources: { stockpiles: frame.stockpiles, monthlyIncome: frame.monthlyIncome } }, warnings: [MONTHLY_WARNING] }
    invalidSinceLatest = false
   }
   frame = null
  } else invalidate()
 }
 return {
  feed, invalidate,
  state() {
   if (!latest || (playerName === undefined && ambiguousNames)) return null
   const state = structuredClone(latest)
   if (invalidSinceLatest) state.warnings.push('后续资源帧格式不完整或无效；当前保留的是本次运行上一次完整帧。')
   return state
  },
 }
}

/** minOffset is a character offset in this text; the frame's BEGIN marker must
 * start at or after it. Prefixes must be normal bracketed game.log metadata,
 * never arbitrary chat text containing a marker. */
export function parseModLog(text, { minOffset = 0, playerName } = {}) {
 if (typeof text !== 'string' || !Number.isSafeInteger(minOffset) || minOffset < 0 || (playerName !== undefined && !validName(playerName))) return null
 const parser = frameParser({ minOffset, playerName })
 let start = 0
 while (start < text.length) {
  const end = text.indexOf('\n', start)
  if (end < 0) { parser.feed(text.slice(start), start); break }
  parser.feed(text.slice(start, end), start); start = end + 1
 }
 return parser.state()
}

const identity = info => `${info.dev}:${info.ino}:${info.birthtimeNs ?? info.birthtimeMs}`
const missing = error => error?.code === 'ENOENT' || error?.code === 'ENOTDIR'

/** Read-only incremental observer. Initialization only stats the log: existing
 * bytes never enter its parser. Each read consumes at most maxBytes, including
 * its bounded rewrite-check probe. Partial lines/frames stay private. */
export async function createModObserver({ logPath, maxBytes = 262144, playerName } = {}) {
 if (typeof logPath !== 'string' || !logPath.trim()) throw new Error('需要指定群星 game.log 路径。')
 if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 16 * 1024 * 1024) throw new Error('日志每次读取上限必须是 1 至 16777216 的整数字节。')
 if (playerName !== undefined && !validName(playerName)) throw new Error('玩家帝国名称无效，不能包含分隔符或控制字符。')
 let fileIdentity, offset = 0, parser = frameParser({ playerName }), decoder = new StringDecoder('utf8'), carry = '', discardLine = false, checkpoint = null, resetWarning = false
 try { const info = await stat(logPath, { bigint: true }); if (!info.isFile()) throw new Error('群星日志路径不是普通文件。'); fileIdentity = identity(info); offset = Number(info.size) }
 catch (error) { if (!missing(error)) throw new Error('无法初始化群星资源日志观察，请检查日志路径和读取权限。') }
 function reset(nextIdentity) {
  fileIdentity = nextIdentity; offset = 0; parser = frameParser({ playerName }); decoder = new StringDecoder('utf8'); carry = ''; discardLine = false; checkpoint = null; resetWarning = true
 }
 function consume(buffer) {
  const text = decoder.write(buffer)
  let start = 0
  while (start < text.length) {
   const end = text.indexOf('\n', start)
   const part = text.slice(start, end < 0 ? text.length : end)
   if (!discardLine) {
    if (carry.length + part.length > MAX_LINE_LENGTH) { parser.invalidate(); carry = ''; discardLine = true }
    else carry += part
   }
   if (end < 0) break
   if (!discardLine) parser.feed(carry)
   carry = ''; discardLine = false; start = end + 1
  }
 }
 async function readOnce() {
  let handle
  try {
   handle = await open(logPath, 'r')
   const before = await handle.stat({ bigint: true })
   if (!before.isFile()) { reset(undefined); return null }
   const currentIdentity = identity(before)
   if (currentIdentity !== fileIdentity || before.size < BigInt(offset)) reset(currentIdentity)
   let budget = maxBytes
   if (checkpoint && budget > 1) {
    const probeLength = Math.min(checkpoint.buffer.length, Math.floor(budget / 4))
    if (probeLength > 0) {
     const probe = Buffer.alloc(probeLength)
     const probeStart = checkpoint.position + checkpoint.buffer.length - probeLength
     const result = await handle.read(probe, 0, probeLength, probeStart); budget -= probeLength
     if (result.bytesRead !== probeLength || !probe.equals(checkpoint.buffer.subarray(-probeLength))) reset(currentIdentity)
    }
   }
   const remaining = before.size - BigInt(offset)
   const length = Number(remaining > BigInt(budget) ? BigInt(budget) : remaining)
   if (length > 0) {
    const buffer = Buffer.alloc(length), start = offset
    const { bytesRead } = await handle.read(buffer, 0, length, offset)
    offset += bytesRead
    if (bytesRead) {
     const bytes = buffer.subarray(0, bytesRead); consume(bytes)
     const size = Math.min(64, bytesRead)
     checkpoint = { position: start + bytesRead - size, buffer: Buffer.from(bytes.subarray(-size)) }
    }
   }
   // Detect replacement or truncation racing an open/read; never return its old
   // cached frame under the new file's identity.
   const [after, pathInfo] = await Promise.all([handle.stat({ bigint: true }), stat(logPath, { bigint: true })])
   if (identity(after) !== currentIdentity || identity(pathInfo) !== currentIdentity || after.size < BigInt(offset)) { reset(identity(pathInfo)); return null }
   const state = parser.state()
   if (!state) return null
   if (resetWarning) state.warnings.push('日志曾被新建、轮换或截断；旧缓存已清除，只使用重置后读取到的完整帧。')
   if (after.size > BigInt(offset)) state.warnings.push('新增日志超过本次有界读取范围，仍有日志待后续读取；当前资源帧可能滞后。')
   return state
  } catch (error) {
   reset(undefined)
   if (missing(error)) return null
   throw new Error('读取群星资源日志失败，已清除旧缓存；请检查文件和读取权限。')
  } finally { await handle?.close() }
 }
 let pending = Promise.resolve()
 return { read() { const next = pending.then(readOnce); pending = next.catch(() => {}); return next } }
}
