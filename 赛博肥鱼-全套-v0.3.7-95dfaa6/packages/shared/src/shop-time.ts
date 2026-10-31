export type ShopTimePhase = 'morning' | 'day' | 'dusk' | 'night'
export type ShopTimePeriod = 'auto' | ShopTimePhase

export interface ShopTime {
  phase: ShopTimePhase
  actualPhase: ShopTimePhase
  manual: boolean
  title: string
  description: string
  menuLabel: string
  greeting: string
  label: string
  openLabel: string
  neonLabel: string
  teaLabel: string
  teaNote: string
  hour: number
  minute: number
  timeLabel: string
}

const periods: Record<ShopTimePhase, Pick<ShopTime, 'title' | 'description' | 'menuLabel' | 'greeting' | 'label' | 'openLabel' | 'neonLabel' | 'teaLabel' | 'teaNote'>> = {
  morning: { title: '肥鱼晨光小店', description: '醒得早，也能找点轻松的小事', menuLabel: '晨光菜单', greeting: '早上好，小店开门了。今天想聊什么新鲜事？', label: '晨间', openLabel: 'MORNING, WE’RE OPEN', neonLabel: '早安，小店', teaLabel: '早安茶', teaNote: '一点元气' },
  day: { title: '肥鱼日间小店', description: '忙碌的白天，也能碰见有趣的小事', menuLabel: '日间菜单', greeting: '你好呀，小店正在营业。本店长刚刚把招牌摆正。', label: '白天', openLabel: 'TODAY, WE’RE OPEN', neonLabel: '你好，小店', teaLabel: '清爽茶', teaNote: '一点轻松' },
  dusk: { title: '肥鱼黄昏小店', description: '收集一天的小插曲，陪你等晚风', menuLabel: '黄昏菜单', greeting: '傍晚好，忙完一阵了吗？我刚跟店猫抢回半张椅子。', label: '黄昏', openLabel: 'EVENING, WE’RE OPEN', neonLabel: '晚风，小店', teaLabel: '晚风茶', teaNote: '一点松弛' },
  night: { title: '肥鱼深夜小店', description: '今晚也给晚睡的人留盏灯', menuLabel: '今夜菜单', greeting: '晚上好，小店的灯还亮着。今天有什么值得吐槽的小事？', label: '夜晚', openLabel: 'TONIGHT, WE’RE OPEN', neonLabel: '晚安，小店', teaLabel: '晚安茶', teaNote: '一点好梦' },
}

const formatters = new Map<string, Intl.DateTimeFormat>()

/** Reads the actual local clock. A selected scene period never changes the displayed time. */
export function getShopTime(date: Date | number = new Date(), timeZone?: string, period: ShopTimePeriod = 'auto'): ShopTime {
  const instant = typeof date === 'number' ? new Date(date) : date
  if (!Number.isFinite(instant.getTime())) throw new Error('小店时间无效，请检查电脑日期与时间。')
  // Resolve the local zone for each read, so an OS time-zone change also takes effect without restarting.
  const zone = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone
  let formatter = formatters.get(zone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    formatters.set(zone, formatter)
  }
  const parts = formatter.formatToParts(instant)
  const hour = Number(parts.find(part => part.type === 'hour')?.value)
  const minute = Number(parts.find(part => part.type === 'minute')?.value)
  const actualPhase: ShopTimePhase = hour >= 6 && hour < 10 ? 'morning' : hour >= 10 && hour < 17 ? 'day' : hour >= 17 && hour < 20 ? 'dusk' : 'night'
  const manual = period !== 'auto' && Object.hasOwn(periods, period)
  const phase = manual ? period as ShopTimePhase : actualPhase
  return { ...periods[phase], phase, actualPhase, manual, hour, minute, timeLabel: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` }
}

/** Only the default name follows the clock; a shop name written by its owner is kept. */
export function getShopDisplayTitle(name: string | undefined, time: Pick<ShopTime, 'title'>): string {
  const original = name?.trim()
  return !original || original === '肥鱼小店' || Object.values(periods).some(period => period.title === original) ? time.title : original
}

/** Weather choices keep their stable ids; their captions follow the selected daylight. */
export function getShopSceneLabel(scene: 'rain' | 'snow' | 'stars' | 'sakura' | 'fireflies', phase: ShopTimePhase): string {
  if (phase === 'night') return { rain: '雨夜', snow: '初雪', stars: '星空', sakura: '樱花夜', fireflies: '萤火夏夜' }[scene]
  return { rain: '雨天', snow: '初雪', stars: phase === 'dusk' ? '晚霞' : '晴空', sakura: '樱花', fireflies: '夏日草地' }[scene]
}
