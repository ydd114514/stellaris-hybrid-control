import { createHash } from 'node:crypto'

export interface NormalizedRect { x: number; y: number; width: number; height: number }
export interface OCRObservation { text: string; confidence: number; bounds: NormalizedRect; region: 'comment' | 'gift' }
export interface LiveScreenCandidate { kind: 'chat' | 'gift' | 'follow'; userName: string; text?: string; giftName?: string; count?: number; fingerprint: string; bounds?: NormalizedRect; confidence: number; confirmedFrames?: number }
const clean = (value: string) => value.replace(/[\u0000-\u001f\u007f]/g, '').trim()
// Vision occasionally inserts the heart icon as a v inside this exact label.
// This is a narrow known glyph artifact, not fuzzy gift-name/price matching.
const giftLabel = (value: string) => /^小心[vVν√]心$/u.test(value) ? '小心心' : value
const nickname = (value: string) => { const name = clean(value); return name.length > 0 && name.length <= 30 && !/[：:…*\[\]【】]|\.{2,}|^\d+$/.test(name) && !/^(?:评论|弹幕|礼物|送礼|在线|直播|系统|昵称|关注|粉丝|观众)/.test(name) ? name : undefined }
export function validNormalizedRect(value: unknown): value is NormalizedRect {
  if (!value || typeof value !== 'object') return false
  const v = value as NormalizedRect
  return [v.x, v.y, v.width, v.height].every(Number.isFinite) && v.x >= 0 && v.y >= 0 && v.width >= .01 && v.height >= .01 && v.x + v.width <= 1 && v.y + v.height <= 1
}
// Vision boxes are relative to the entire window. A small x1 label can be much
// smaller than a user-selectable ROI; the 1% settings minimum does not apply.
function validObservationBounds(value: unknown): value is NormalizedRect {
  if (!value || typeof value !== 'object') return false
  const v = value as NormalizedRect
  return [v.x, v.y, v.width, v.height].every(Number.isFinite) && v.x >= 0 && v.y >= 0 && v.width > 0 && v.height > 0 && v.x + v.width <= 1 && v.y + v.height <= 1
}
function validObservation(row: OCRObservation) { return row && typeof row.text === 'string' && row.text.length <= 1000 && Number.isFinite(row.confidence) && row.confidence >= .30 && row.confidence <= 1 && ['comment', 'gift'].includes(row.region) && validObservationBounds(row.bounds) }
function parseSameLineCandidates(rows: readonly OCRObservation[]): LiveScreenCandidate[] {
  const groups: OCRObservation[][] = []
  for (const row of [...rows].sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x)) {
    const group = groups.find(items => items[0]!.region === row.region && items.every(item => row.bounds.x >= item.bounds.x + item.bounds.width - .005 || item.bounds.x >= row.bounds.x + row.bounds.width - .005) && Math.abs(items[0]!.bounds.y + items[0]!.bounds.height / 2 - row.bounds.y - row.bounds.height / 2) <= Math.min(items[0]!.bounds.height, row.bounds.height) * .45)
    if (group) group.push(row); else groups.push([row])
  }
  const found = new Map<string, LiveScreenCandidate>()
  for (const group of groups) {
    const ordered = group.sort((a, b) => a.bounds.x - b.bounds.x), line = clean(ordered.map(row => row.text).join(' '))
    const x = Math.min(...group.map(row => row.bounds.x)), y = Math.min(...group.map(row => row.bounds.y))
    const bounds = { x, y, width: Math.max(...group.map(row => row.bounds.x + row.bounds.width)) - x, height: Math.max(...group.map(row => row.bounds.y + row.bounds.height)) - y }
    const confidence = Math.min(...group.map(row => row.confidence))
    let value: Omit<LiveScreenCandidate, 'fingerprint'> | undefined
    if (group[0]!.region === 'comment') {
      const follow = /^(.{1,40}?)\s*关注了(?:主播|本直播间|你|小店)[！!。]?$/u.exec(line)
      const comment = /^(.{1,40}?)\s*[：:]\s*(.{1,600})$/u.exec(line)
      if (follow && nickname(follow[1]!)) value = { kind: 'follow', userName: nickname(follow[1]!)!, confidence, bounds }
      else if (comment && nickname(comment[1]!)) value = { kind: 'chat', userName: nickname(comment[1]!)!, text: clean(comment[2]!), confidence, bounds }
    } else {
      const gift = /^(.{1,40}?)\s*(?:送出(?:了)?|赠送(?:了)?)\s*(.{1,70}?)\s*$/u.exec(line)
      if (gift && nickname(gift[1]!)) {
        const amount = /\s*(?:[xX×＊*]\s*(\d{1,6})|(\d{1,6})\s*个)\s*[|｜丨]?\s*$/u.exec(gift[2]!)
        const count = amount ? Number(amount[1] ?? amount[2]) : undefined
        const giftName = giftLabel(clean(amount ? gift[2]!.slice(0, amount.index) : gift[2]!))
        // A clipped 小心心 card was observed as 小心, then later as its full
        // name after scrolling, producing two fingerprints for one real card.
        // Hold that known incomplete label; never guess its missing glyph.
        if (giftName === '小心') continue
        if (giftName.length > 0 && giftName.length <= 40 && !/[¥￥]|抖币|钻石|元|…|\.{2,}/u.test(giftName) && !(amount && /[xX×＊*]\s*\d+\s*[|｜丨]?$/u.test(giftName)) && (count === undefined || count >= 1 && count <= 100000)) value = { kind: 'gift', userName: nickname(gift[1]!)!, giftName, ...(count === undefined ? {} : { count }), confidence, bounds }
      }
    }
    if (!value || value.kind === 'chat' && !value.text) continue
    const fingerprint = createHash('sha256').update(JSON.stringify([value.kind, value.userName, value.text ?? '', value.giftName ?? ''])).digest('hex')
    found.set(`${fingerprint}:${Math.round(y * 10000)}`, { ...value, fingerprint })
  }
  return [...found.values()]
}

const centerY = (r: NormalizedRect) => r.y + r.height / 2
const union = (a: NormalizedRect, b: NormalizedRect): NormalizedRect => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.max(a.x + a.width, b.x + b.width) - Math.min(a.x, b.x), height: Math.max(a.y + a.height, b.y + b.height) - Math.min(a.y, b.y) })
const quantity = (value: string) => { const match = /^[xX×＊*]\s*([1-9]\d{0,5})\s*[|｜丨]?$/u.exec(value.trim()); return match && Number(match[1]) <= 100000 ? Number(match[1]) : undefined }
const standaloneName = (value: string) => nickname(value) && !/送出|赠送|^[xX×＊*]\s*\d|^(?:音浪|本场|展示|暂无|消息)/u.test(value.trim())

/** OCR has no platform event/user IDs. Only complete, uniquely associated cards become candidates. */
export function parseScreenCandidates(input: readonly OCRObservation[]): LiveScreenCandidate[] {
  const rows = input.filter(validObservation).slice(0, 200), gifts = rows.filter(row => row.region === 'gift'), synthetic: OCRObservation[] = []
  for (const row of gifts) {
    if (!/^(?:送出(?:了)?|赠送(?:了)?)\s*\S/u.test(row.text.trim())) continue
    // Some cards place the nickname directly above “送出 小心心”. Never
    // borrow a name across another row or accept an ambiguous pair of names.
    const names = gifts.filter(other => other !== row && standaloneName(other.text) && Math.abs(other.bounds.x - row.bounds.x) <= .015 && other.bounds.y + other.bounds.height <= row.bounds.y + .006 && row.bounds.y - other.bounds.y - other.bounds.height <= .025 && !gifts.some(between => between !== row && between !== other && /送出|赠送/u.test(between.text) && between.bounds.y > other.bounds.y + other.bounds.height && between.bounds.y < row.bounds.y))
    if (names.length !== 1) continue
    const previous = names[0]!
    synthetic.push({ ...row, text: `${previous.text.trim()} ${row.text.trim()}`, confidence: Math.min(previous.confidence, row.confidence), bounds: union(previous.bounds, row.bounds) })
  }
  const found = new Map<string, LiveScreenCandidate>()
  for (const row of [...parseSameLineCandidates(rows), ...parseSameLineCandidates(synthetic)]) found.set(`${row.fingerprint}:${Math.round((row.bounds?.y ?? 0) * 10000)}`, row)
  const result = [...found.values()], anchors = result.filter(row => row.kind === 'gift' && row.count === undefined && row.bounds), complete = result.filter(row => row.kind === 'gift' && row.count !== undefined && row.bounds), quantities = gifts.filter(row => quantity(row.text) !== undefined)
  const assignments = new Map<LiveScreenCandidate, OCRObservation[]>()
  for (const number of quantities) {
    const choices = anchors.filter(anchor => {
      const box = anchor.bounds!, distance = Math.abs(centerY(number.bounds) - centerY(box)), bottom = box.y + box.height
      const right = number.bounds.x >= box.x + box.width - .01 && distance <= Math.min(.04, box.height * 1.5)
      const nextLine = number.bounds.x >= box.x - .01 && number.bounds.x + number.bounds.width <= box.x + box.width + .01 && number.bounds.y >= bottom - .006 && number.bounds.y - bottom <= .025
      const crossesCard = gifts.some(other => /送出|赠送/u.test(other.text) && other.bounds.y >= bottom - .006 && other.bounds.y < number.bounds.y + number.bounds.height)
      return distance <= .04 && (right || nextLine) && !crossesCard
    }).map(anchor => ({ anchor, distance: Math.abs(centerY(number.bounds) - centerY(anchor.bounds!)) })).sort((a, b) => a.distance - b.distance)
    // One count may belong to exactly one nearest card. A count between cards
    // or multiple possible counts for one card is deliberately left unassigned.
    if (!choices.length || choices[1] && choices[1].distance - choices[0]!.distance < .006) continue
    if (complete.some(card => Math.abs(centerY(number.bounds) - centerY(card.bounds!)) <= choices[0]!.distance + .006)) continue
    const anchor = choices[0]!.anchor
    assignments.set(anchor, [...(assignments.get(anchor) ?? []), number])
  }
  for (const [anchor, numbers] of assignments) {
    if (numbers.length !== 1) continue
    const number = numbers[0]!
    anchor.count = quantity(number.text); anchor.confidence = Math.min(anchor.confidence, number.confidence); anchor.bounds = union(anchor.bounds!, number.bounds)
  }
  // A missing visible count is not an implicit single gift.
  return result.filter(row => row.kind !== 'gift' || row.count !== undefined)
}
