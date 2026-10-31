import { safeRecipientName } from './reply-recipient'

const MAX_AMOUNT = 1000000000
const chineseDigits: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 零: 0, 〇: 0 }
function chineseAmount(value: string): number | undefined {
  let total = 0, section = 0, digit = 0, lastSmall = 10000, lastLarge = Infinity, pendingDigit = false, zero = false
  for (const character of value) {
    if (character in chineseDigits) {
      const next = chineseDigits[character]!
      if (next === 0) { if ((!total && !section) || pendingDigit || zero) return; zero = true; continue }
      if (pendingDigit) return
      digit = next; pendingDigit = true; zero = false; continue
    }
    const unit = ({ 十: 10, 百: 100, 千: 1000, 万: 10000, 亿: 100000000 } as Record<string, number>)[character]
    if (!unit || zero) return
    if (unit < 10000) {
      if (unit >= lastSmall || !pendingDigit && !(unit === 10 && section === 0)) return
      section += (pendingDigit ? digit : 1) * unit; lastSmall = unit
    } else {
      const part = section + digit
      if (!part || unit >= lastLarge) return
      total += part * unit; section = 0; lastSmall = 10000; lastLarge = unit
    }
    digit = 0; pendingDigit = false
  }
  return zero ? undefined : total + section + digit
}

function amount(value: string): number | undefined {
  if (/[0-9.,]\s+[0-9.,]/.test(value)) return
  const compact = value.replace(/\s+/g, '')
  let result: number | undefined
  if (/^[零〇一二两三四五六七八九十百千万亿]{1,20}$/u.test(compact)) result = chineseAmount(compact)
  else {
    const match = /^((?:\d{1,10}|\d{1,3}(?:,\d{3}){1,3})(?:\.\d{1,8})?)(万|亿)?$/u.exec(compact)
    if (!match) return
    const [whole, fraction = ''] = match[1]!.replace(/,/g, '').split('.')
    const divisor = 10n ** BigInt(fraction.length), multiplier = match[2] === '万' ? 10000n : match[2] === '亿' ? 100000000n : 1n
    const numerator = BigInt(whole! + fraction) * multiplier
    if (numerator % divisor !== 0n || numerator / divisor > BigInt(MAX_AMOUNT)) return
    result = Number(numerator / divisor)
  }
  return typeof result === 'number' && Number.isSafeInteger(result) && result > 0 && result <= MAX_AMOUNT ? result : undefined
}

/** Whole-sentence pretend feeding only. No trailing instructions, quotes, story narration or ledger mutation. */
export function parseImaginaryTokens(value: string): number | undefined {
  if (typeof value !== 'string' || value.length > 120 || /[\u0000-\u001f\u007f]/.test(value)) return
  const text = value.normalize('NFKC').trim()
  const prefix = '(?:我\\s*)?(?:(?:给|向)(?:你|店长|肥鱼|大肥鱼|主人)\\s*)?(?:送(?:出)?(?:了)?|投喂(?:了)?|赠送(?:了)?|喂(?:了)?|补充(?:了)?)\\s*'
  const units = '(?:tokens?|口粮|白饭)'
  const number = '([0-9零〇一二两三四五六七八九十百千万亿.,\\s]{1,30})'
  const tail = '\\s*(?:啦|喽|哦|哟)?[!。~～]*$'
  const unitFirst = new RegExp(`^${prefix}${units}\\s*${number}(?:个|份|点|口)?${tail}`, 'iu').exec(text)
  if (unitFirst) return amount(unitFirst[1]!.trim())
  const numberFirst = new RegExp(`^${prefix}${number}(?:个|份|点|口)?\\s*${units}${tail}`, 'iu').exec(text)
  return numberFirst ? amount(numberFirst[1]!.trim()) : undefined
}

export type ImaginaryFoodStage = 'crumb' | 'clock' | 'snack-cabinet' | 'sofa-kingdom' | 'rice-empire'
export interface ImaginaryFoodContext { stage: ImaginaryFoodStage; label: string; totalTokens: number; plan: string; instruction: string }
export function imaginaryFoodContext(totalTokens: number): ImaginaryFoodContext {
  const total = Number.isFinite(totalTokens) ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(totalTokens))) : 0
  const stage: ImaginaryFoodStage = total >= 100000000 ? 'rice-empire' : total >= 1000000 ? 'sofa-kingdom' : total >= 100000 ? 'snack-cabinet' : total >= 10000 ? 'clock' : 'crumb'
  const descriptions: Record<ImaginaryFoodStage, { label: string; plan: string }> = {
    crumb: { label: '饭粒小队', plan: '脑内先召集饭粒小队，给主人的拖鞋铺一张迷你午休垫。' },
    clock: { label: '午休总监', plan: '脑内把主人的闹钟请去午休，我来当三分钟贪睡总监。' },
    'snack-cabinet': { label: '零食柜守门鲸', plan: '脑内戴上饭勺皇冠，霸占主人的零食柜，巡逻到哪吃到哪。' },
    'sofa-kingdom': { label: '沙发王国', plan: '脑内用白饭堆出沙发王国，主人当专属靠垫，我窝正中央。' },
    'rice-empire': { label: '白饭宇宙', plan: '脑内宣布客厅都是鲸鱼午休领地，主人荣升首席铲饭官。' },
  }
  return { stage, label: descriptions[stage].label, totalTokens: total, plan: descriptions[stage].plan, instruction: '兴高采烈地当真接住白饭，轻松讲脑内夺舍主人的夸张段子，不向观众拆穿。只演脑内幻想，不声称真的改闹钟、控制设备或取得权限，不把幻想当成实际余额、服务用量或礼物资格。' }
}

/** Two short, playful lines for the model-free fallback; real accounting is deliberately absent. */
export function imaginaryFoodLines(name: string, received: number, totalTokens: number): [string, string] {
  const who = safeRecipientName(name)
  const meal = Number.isSafeInteger(received) && received > 0 && received <= MAX_AMOUNT ? `${received.toLocaleString('zh-CN')}口白饭` : '这份白饭'
  return [`${who}，${meal}我接住啦！饭碗都要冒尖了。`, imaginaryFoodContext(totalTokens).plan]
}
