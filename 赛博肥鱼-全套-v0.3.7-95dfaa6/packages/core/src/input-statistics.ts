import type { InputOrigin, InputStatistics, LiveEvent } from '../../shared/src/index'
import { lookupGiftValue, validUnitDiamonds } from './gift-values'

const origins: InputOrigin[] = ['simulator', 'bridge', 'screen', 'unknown']
type GiftPricing = Pick<InputStatistics['recentGifts'][number], 'unitDiamonds' | 'diamonds' | 'valueSource'>
const kinds: LiveEvent['kind'][] = ['chat', 'gift', 'enter', 'follow', 'like']
const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const clean = (value: unknown, maximum: number) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maximum) : ''
const platformOf = (value: unknown): LiveEvent['platform'] => value === 'douyin' || value === 'bilibili' ? value : undefined
export const inputOrigin = (value: unknown): InputOrigin => value === 'simulator' || value === 'bridge' || value === 'screen' ? value : 'unknown'
export function createInputStatistics(at: number, legacyUnclassified = false, legacyValueUnclassified = legacyUnclassified): InputStatistics {
  const empty = () => ({ comments: 0, giftEvents: 0, giftCount: 0, reportedDiamonds: 0, refDiamonds: 0, unknownValueGiftCount: 0 })
  return { startedAt: at, counts: { simulator: empty(), bridge: empty(), screen: empty(), unknown: empty() }, recentGifts: [], legacyUnclassified, legacyValueUnclassified }
}
export function restoreInputStatistics(value: unknown, at: number, legacyUnclassified = false): InputStatistics {
  const raw = object(value), result = createInputStatistics(count(raw.startedAt) || at, legacyUnclassified || raw.legacyUnclassified === true)
  for (const origin of origins) {
    const entry = object(object(raw.counts)[origin])
    result.counts[origin] = { comments: count(entry.comments), giftEvents: count(entry.giftEvents), giftCount: count(entry.giftCount), reportedDiamonds: count(entry.reportedDiamonds), refDiamonds: count(entry.refDiamonds), unknownValueGiftCount: count(entry.unknownValueGiftCount) }
    if (count(entry.giftCount) > 0 && ['reportedDiamonds', 'refDiamonds', 'unknownValueGiftCount'].some(field => entry[field] === undefined)) result.legacyValueUnclassified = true
  }
  result.legacyValueUnclassified ||= raw.legacyValueUnclassified === true
  const last = object(raw.lastEvent)
  if (kinds.includes(last.kind as LiveEvent['kind']) && count(last.at)) result.lastEvent = { kind: last.kind as LiveEvent['kind'], origin: inputOrigin(last.origin), at: count(last.at), ...(platformOf(last.platform) ? { platform: platformOf(last.platform) } : {}) }
  if (Array.isArray(raw.recentGifts)) {
    result.recentGifts = raw.recentGifts.slice(0, 20).flatMap(value => {
      const gift = object(value), eventId = clean(gift.eventId, 200), userName = clean(gift.userName, 60), giftName = clean(gift.giftName, 60), amount = count(gift.count)
      if (!eventId || !userName || !giftName || !amount) return []
      const platform = platformOf(gift.platform)
      const price = platform === 'bilibili' ? undefined : validUnitDiamonds(gift.unitDiamonds)
      const source: 'event' | 'reference' | undefined = gift.valueSource === 'event' || gift.valueSource === 'reference' ? gift.valueSource : undefined
      const diamonds = price === undefined ? undefined : price * amount
      const pricing: GiftPricing = source && price !== undefined && Number.isSafeInteger(diamonds) && gift.diamonds === diamonds ? { unitDiamonds: price, diamonds, valueSource: source } : {}
      if (!source && raw.legacyValueUnclassified === undefined) result.legacyValueUnclassified = true
      if (source && !pricing.valueSource) result.legacyValueUnclassified = true
      return [{ eventId, userName, giftName, count: amount, origin: inputOrigin(gift.origin), at: count(gift.at), ...(platform ? { platform } : {}), ...pricing }]
    })
  }
  return result
}
/** Called only after runtime event-id and combo deduplication. No transport counter is used. */
export function recordInputStatistics(statistics: InputStatistics, event: LiveEvent, receivedAt: number): void {
  const origin = inputOrigin(event.origin), totals = statistics.counts[origin], platform = platformOf(event.platform)
  if (event.kind === 'gift') {
    const amount = count(event.count)
    if (!amount) return
    totals.giftEvents = Math.min(Number.MAX_SAFE_INTEGER, totals.giftEvents + 1)
    totals.giftCount = Math.min(Number.MAX_SAFE_INTEGER, totals.giftCount + amount)
    const price = lookupGiftValue(origin === 'screen' ? { ...event, unitDiamonds: undefined } : event), diamonds = price ? price.unitDiamonds * amount : undefined
    const value: GiftPricing = price && Number.isSafeInteger(diamonds) ? { unitDiamonds: price.unitDiamonds, diamonds, valueSource: price.source } : {}
    if (value.valueSource === 'event') totals.reportedDiamonds = Math.min(Number.MAX_SAFE_INTEGER, totals.reportedDiamonds + value.diamonds!)
    else if (value.valueSource === 'reference') totals.refDiamonds = Math.min(Number.MAX_SAFE_INTEGER, totals.refDiamonds + value.diamonds!)
    else totals.unknownValueGiftCount = Math.min(Number.MAX_SAFE_INTEGER, totals.unknownValueGiftCount + amount)
    statistics.recentGifts.unshift({ eventId: clean(event.id, 200), userName: clean(event.user.name, 60), giftName: clean(event.giftName, 60), count: amount, origin, at: receivedAt, ...(platform ? { platform } : {}), ...value })
    statistics.recentGifts = statistics.recentGifts.slice(0, 20)
  } else if (event.kind === 'chat') totals.comments = Math.min(Number.MAX_SAFE_INTEGER, totals.comments + 1)
  statistics.lastEvent = { origin, kind: event.kind, at: receivedAt, ...(platform ? { platform } : {}) }
}
