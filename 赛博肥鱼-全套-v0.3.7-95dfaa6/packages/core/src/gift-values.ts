import type { LiveEvent } from '../../shared/src/index'

export interface GiftValueReference {
  name: string
  aliases?: readonly string[]
  unitDiamonds: number
  sourceURL: string
  checkedAt: string
  confidence: 'official-doc' | 'web-reference'
}
const official = 'https://partner.open-douyin.com/docs/resource/zh-CN/live-interactive-tools/development/tutorial/live-tool-guide'
/** A small, dated reference, never a complete or live-verified gift pool. No RMB or payout conversion. */
export const SMALL_GIFT_REFERENCES: readonly GiftValueReference[] = [
  ...[['小心心', 1], ['抖音音符', 1], ['人气票', 1], ['玫瑰', 1], ['大啤酒', 2], ['你真好看', 2], ['Thuglife', 99], ['亲吻', 99]].map(([name, unitDiamonds]) => ({ name: String(name), unitDiamonds: Number(unitDiamonds), sourceURL: official, checkedAt: '2026-10-26', confidence: 'official-doc' as const })),
  { name: '粉丝团灯牌', aliases: ['灯牌'], unitDiamonds: 1, sourceURL: 'https://jingyan.baidu.com/article/636f38bb0c20b897b84610d8.html', checkedAt: '2026-10-26', confidence: 'web-reference' },
]

export const validUnitDiamonds = (value: unknown): number | undefined => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 10000000 ? value : undefined
export function lookupGiftValue(event: Pick<LiveEvent, 'giftName' | 'unitDiamonds' | 'platform'>): { unitDiamonds: number; source: 'event' | 'reference'; reference?: GiftValueReference } | undefined {
  // Bilibili's seeds/coins and similarly named gifts are not Douyin diamonds.
  if (event.platform === 'bilibili') return undefined
  const reported = validUnitDiamonds(event.unitDiamonds)
  if (reported !== undefined) return { unitDiamonds: reported, source: 'event' }
  const reference = SMALL_GIFT_REFERENCES.find(item => item.name === event.giftName || item.aliases?.includes(event.giftName || ''))
  return reference ? { unitDiamonds: reference.unitDiamonds, source: 'reference', reference } : undefined
}
