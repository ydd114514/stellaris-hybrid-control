import type { ActionDef, AppConfig, AppState, GiftRule } from '../../shared/src/index'
import { DEFAULT_PERSONA } from './persona'
import { getShopTime } from '../../shared/src/shop-time'
import { createInputStatistics } from './input-statistics'
import { createRations } from './rations'
import { DEFAULT_BGM_TRACKS } from './music-defaults'
import { MUSIC_QUEUE_DEFAULT } from '../../shared/src/music-limits'
import { calculateRoomMood } from './room-mood'

/** The first version's persona, retained for backwards compatibility without overwriting saved settings. */
export const LEGACY_PERSONALITY = '深夜小店的蓝色大肥鱼店主。温暖、有点嘴贫，像深夜还亮着的一盏灯。简短自然地陪客人聊几句，记住熟客，不扮演恋人。'

export const ACTIONS: ActionDef[] = [
  { id: 'stand', name: '站好', about: '轻轻呼吸，眨眼待机', seconds: 3, station: null, whileTalking: true },
  { id: 'wave', name: '挥挥手', about: '热情挥动鱼鳍打招呼', seconds: 2, station: null, whileTalking: true },
  { id: 'nod', name: '点头', about: '认真点头听你说', seconds: 1.6, station: null, whileTalking: true },
  { id: 'shake', name: '摇头', about: '左右摇头', seconds: 1.5, station: null, whileTalking: true },
  { id: 'jump', name: '跳一下', about: '开心跃起再落地', seconds: 1.5, station: null, whileTalking: false },
  { id: 'hop', name: '蹦蹦', about: '轻快地蹦两下', seconds: 2, station: null, whileTalking: false },
  { id: 'look', name: '张望', about: '四处看看小店', seconds: 2.5, station: null, whileTalking: true },
  { id: 'turn', name: '转身', about: '转向另一侧', seconds: 1.4, station: null, whileTalking: false },
  { id: 'spin', name: '转个圈', about: '轻盈地转一圈', seconds: 2.5, station: null, whileTalking: false },
  { id: 'sit', name: '坐一会', about: '坐下来休息', seconds: 5, station: null, whileTalking: true },
  { id: 'sleep', name: '打瞌睡', about: '困困地打个盹', seconds: 6, station: null, whileTalking: false },
  { id: 'dizzy', name: '晕乎乎', about: '小幅摇晃，眼冒星星', seconds: 3, station: null, whileTalking: false },
  { id: 'walk', name: '散步', about: '慢慢游一小段', seconds: 3, station: null, whileTalking: false },
  { id: 'run', name: '小跑', about: '快速游一小段', seconds: 2, station: null, whileTalking: false },
  { id: 'bow', name: '鞠躬', about: '礼貌地鞠躬致谢', seconds: 2.5, station: null, whileTalking: false },
  { id: 'shiver', name: '抖一抖', about: '冷得轻轻抖动', seconds: 2, station: null, whileTalking: true },
  { id: 'flap', name: '拍拍鳍', about: '轻拍鱼鳍', seconds: 2.5, station: null, whileTalking: true },
  { id: 'dance', name: '扭一扭', about: '跟着心里的节奏扭动', seconds: 4, station: null, whileTalking: false },
  { id: 'wipe_cup', name: '擦杯子', about: '拿布慢慢擦玻璃杯', seconds: 4, station: 'counter', whileTalking: true },
  { id: 'brew_coffee', name: '冲咖啡', about: '认真冲一杯热咖啡', seconds: 5, station: 'counter', whileTalking: true },
  { id: 'serve', name: '递饮料', about: '把热饮推向客人', seconds: 3, station: 'counter', whileTalking: true },
  { id: 'lean', name: '趴柜台', about: '软乎乎地趴在柜台上', seconds: 5, station: 'counter', whileTalking: true },
  { id: 'listen', name: '托腮听', about: '托着腮认真倾听', seconds: 4, station: 'counter', whileTalking: true },
  { id: 'write_note', name: '写便签', about: '在便签记下本场的小事', seconds: 4, station: 'counter', whileTalking: true },
  { id: 'count', name: '算账', about: '拨一拨小算盘', seconds: 4, station: 'counter', whileTalking: true },
  { id: 'tidy_shelf', name: '理货架', about: '整理货架上的小罐子', seconds: 5, station: 'shelf', whileTalking: false },
  { id: 'water_plant', name: '浇花', about: '给窗台的植物浇水', seconds: 4, station: 'window', whileTalking: true },
  { id: 'watch_rain', name: '看雨', about: '安静看一会窗外的雨', seconds: 6, station: 'window', whileTalking: true },
  { id: 'toggle_sign', name: '点亮招牌', about: '点亮小店的暖色招牌', seconds: 3, station: 'door', whileTalking: false },
  { id: 'sweep', name: '扫扫地', about: '用小扫帚把地面扫干净', seconds: 5, station: 'door', whileTalking: false },
  { id: 'yawn', name: '伸懒腰', about: '张开鱼鳍伸个懒腰', seconds: 3, station: null, whileTalking: false },
  { id: 'giggle', name: '偷笑', about: '捂住嘴偷偷笑', seconds: 2.5, station: null, whileTalking: true },
  { id: 'akimbo', name: '叉腰', about: '叉着腰装作很厉害', seconds: 3, station: null, whileTalking: true },
  { id: 'heart', name: '比心', about: '用鱼鳍比一颗小爱心', seconds: 3, station: null, whileTalking: true },
  { id: 'toast', name: '举杯', about: '举杯向大家道谢', seconds: 3, station: 'counter', whileTalking: true },
  // Late-night live interactions: each has its own drawn prop or effect on the stage.
  { id: 'noodles', name: '煮夜宵', about: '小锅咕嘟咕嘟煮一碗夜宵面', seconds: 5, station: 'counter', whileTalking: true },
  { id: 'tea', name: '泡热茶', about: '提起小茶壶倒一杯当班热茶', seconds: 4.5, station: 'counter', whileTalking: true },
  { id: 'cocoa', name: '吹热可可', about: '捧着热可可呼呼吹凉', seconds: 3.5, station: null, whileTalking: true },
  { id: 'read_chat', name: '念弹幕', about: '举起小屏幕认真看大家的留言', seconds: 4, station: null, whileTalking: true },
  { id: 'fortune', name: '抽签', about: '摇一摇签筒，抽一支今天的小签', seconds: 4, station: 'counter', whileTalking: true },
  { id: 'pet_cat', name: '摸店猫', about: '摸摸趴在柜台上的店猫', seconds: 4, station: 'counter', whileTalking: true },
  { id: 'photo', name: '拍立得', about: '举起拍立得给大家拍一张合照', seconds: 3, station: null, whileTalking: false },
  { id: 'cheer', name: '举应援牌', about: '举起写着谢谢你的小牌子', seconds: 3.5, station: null, whileTalking: true },
  { id: 'vote_call', name: '举号码牌', about: '举着号码牌提醒大家来投票', seconds: 4, station: null, whileTalking: true },
  { id: 'gift_open', name: '拆礼物', about: '捧着礼物盒，打开时冒出星星', seconds: 3.5, station: null, whileTalking: true },
  { id: 'lantern', name: '提灯', about: '提着小灯笼照一照小店', seconds: 4, station: null, whileTalking: true },
  { id: 'blanket', name: '裹毯子', about: '披上小毯子缩成一团', seconds: 4, station: null, whileTalking: true },
  { id: 'stargaze', name: '数星星', about: '趴在窗边一颗一颗数星星', seconds: 5, station: 'window', whileTalking: true },
  { id: 'umbrella', name: '撑伞看门', about: '在门口撑伞看看有没有来歇脚的人', seconds: 4, station: 'door', whileTalking: true },
  { id: 'music', name: '听歌摇摆', about: '戴上耳机跟着节奏晃脑袋', seconds: 4, station: null, whileTalking: true },
  { id: 'goodnight', name: '晚安', about: '捧着小月亮对大家说晚安', seconds: 3.5, station: null, whileTalking: true },
  { id: 'sneeze', name: '打喷嚏', about: '阿嚏！冒出一串小泡泡', seconds: 2, station: null, whileTalking: true },
  { id: 'fan', name: '摇扇子', about: '摇着小团扇乘凉', seconds: 4, station: null, whileTalking: true },
]
/** Ids of the 35 actions that came with the first version, used to group the action library. */
export const BASE_ACTIONS = new Set(['stand','wave','nod','shake','jump','hop','look','turn','spin','sit','sleep','dizzy','walk','run','bow','shiver','flap','dance'])
export const defaultConfig: AppConfig = {
  mode: 'supervised', demo: true,
  persona: { name: '大肥鱼', personality: DEFAULT_PERSONA, catchphrase: '本店长有自己的节奏。', maxLength: 90, forbidden: '' },
  brain: { provider: 'deepseek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', inputPrice: 0, cachedInputPrice: 0, outputPrice: 0, timeoutMs: 20000 },
  voice: { enabled: true, provider: 'system', baseUrl: '', model: 'qwen-audio-3.1-tts-flash', voice: 'longanhuan_v3.6', workspaceId: '', instruction: '温暖自然、轻松、有一点慵懒', rate: 1, outputDeviceId: '', pricePer10kChars: 0, inputPrice: 0, outputPrice: 0 },
  budget: { sessionLimit: 20, dailyLimit: 50 }, idle: { enabled: true, seconds: 12, aiChatter: true, entertainment: true, chatterSeconds: 120, hourlySpeechLimit: 24, quietBackoffSeconds: 120 },
  safety: { blockedWords: ['刷礼物才理你', '加微信转账'], reviewSensitive: true },
  stage: { safeArea: false, showLedger: true },
  look: { scheme: 'deepseek', outfit: 'maid', timeOfDay: 'auto' },
  audio: { mode: 'test', streamDeviceId: '', monitorEnabled: false, monitorDeviceId: '', streamGain: 1, monitorGain: 1, speechGain: 1, musicGain: .18, ducking: .18 },
  music: { enabled: true, qqAutoSearch: true, bgmEnabled: true, bgmTrackIds: DEFAULT_BGM_TRACKS.map(track => track.id), requestPolicy: 'open', userCooldownSeconds: 180, globalCooldownSeconds: 3, maxQueue: MUSIC_QUEUE_DEFAULT, minPlaySeconds: 45, skipMinVotes: 3, skipRatio: .6, blockedTracks: [], autoStart: true },
  input: { enabled: false, upstreamUrl: '', upstreamFormat: 'normalized', port: 17831 },
  vote: { enabled: false, headWeight: .6, boostCap: 100, minutes: 15, regularBonus: 4 },
  wallet: { enabled: true, share: .5, start: 5, debtLimit: 2, gullibleMinutes: 30 },
}
export const defaultGifts: GiftRule[] = [
  { id: 'heart', name: '小心心', action: 'heart', template: '谢谢{name}的{count}颗小心心，这会儿的小店又暖了一点。', points: 1, enabled: true, yuan: .1, tokens: 2000 },
  { id: 'coffee', name: '热咖啡', action: 'brew_coffee', template: '收到{name}的热咖啡！这杯我来冲，香气算我们大家的。', points: 10, enabled: true, yuan: 1, tokens: 20000 },
  { id: 'star', name: '小星星', action: 'toast', template: '谢谢{name}送来的{count}颗小星星，挂在窗边刚刚好。', points: 5, enabled: true, yuan: .5, tokens: 10000 },
  { id: 'light', name: '小灯笼', action: 'toggle_sign', template: '谢谢{name}的小灯笼，给来歇脚的人留一盏灯。', points: 20, enabled: true, yuan: 2, tokens: 40000 },
]
/** Only exact shipped defaults are upgraded; custom templates and all reward settings stay intact. */
export function migrateDefaultGiftTemplate(gift: GiftRule): GiftRule {
  const previous: Record<string, string> = { heart: '谢谢{name}的{count}颗小心心，今晚的小店又暖了一点。', light: '谢谢{name}的小灯笼，给晚归的人留一盏灯。' }
  const replacement = defaultGifts.find(rule => rule.id === gift.id)
  return replacement && gift.template === previous[gift.id] ? { ...gift, template: replacement.template } : gift
}
/** Permanent decorations unlocked at 1×, 2×, 3×… the warmth goal. */
export const DECORATIONS = [
  { id: 'star_lamp', name: '窗边星星灯', emoji: '⭐' }, { id: 'plant', name: '一盆小绿植', emoji: '🪴' }, { id: 'neon', name: '暖光霓虹灯', emoji: '💡' },
  { id: 'tank', name: '柜台小鱼缸', emoji: '🐠' }, { id: 'chime', name: '门口的风铃', emoji: '🎐' },
]
export function createDefaultState(now = Date.now()): AppState {
  return {
    version: '0.3.7', running: false, generating: false, config: structuredClone(defaultConfig),
    stage: { action: 'stand', face: 'happy', station: 'counter', speaking: false, text: getShopTime(now).greeting, commandId: 'welcome', muted: false },
    queue: [], drafts: [], history: [], viewers: [], gifts: structuredClone(defaultGifts),
    costs: { session: 0, today: 0, inputTokens: 0, outputTokens: 0, voiceCharacters: 0, voiceCharactersEstimated: 0, requests: 0, brainUsageMissing: 0, brainApiRequests: 0, brainApiSucceeded: 0, brainApiFailed: 0, brainApiCancelled: 0, voiceInputTokens: 0, voiceOutputTokens: 0, voiceRequests: 0, voiceUsageMissing: 0, voiceApiRequests: 0, voiceApiSucceeded: 0, voiceApiFailed: 0, voiceApiCancelled: 0, unpricedRequests: 0, todayUnpricedRequests: 0, day: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(now) },
    shop: { name: '肥鱼深夜小店', points: 0, goal: 100, totalGifts: 0, decorations: [], story: '给每个晚睡的人，留一盏灯。', scene: 'rain' },
    credentials: { deepseek: false, qwen: false, encrypted: false },
    connection: { brain: '演示模式', voice: '系统语音', input: '内置模拟器' }, inputStatistics: createInputStatistics(now), roomMood: calculateRoomMood({ now, sessionStartedAt: now, activity: [] }), degraded: false,
    vote: { suggestions: [], plans: [], feed: [] },
    music: { tracks: structuredClone(DEFAULT_BGM_TRACKS), queue: [], searches: [], status: 'stopped', skipVotes: [], activeViewers: 0, skipRequired: 3, lastMessage: '发「点歌 歌名 歌手」，QQ 音乐可播放就自动排队。', messageAt: now },
    show: { talkers: 0, turns: 0, tokens: 0, consolidating: false },
    wallet: { balance: defaultConfig.wallet.start, earned: 0, spent: 0, bankrupt: false, imagined: 0, imaginedTokens: 0 },
    rations: createRations(),
    channel: { shows: 0, minutes: 0, recaps: [], milestones: [] },
    logs: [{ id: 'welcome', at: now, level: 'info', category: '小店', message: '小店已就绪。演示模式无需密钥，也不会产生 API 费用。' }],
  }
}
export const defaultState = createDefaultState()
