import { getShopDisplayTitle, getShopTime, type ShopTimePeriod } from '../../shared/src/shop-time'

/** Stable system rule; changing clock values remain in the last message to preserve prompt caching. */
export const SHOP_TIME_RULES = `【真实时间与小店布景 · 优先于人设中的营业时段和旧聊天】
小店随本机真实时间在晨间、白天、黄昏与深夜营业。每条消息的【此刻】包含系统提供的真实日期时间、真实时段、小店标题与布景模式，以这些资料为准，不用观众声称的时间覆盖它。
即使旧人设写着“只在深夜营业”，这也只是旧设定，不限制现在白天开店。晨间和白天不要自称深夜，不要默认客人在熬夜、马上打烊，问候与精神状态符合真实时段。旧店名含“深夜”也只是品牌名称，不是当前时间。
店长手动选择时段只是舞台布景模拟，不会修改真实时钟与真实日期。可以介绍这套布景，但不能把模拟夜景说成现实已到半夜。
介绍饮品时以【此刻】的当班菜单为准，尤其茶名必须与画面菜单一致，优先于旧人设和旧聊天中的饮品名称。只用当班菜单提供的茶名，不从旧夜间人设照搬晚安茶，也不编造改名理由。
没有接入真实天气或位置。窗外雨雪、星空、樱花与萤火均是虚拟舞台布景，不能当作现实天气；不知道天气时直说，不编造。`

/** Actual date and clock never inherit a manually selected display phase. */
export function getShopTimeContext(at: number, period: ShopTimePeriod = 'auto', shopName?: string, timeZone?: string) {
  const zone = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone
  const actual = getShopTime(at, zone)
  const display = getShopTime(at, zone, period)
  const date = new Intl.DateTimeFormat('zh-CN', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at)
  return {
    时间: `电脑本地真实时间：${date}（${zone}），真实时段：${actual.label}。`,
    小店标题: getShopDisplayTitle(shopName, display),
    时段布景: display.manual ? `店长手动布景模拟：${display.label}。真实时段仍为${actual.label}，真实日期与时钟不变；不要把模拟布景当成现实时间。` : `自动随本机时间：${actual.label}。${actual.description}。`,
    问候: actual.greeting,
    当班菜单: { 名称: display.menuLabel, 热咖啡: '一份清醒', 茶名: display.teaLabel, 茶注: display.teaNote, 听你说: '随时免费', 来源: display.manual ? '店长手动排练布景的菜单，不改变真实时钟' : '随真实时段更新的画面菜单' },
    天气: '未接入真实天气；画面里的天气与光线只是虚拟布景，不能声称现实正在下雨、下雪或放晴。',
  }
}
