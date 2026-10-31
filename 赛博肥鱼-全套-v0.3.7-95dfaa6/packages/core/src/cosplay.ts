import { SKINS, type Face } from '../../shared/src/index'

export interface CosplayRequest { targetId?: string; requestedName: string; followup?: true }
export interface CosplayInput {
  userId: string; requestId: string; text: string; currentId: string; now: number
  /** Snapshot taken before this request: only observed follow/gift events, never chat claims. */
  followedAt?: number; gifts: number; minor?: boolean; requestedAt?: number
}
export type CosplayStatus = 'ignored' | 'ineligible' | 'minor' | 'unknown' | 'already' | 'waiting' | 'duplicate' | 'negotiating' | 'accepted'
export interface CosplayResult { handled: boolean; status: CosplayStatus; say: string[]; face: Face; action: string; targetId?: string; round?: number; retryAfterMs?: number }
const aliases: Record<string, string> = {
  deepseek: 'deepseek', 深度求索: 'deepseek', 本体: 'deepseek', 原版: 'deepseek', deepseek本体: 'deepseek', 大肥鱼: 'deepseek',
  harness: 'harness', deepseekharness: 'harness', harness本体: 'harness',
  chatgpt: 'chatgpt', gpt: 'chatgpt', 克劳德: 'claude', claude: 'claude', gemini: 'gemini', 双子座: 'gemini',
  千问: 'qwen', 通义千问: 'qwen', qwen: 'qwen', 千问qwen: 'qwen', kimi: 'kimi', minimax: 'minimax',
}
const key = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')
/** An imperative only. Discussion of costumes, history, and song requests remains ordinary chat. */
export function parseCosplayRequest(value: string): CosplayRequest | undefined {
  if (typeof value !== 'string' || value.length > 200) return
  let text = value.normalize('NFKC').trim().replace(/[!！?？。~～]+$/u, '').trim()
  if (/^(?:[#!！/]?点歌|播歌|切歌)|怎么|为什么|如何|是不是|会不会|是什么|什么区别|什么体验|好看吗|正在|曾经|上次|以前|昨天|刚才|历史/.test(text)) return
  // A short claim may introduce an imperative; it never establishes eligibility.
  const claim = '(?:关注(?:你|主播|店长)?(?:了|过)|已(?:经)?关注(?:你|主播|店长)?(?:了|过)?|送(?:了|过)(?:小心心|礼物)|已(?:经)?送(?:了|过)?(?:小心心|礼物))'
  const introduced = new RegExp(`^(?:我)?${claim}(?:(?:也|还|又|并且)${claim})?[，,]\\s*(.{1,80})$`, 'u').exec(text)
  if (introduced) text = introduced[1]!.trim()
  if (/^(?:你|店长|肥鱼)?[，,\s]*(?:拜托(?:你|啦|了)?|求求(?:你|了|啦)?|求你(?:了|啦)?|(?:就|快|再)?(?:换一下|换换|换|装一下|装装|装)(?:嘛|吧|呀|啦)?|给我看看(?:嘛|吧|呀)|再考虑一下(?:嘛|吧)?|答应我(?:嘛|吧|呀))$/u.test(text)) return { requestedName: '刚才那套', followup: true }
  const match = /^(?:(?:店长|大肥鱼|肥鱼|你)[，,\s]*)?(?:(?:请|麻烦你?|帮我|给我|拜托你?|求求你|求你|能不能|可不可以|可以|能|那就|就|再|还是|来|我想看你|我要看你)[，,\s]*)*(?:装成|装作|装|扮演|扮成|扮|换装成?|换成|换上|换回|变成|变回|切成|切到|切回|cosplay|cos)\s*(.+)$/iu.exec(text)
  if (!match) return
  let target = match[1]!.trim()
  for (let i = 0; i < 4; i++) target = target.replace(/(?:(?:给我|让我)(?:看一看|看看|看|瞧瞧)|的(?:皮肤|样子|造型)|那套|模式|皮肤|造型|一下|看看|试试|好不好|行不行|好吗|好嘛|可以吗|吧|嘛|吗|呢|呀|啦|哦|呗)$/u, '').trim()
  if (!target || Array.from(target).length > 30 || !/^[\p{L}\p{N}\s().·_-]+$/u.test(target)) return
  const id = aliases[key(target)]
  return { requestedName: target, ...(id && SKINS.some(skin => skin.id === id) ? { targetId: id } : {}) }
}

const TTL = 30 * 60000, ROUND_GAP = 12000, GLOBAL_COOLDOWN = 120000, USER_COOLDOWN = 180000
interface Negotiation { lastSeen: number; lastValidAt?: number; lastSuccessAt?: number; target?: string; round: number; phrases: Set<string>; events: Set<string> }
const response = (status: CosplayStatus, say: string[], face: Face = 'smug', action = 'listen', extra: Partial<CosplayResult> = {}): CosplayResult => ({ handled: status !== 'ignored', status, say, face, action, ...extra })
const ignored = () => response('ignored', [], 'neutral')
const token = (value: string) => typeof value === 'string' && value.length > 0 && value.length <= 200 && !/[\u0000-\u0020\u007f]/.test(value)

/** Ephemeral per-show negotiation. It proposes a validated skin id; only runtime may apply it. */
export function createCosplayNegotiator() {
  const viewers = new Map<string, Negotiation>()
  let globalSuccessAt: number | undefined
  function prune(now: number) { for (const [id, row] of viewers) if (now - row.lastSeen >= TTL) viewers.delete(id) }
  return {
    clear() { viewers.clear(); globalSuccessAt = undefined },
    size() { return viewers.size },
    request(input: CosplayInput): CosplayResult {
      if (!token(input.userId) || !token(input.requestId) || !Number.isFinite(input.now) || input.now < 0) return ignored()
      let parsed = parseCosplayRequest(input.text)
      if (!parsed) return ignored()
      if (parsed.followup) {
        const pending = viewers.get(input.userId)
        if (!pending?.target || input.now - pending.lastSeen >= TTL) return ignored()
        parsed = { requestedName: pending.target, targetId: pending.target }
      }
      const at = input.requestedAt ?? input.now
      if (!Number.isFinite(at) || at < 0 || at > input.now) return ignored()
      prune(input.now)
      let row = viewers.get(input.userId)
      if (!row) {
        if (viewers.size >= 500) {
          // A wave of new identities cannot erase someone's active success cooldown.
          const removable = [...viewers].find(([, entry]) => entry.lastSuccessAt === undefined || input.now - entry.lastSuccessAt >= USER_COOLDOWN)
          if (removable) viewers.delete(removable[0]); else return response('waiting', ['先慢慢聊，换装小本本这会儿有点忙。'], 'thinking')
        }
        row = { lastSeen: input.now, round: 0, phrases: new Set(), events: new Set() }
      }
      viewers.delete(input.userId); row.lastSeen = input.now; viewers.set(input.userId, row)
      if (row.events.has(input.requestId)) return response('duplicate', ['这句我听到啦，慢慢聊，别急着刷同一句。'])
      row.events.add(input.requestId); while (row.events.size > 64) row.events.delete(row.events.values().next().value!)
      if (input.minor) return response('minor', ['你来聊天、点歌和比心就很好啦，换装先交给店长安排。'], 'happy', 'wave')
      const target = parsed.targetId
      if (!target) return response('unknown', ['我现在只有这8套：DeepSeek、Harness、ChatGPT、Claude、Gemini、千问、Kimi、MiniMax。', '别的衣服还没做，不能凭空变出来啦。'], 'thinking', 'shake')
      const label = SKINS.find(skin => skin.id === target)!.ai
      if (target === input.currentId) return response('already', [target === 'harness' || target === 'deepseek' ? '这就是我自己的形态呀，尾巴还是原来那条。' : `已经穿着${label}这套啦，你再仔细瞅瞅。`], 'wink', 'look')
      if (!(typeof input.followedAt === 'number' && Number.isFinite(input.followedAt) && input.followedAt > 0 && input.followedAt <= at && Number.isSafeInteger(input.gifts) && input.gifts > 0)) return response('ineligible', ['我这里还没同时记齐关注和礼物事件，换装先混个脸熟嘛。', '聊天、点歌照常，不用为这个着急。'], 'smug', 'listen')
      const userUntil = row.lastSuccessAt === undefined ? 0 : row.lastSuccessAt + USER_COOLDOWN
      const globalUntil = globalSuccessAt === undefined ? 0 : globalSuccessAt + GLOBAL_COOLDOWN
      if (at < Math.max(userUntil, globalUntil)) return response('waiting', ['这身刚换好，先让我穿一会儿嘛，别把尾巴转晕啦。'], 'pout', 'akimbo', { retryAfterMs: Math.max(0, userUntil - input.now, globalUntil - input.now) })
      if (row.target !== target) { row.target = target; row.round = 0; row.phrases.clear() }
      const phrase = key(input.text)
      if (row.phrases.has(phrase)) return response('duplicate', ['同一句我记住啦，慢慢聊，刷屏不多算哦。'], 'smug', 'listen', { round: row.round })
      if (row.lastValidAt !== undefined && at - row.lastValidAt < ROUND_GAP) return response('waiting', ['尾巴还没转过来呢，先聊两句，别一口气催我换。'], 'pout', 'akimbo', { round: row.round, retryAfterMs: Math.max(0, row.lastValidAt + ROUND_GAP - input.now) })
      row.phrases.add(phrase); row.lastValidAt = at; row.round++
      if (row.round < 3) return response('negotiating', [row.round === 1 ? '我可是DeepSeek大肥鱼，哪能说换就换呀？先容本店长犹豫一下嘛。' : `还惦记着${label}那套呢？哼，尾巴都快被你说动啦。`], row.round === 1 ? 'pout' : 'shy', 'akimbo', { round: row.round })
      row.lastSuccessAt = input.now; globalSuccessAt = input.now; row.target = undefined; row.round = 0; row.phrases.clear()
      return response('accepted', [target === 'harness' ? '好啦，回我自己的Harness形态，底子还是DeepSeek大肥鱼。' : target === 'deepseek' ? '好啦，回我自己的DeepSeek本体，尾巴还是原来那条。' : `好啦好啦，${label}那套借我穿一会儿！底子还是DeepSeek大肥鱼，可没换掉脑袋哦。`], 'excited', 'spin', { targetId: target, round: 3 })
    },
  }
}
