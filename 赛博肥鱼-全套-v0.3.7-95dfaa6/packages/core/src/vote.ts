import type { AppConfig, PlanOption, VoteRound, VoteTally } from '../../shared/src/index'

/*
 * Tomorrow's plan is decided by the room, not by the biggest wallet:
 * - every viewer has exactly one ballot (the latest choice counts), and head count decides `headWeight` of the result;
 * - gift warmth only "boosts" a ballot, counted as sqrt(warmth) (quadratic voting) and capped per viewer per round;
 * - an option chosen by more than half of the voters wins outright (majority protection), whatever the boosts say.
 */
export function boostInfluence(boost: number, bonus: number, cap: number) {
  return Math.sqrt(Math.max(0, Math.min(cap, boost + bonus)))
}

export function tally(round: VoteRound | undefined, cfg: AppConfig['vote']): VoteTally[] {
  if (!round) return []
  const rows = new Map(round.options.map(o => [o.id, { heads: 0, boost: 0 }]))
  for (const b of round.ballots) {
    const row = rows.get(b.optionId)
    if (!row) continue
    row.heads++
    row.boost += boostInfluence(b.boost, b.bonus, cfg.boostCap)
  }
  const heads = [...rows.values()].reduce((a, r) => a + r.heads, 0)
  const boost = [...rows.values()].reduce((a, r) => a + r.boost, 0)
  const w = boost > 0 ? cfg.headWeight : 1
  return round.options.map(o => {
    const r = rows.get(o.id)!
    const headShare = heads ? r.heads / heads : 0, boostShare = boost ? r.boost / boost : 0
    return { optionId: o.id, heads: r.heads, boost: Math.round(r.boost * 10) / 10, headShare, boostShare, score: w * headShare + (1 - w) * boostShare, majority: heads >= 3 && r.heads / heads > .5 }
  })
}

/** The winning option id: a majority wins outright; otherwise the best score, then more heads, then the earlier option. */
export function winner(round: VoteRound | undefined, cfg: AppConfig['vote']): string | undefined {
  const rows = tally(round, cfg)
  if (!rows.some(r => r.heads)) return undefined
  const majority = rows.find(r => r.majority)
  if (majority) return majority.optionId
  return rows.reduce((best, r) => r.score > best.score + 1e-9 || (Math.abs(r.score - best.score) <= 1e-9 && r.heads > best.heads) ? r : best).optionId
}

const NUMERALS: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6 }
/** "投1", "选 2", "2号", "#3", "支持三" or a bare digit while a vote is open → the option's 0-based index. */
export function parseVote(text: string, optionCount: number): number | undefined {
  const m = text.trim().match(/^(?:投|选|支持|要|#)?\s*([1-9一二两三四五六])\s*(?:号|票|号票)?\s*[!！~。.]*$/)
  if (!m) return undefined
  const n = NUMERALS[m[1]!] ?? Number(m[1])
  return n >= 1 && n <= optionCount ? n - 1 : undefined
}

/** "提议 去海边摆摊", "#提案：讲鬼故事", "我想看 肥鱼唱歌" → the suggestion text. */
export function parseSuggestion(text: string): string | undefined {
  const m = text.trim().match(/^#?(?:提议|提案|建议|我想看|想看)[:：\s]*(.{2,30})$/)
  return m?.[1]?.trim()
}

export const PLAN_LIBRARY: PlanOption[] = [
  { id: 'scene-snow', kind: 'scene', title: '初雪夜营业', about: '窗外换成初雪，店里煮一锅热可可', scene: 'snow' },
  { id: 'scene-stars', kind: 'scene', title: '星空屋顶夜', about: '雨停了，一起数窗外的星星', scene: 'stars' },
  { id: 'scene-sakura', kind: 'scene', title: '樱花夜班', about: '樱花飘进小店，适合讲温柔的事', scene: 'sakura' },
  { id: 'scene-fireflies', kind: 'scene', title: '萤火夏夜', about: '窗外有萤火虫，肥鱼摇扇子乘凉', scene: 'fireflies' },
  { id: 'scene-rain', kind: 'scene', title: '老样子雨夜', about: '还是熟悉的雨声和热水', scene: 'rain' },
  { id: 'act-noodles', kind: 'activity', title: '深夜食堂', about: '肥鱼现场煮夜宵，大家点配料' },
  { id: 'act-story', kind: 'activity', title: '睡前故事会', about: '肥鱼讲一个温柔的睡前故事' },
  { id: 'act-fortune', kind: 'activity', title: '深夜抽签', about: '每位客人抽一支今晚的小签' },
  { id: 'act-letters', kind: 'activity', title: '熟客明信片', about: '给常来的客人各写一句话' },
  { id: 'act-music', kind: 'activity', title: '深夜点歌台', about: '大家推荐歌，肥鱼戴耳机一起听' },
  { id: 'beh-dialect', kind: 'behavior', title: '一晚上说方言', about: '肥鱼挑战全程用方言聊天' },
  { id: 'beh-noyawn', kind: 'behavior', title: '不许打哈欠挑战', about: '打一次哈欠就给大家讲个冷笑话' },
  { id: 'beh-cat', kind: 'behavior', title: '店猫值班', about: '小店的猫咪今晚当副店长' },
]
