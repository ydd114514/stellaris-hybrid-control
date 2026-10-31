import type { AppConfig, GiftRule } from '../../packages/shared/src/index'

export interface AudienceTip { id: string; kind: 'free' | 'gift'; lines: [string, string] }
const integer = (value: number) => Math.round(value).toLocaleString('zh-CN')

/** Gift-reaction switches do not disable the separate, configured ration reward. */
export function audienceTips(music: AppConfig['music'], gifts: GiftRule[], step: number): AudienceTip[] {
  const free: AudienceTip[] = [
    { id: 'chat', kind: 'free', lines: ['直接聊聊今天的事', '也可以请肥鱼比心、挥挥手'] },
    { id: 'relax', kind: 'free', lines: ['不送礼也能聊聊天', '安静坐一会儿，也很欢迎'] },
  ]
  if (music.enabled) {
    free.splice(0, 0, { id: 'song', kind: 'free', lines: [music.requestPolicy === 'regular' ? '熟客可发「点歌 歌名 歌手」' : '发「点歌 歌名 歌手」', music.qqAutoSearch !== false ? 'QQ 可播就排队，不抢当前歌' : '从小店已收录歌曲里点一首'] })
    free.push({ id: 'skip', kind: 'free', lines: ['发「切歌」只是投一票', `听满 ${Math.round(music.minPlaySeconds)} 秒，再看独立票数`] })
    free.push({ id: 'cancel', kind: 'free', lines: ['发「取消点歌」', '只取消自己的待播或检索'] })
  } else free.push({ id: 'pause-songs', kind: 'free', lines: ['今天暂时关闭点歌', '聊天、打招呼一样欢迎'] })
  if (music.enabled) free.push({ id: 'song-hearts', kind: 'gift', lines: ['点歌后送小心心，本轮多的先排', '不抢当前歌；播出清零，下轮重算'] })
  const rewards = gifts.filter(gift => Number.isFinite(gift.tokens) && Number(gift.tokens) > 0)
  if (rewards.length) {
    const gift = rewards[Math.floor(Math.max(0, step) / (free.length + 1)) % rewards.length]!
    const name = gift.name.length > 12 ? `${gift.name.slice(0, 11)}…` : gift.name
    free.push({ id: `gift:${gift.id}`, kind: 'gift', lines: [`送「${name}」+${integer(gift.tokens!)} token`, '这是小店口粮，按店长规则补充'] })
  }
  return free
}

export function audienceTip(music: AppConfig['music'], gifts: GiftRule[], step: number): AudienceTip {
  const tips = audienceTips(music, gifts, step)
  return tips[Math.max(0, Math.floor(step)) % tips.length]!
}
