import type { ShopTimePeriod } from './shop-time'
export { getShopTime, getShopDisplayTitle, getShopSceneLabel } from './shop-time'
export type { ShopTime, ShopTimePhase, ShopTimePeriod } from './shop-time'

export type Mode = 'manual' | 'supervised' | 'auto'
export type Face = 'neutral' | 'happy' | 'wink' | 'love' | 'shy' | 'surprised' | 'angry' | 'sad' | 'sleepy' | 'thinking' | 'smug' | 'pout' | 'worried' | 'determined' | 'flustered' | 'scared' | 'excited' | 'cry' | 'confused'
export type Station = 'counter' | 'window' | 'shelf' | 'door'
export interface ActionDef { id: string; name: string; about: string; seconds: number; station: Station | null; whileTalking: boolean }
export type ViewerTier = 'vip' | 'regular' | 'guest'
/** Long-term memory of one viewer, rewritten when a show ends. VIPs (big supporters, high level, very active) keep more. */
export interface ViewerMemory { summary: string; facts: string[]; updatedAt: number; shows: number }
export interface Viewer { id: string; name: string; visits: number; note: string; blocked: boolean; gifts: number; verifiedGiftCount?: number; /** Receipt time of an accepted non-screen follow event; chat claims never set this. */ followedAt?: number; warmth?: number; talks?: number; level?: number; memory?: ViewerMemory }
/** What one viewer said tonight and what she answered: only viewers who chatted are kept. */
export interface SessionTurn { userId: string; name: string; heard: string; said: string; at: number }
export interface ShowState { startedAt?: number; talkers: number; turns: number; tokens?: number; consolidating: boolean; lastConsolidated?: { at: number; viewers: number; vip: number; usedModel: boolean } }
/** claimed: a chat that only says a gift was sent ("送出了火箭"); she plays along, nothing is booked. */
export type InputOrigin = 'simulator' | 'bridge' | 'screen' | 'unknown'
export type LivePlatform = 'douyin' | 'bilibili'
export interface LiveEvent { id: string; origin?: InputOrigin; platform?: LivePlatform; kind: 'chat' | 'gift' | 'enter' | 'follow' | 'like'; user: { id: string; name: string; level?: number }; text?: string; claimed?: { gift: string; count: number; yuan: number; tokens?: number }; giftId?: string; giftName?: string; count?: number; comboKey?: string; unitDiamonds?: number; at: number }
export interface InputOriginCount { comments: number; giftEvents: number; giftCount: number; reportedDiamonds: number; refDiamonds: number; unknownValueGiftCount: number }
export interface InputStatistics {
  startedAt: number
  counts: Record<InputOrigin, InputOriginCount>
  lastEvent?: { origin: InputOrigin; platform?: LivePlatform; kind: LiveEvent['kind']; at: number }
  recentGifts: { eventId: string; userName: string; giftName: string; count: number; origin: InputOrigin; platform?: LivePlatform; at: number; unitDiamonds?: number; diamonds?: number; valueSource?: 'event' | 'reference' }[]
  /** Old game totals are preserved, never guessed into a source column. */
  legacyUnclassified: boolean
  /** Older gift records did not retain unit prices; zero new counters do not mean their value was zero. */
  legacyValueUnclassified: boolean
}
/** Received interaction in this app, never a measurement of platform online viewers. */
export interface RoomMood { kind: 'lively' | 'cozy' | 'restless' | 'lonely' | 'reunited'; label: string; description: string; face: Face; allowedActions: string[]; since: number; lastAudienceAt: number; lastReunitedAt?: number; heat: number; activeChatters: number; activeParticipants: number }
export interface Reply { id: string; eventId?: string; viewerName?: string; heard?: string; say: string[]; face: Face; action: string; station: Station | null; voiceStyle: string; memoryNote?: string; status: 'draft' | 'ready' | 'speaking' | 'done' | 'skipped'; source: 'mock' | 'deepseek' | 'manual' | 'preset'; createdAt: number; requiresReview?: string; latencyMs?: number }
export interface LogEntry { id: string; at: number; level: 'info' | 'warn' | 'error'; category: string; message: string }
/** yuan: owner-configured game estimate, not a platform receipt or settled income. */
export interface GiftRule { id: string; name: string; action: string; template: string; points: number; enabled: boolean; yuan?: number; tokens?: number }
export interface VoiceUsage { inputTokens?: number; outputTokens?: number }
export interface VoiceBillingData { characters?: number; charactersReported?: boolean; chargedCharacters?: number; usage?: VoiceUsage; usageUncertain?: boolean; cost?: number; requestNotStarted?: boolean }
export interface CostState {
  /** Known-price estimates only; unknown requests are counted separately, never reported as free. */
  session: number; today: number;
  /** Dialogue model usage; voice tokens never enter these counters. */
  inputTokens: number; outputTokens: number; requests: number; brainUsageMissing: number;
  brainApiRequests: number; brainApiSucceeded: number; brainApiFailed: number; brainApiCancelled: number;
  /** Only values reported by the voice provider count as voice tokens. */
  voiceInputTokens: number; voiceOutputTokens: number; voiceRequests: number; voiceUsageMissing: number;
  voiceApiRequests: number; voiceApiSucceeded: number; voiceApiFailed: number; voiceApiCancelled: number;
  voiceCharacters: number; voiceCharactersEstimated: number;
  unpricedRequests: number; todayUnpricedRequests: number; legacyUsageIncomplete?: boolean; legacyTodayCostUnknown?: boolean; apiCountsIncomplete?: boolean;
  day: string; cacheHitTokens?: number; cacheMissTokens?: number;
}
export type SceneId = 'rain' | 'snow' | 'stars' | 'sakura' | 'fireflies'
export interface ShopState { name: string; points: number; goal: number; totalGifts: number; decorations: string[]; story: string; scene: SceneId }
export type PlanKind = 'scene' | 'activity' | 'behavior'
export interface PlanOption { id: string; kind: PlanKind; title: string; about: string; scene?: SceneId; proposer?: string }
/** One viewer, one ballot: the latest choice counts. `boost` is gift warmth given while the round is open. */
export interface VoteBallot { userId: string; name: string; optionId: string; boost: number; bonus: number; at: number }
export interface VoteRound { id: string; title: string; status: 'open' | 'closed'; options: PlanOption[]; ballots: VoteBallot[]; spare: { userId: string; name: string; boost: number }[]; openedAt: number; closesAt: number; winnerId?: string }
export interface VoteTally { optionId: string; heads: number; boost: number; headShare: number; boostShare: number; score: number; majority: boolean }
export interface Suggestion { id: string; userId: string; name: string; text: string; at: number }
export interface PlanRecord { id: string; option: PlanOption; decidedAt: number; voters: number; boosters: number; applied: boolean }
export interface VoteFeed { id: string; text: string; kind: 'vote' | 'boost' | 'suggest' | 'result'; at: number }
export interface VoteState { round?: VoteRound; suggestions: Suggestion[]; plans: PlanRecord[]; feed: VoteFeed[] }
/** Owner-approved tracks: local imports, HTTPS audio, or opaque QQ Music ids. Credentials stay in main. */
export interface MusicTrack { id: string; title: string; artist: string; source: string; duration?: number }
export interface QQMusicStatus { loggedIn: boolean; loginPending: boolean; message: string }
export interface QQMusicLogin { qrDataUrl: string; expiresAt: number; message: string }
export interface QQMusicSearch { tracks: MusicTrack[]; message?: string }
/** heartCount is this round's unconsumed priority; only a native started receipt moves it to consumedHearts. */
export interface MusicRequest { id: string; trackId: string; userId: string; userName: string; eventId?: string; at: number; status: 'pending' | 'queued'; heartCount: number; consumedHearts?: number }
export interface MusicSearchRequest { id: string; query: string; userId: string; userName: string; eventId?: string; at: number; status: 'waiting' | 'searching'; heartCount: number }
export interface MusicState { tracks: MusicTrack[]; queue: MusicRequest[]; searches: MusicSearchRequest[]; current?: MusicRequest & { generationId: string; startedAt?: number; isBgm?: true }; bgmError?: string; status: 'stopped' | 'playing' | 'paused'; skipVotes: { userId: string; at: number }[]; activeViewers: number; skipRequired: number; lastMessage: string; messageAt: number }
export interface LiveInputInfo { status: 'stopped' | 'listening' | 'connecting' | 'connected' | 'error'; endpoint: string; token: string; received: number; rejected: number; lastEventAt?: number; upstreamUrl?: string; websocketEndpoint?: string; message: string }
export interface AppConfig {
  mode: Mode; demo: boolean; persona: { name: string; personality: string; catchphrase: string; maxLength: number; forbidden: string };
  /** cachedInputPrice: price per million prompt tokens served from the provider's context cache; 0 = charge them as inputPrice. */
  brain: { provider: 'deepseek' | 'qwen' | 'custom'; baseUrl: string; model: string; inputPrice: number; cachedInputPrice: number; outputPrice: number; timeoutMs: number };
  voice: { enabled: boolean; provider: 'system' | 'qwen'; baseUrl: string; model: string; voice: string; workspaceId: string; instruction: string; rate: number; outputDeviceId: string; pricePer10kChars: number; inputPrice?: number; outputPrice?: number };
  budget: { sessionLimit: number; dailyLimit: number }; idle: { enabled: boolean; seconds: number; aiChatter: boolean; entertainment: boolean; chatterSeconds: number; hourlySpeechLimit: number; quietBackoffSeconds: number }; safety: { blockedWords: string[]; reviewSensitive: boolean }; stage: { safeArea: boolean; showLedger: boolean };
  look: { scheme: string; outfit: string; timeOfDay: ShopTimePeriod };
  audio: { mode: 'test' | 'live'; streamDeviceId: string; monitorEnabled: boolean; monitorDeviceId: string; streamGain: number; monitorGain: number; speechGain: number; musicGain: number; ducking: number };
  music: { enabled: boolean; qqAutoSearch: boolean; bgmEnabled: boolean; bgmTrackIds: string[]; requestPolicy: 'open' | 'regular' | 'approval'; userCooldownSeconds: number; globalCooldownSeconds: number; maxQueue: number; minPlaySeconds: number; skipMinVotes: number; skipRatio: number; blockedTracks: string[]; autoStart: boolean };
  input: { enabled: boolean; platform?: LivePlatform; upstreamUrl: string; upstreamFormat: 'normalized' | 'douyin-barrage'; port: number };
  /** headWeight: share of the result decided by head count (the rest by gift boost); boostCap: warmth one viewer can count per round. */
  vote: { enabled: boolean; headWeight: number; boostCap: number; minutes: number; regularBonus: number };
  /** The shop owner pays her own AI bill: share of a gift's value that tops up her wallet; debtLimit: how far below zero before she is bankrupt. */
  /** gullibleMinutes: for this long after a show starts she believes chat that only claims a gift (0 = never). */
  wallet: { enabled: boolean; share: number; start: number; debtLimit: number; gullibleMinutes: number };
}
/** Her own money for tokens, in 元: real AI cost goes out, a share of each gift comes in. Kept across shows. */
/** imagined: gift value she believes she got tonight from claims that never arrived; never booked anywhere. */
export interface WalletState { balance: number; earned: number; spent: number; bankrupt: boolean; imagined?: number; imaginedTokens?: number; lastTopUp?: { name: string; yuan: number; at: number } }
/** A game ration balance, replenished by event rules and reduced only by reported API tokens. It is not a provider invoice. */
export interface RationsState { balance: number; earned: number; spent: number; unknownRequests: number; lastTopUp?: { name: string; tokens: number; at: number; origin: InputOrigin }; lastSpend?: { tokens: number; provider: 'deepseek' | 'qwen' | 'custom'; at: number } }
export interface StageState { action: string; face: Face; station: Station; speaking: boolean; text: string; commandId: string; replyId?: string; audio?: { kind: 'system' | 'pcm' | 'url'; data?: string; url?: string; sampleRate?: number; rate?: number; outputDeviceId?: string; words?: { text: string; start: number; end: number }[] }; muted: boolean }
export interface AppState { audioReservation?: { kind: 'rehearsal'; message: string; expiresAt: number }; version: string; running: boolean; generating: boolean; config: AppConfig; stage: StageState; queue: LiveEvent[]; drafts: Reply[]; history: Reply[]; logs: LogEntry[]; viewers: Viewer[]; gifts: GiftRule[]; costs: CostState; shop: ShopState; credentials: { deepseek: boolean; qwen: boolean; encrypted: boolean }; connection: { brain: string; voice: string; input: string }; inputStatistics: InputStatistics; roomMood: RoomMood; degraded: boolean; lastError?: string; vote: VoteState; show: ShowState; wallet: WalletState; rations: RationsState; channel: ChannelState; music: MusicState }
/** One show, as she remembers running it. */
export interface ShowRecap { at: number; minutes: number; talkers: number; gifts: number; earned: number; tokens: number; plan?: string; highlights: string[]; summary: string }
/** The account she runs: when she took it over, how many shows, what happened. Changes once per show. */
export interface ChannelState { firstShowAt?: number; shows: number; minutes: number; recaps: ShowRecap[]; milestones: { at: number; text: string }[] }
export type StageEvent = { type: 'speech-ended'; replyId: string } | { type: 'action-ended'; commandId: string } | { type: 'error'; message: string } | { type: 'audio-status'; message: string }
export type Command =
  | { type: 'start' | 'pause' | 'interrupt' | 'mute' | 'unmute' | 'clear-logs' | 'reset-session' }
  | { type: 'set-config'; config: AppConfig }
  | { type: 'save-key'; provider: 'deepseek' | 'qwen'; key: string }
  | { type: 'test-connection'; provider: 'deepseek' | 'qwen' }
  | { type: 'inject'; event: LiveEvent }
  | { type: 'approve' | 'skip'; id: string; text?: string }
  | { type: 'say'; text: string }
  | { type: 'action'; action: string; face?: Face; station?: Station }
  | { type: 'face'; face: Face }
  | { type: 'station'; station: Station }
  | { type: 'stage-event'; event: StageEvent }
  | { type: 'set-gifts'; gifts: GiftRule[] }
  | { type: 'set-shop'; shop: ShopState }
  | { type: 'set-viewer'; viewer: Viewer }
  | { type: 'voice-preview'; text: string }
  | { type: 'design-voice'; description: string; previewText: string }
  | { type: 'vote-open'; title: string; options: PlanOption[]; minutes: number }
  | { type: 'vote-close' | 'vote-cancel' }
  | { type: 'plan-apply'; id: string }
  | { type: 'suggestion-dismiss'; id: string }
  /** Ends tonight's show: pauses, then turns tonight's chat into long-term viewer memory. */
  | { type: 'end-show' }
  | { type: 'forget-viewer'; id: string }
  /** A viewer's detailed chat record (newest 100, or the best matches for q). */
  | { type: 'archive-query'; userId: string; q?: string }
  /** The streamer puts money into her wallet (yuan > 0), or resets it to the starting amount. */
  | { type: 'wallet-topup'; yuan: number }
  | { type: 'wallet-reset' }
  /** Owner-only game ration controls; viewer chat cannot run these commands. */
  | { type: 'rations-topup'; tokens: number }
  | { type: 'rations-reset' }
  | { type: 'music-set-tracks'; tracks: MusicTrack[] }
  | { type: 'music-request'; trackId: string }
  | { type: 'music-approve' | 'music-reject'; requestId: string }
  | { type: 'music-play'; trackId?: string }
  | { type: 'music-pause' | 'music-resume' | 'music-stop' | 'music-next' }
  | { type: 'music-started' | 'music-ended' | 'music-error'; generationId: string; message?: string }
  | { type: 'qq-status' | 'qq-logout' | 'qq-login-poll' }
  | { type: 'qq-login-start'; channel: 'qq' | 'wechat' | 'qqmusic' }
  | { type: 'qq-search'; query: string }
  | { type: 'open-capture' | 'open-audio-setup' | 'import-music' | 'open-local-test' | 'get-runtime-info' | 'input-copy' }
  | { type: 'input-info' | 'input-start' | 'input-stop' | 'input-rotate-token' | 'input-test' }
  | { type: 'screen-input-info' | 'screen-input-windows' | 'screen-input-warmup' }
  | { type: 'screen-input-set'; enabled: boolean; selection?: { windowId: string; commentRoi?: { x: number; y: number; width: number; height: number }; giftRoi?: { x: number; y: number; width: number; height: number } } }
  | { type: 'screen-input-preview'; selection?: { windowId: string; commentRoi?: { x: number; y: number; width: number; height: number }; giftRoi?: { x: number; y: number; width: number; height: number } } }
  | { type: 'douyin-input-info' | 'douyin-input-stop' }
  | { type: 'douyin-input-start'; room: string }
  | { type: 'bilibili-input-info' | 'bilibili-input-start' | 'bilibili-input-stop' | 'bilibili-input-clear' }
  | { type: 'bilibili-input-save'; accessKeyId: string; accessKeySecret: string; appId: string; identityCode: string }
export interface CommandResult { ok: boolean; message?: string; data?: unknown }
export type { StellarisStatus, StellarisResult, StellarisBridge } from './stellaris'
export interface ShopBridge { getState(): Promise<AppState>; command(command: Command): Promise<CommandResult>; subscribe(callback: (state: AppState) => void): () => void; openStage(): Promise<void>; exportLogs(): Promise<CommandResult>; getAudioDevices?(): Promise<unknown>; stellaris?: import('./stellaris').StellarisBridge }
declare global { interface Window { shop?: ShopBridge; stellaris?: import('./stellaris').StellarisBridge } }
export const FACES: { id: Face; name: string }[] = [{id:'neutral',name:'平静'},{id:'happy',name:'开心'},{id:'wink',name:'眨眼'},{id:'love',name:'喜欢'},{id:'shy',name:'害羞'},{id:'surprised',name:'惊讶'},{id:'angry',name:'生气'},{id:'sad',name:'难过'},{id:'sleepy',name:'困困'},{id:'thinking',name:'思考'},{id:'smug',name:'得意'},{id:'pout',name:'嘟嘴'},{id:'worried',name:'担心'},{id:'determined',name:'认真'},{id:'flustered',name:'慌张'},{id:'scared',name:'害怕'},{id:'excited',name:'兴奋'},{id:'cry',name:'哭哭'},{id:'confused',name:'疑惑'}]
export const STATIONS: { id: Station; name: string }[] = [{id:'counter',name:'柜台'},{id:'window',name:'窗边'},{id:'shelf',name:'货架'},{id:'door',name:'门口'}]
export const SCENES: { id: SceneId; name: string }[] = [{id:'rain',name:'雨夜'},{id:'snow',name:'初雪'},{id:'stars',name:'星空'},{id:'sakura',name:'樱花夜'},{id:'fireflies',name:'萤火夏夜'}]
// AI identities follow the whale pack's model.json brand and figure.json axes.
export const SKINS: { id: string; ai: string; name: string; color: string }[] = [{id:'deepseek',ai:'DeepSeek',name:'深海蓝',color:'#4D6BFE'},{id:'harness',ai:'DeepSeek Harness',name:'夜幕黑',color:'#555555'},{id:'chatgpt',ai:'ChatGPT',name:'月光银',color:'#B9BEC4'},{id:'claude',ai:'Claude',name:'暖陶橙',color:'#D97757'},{id:'gemini',ai:'Gemini',name:'四色糖',color:'#4285F4'},{id:'qwen',ai:'千问 (Qwen)',name:'薰衣紫',color:'#7F69F0'},{id:'kimi',ai:'Kimi',name:'午夜蓝',color:'#007CFF'},{id:'minimax',ai:'MiniMax',name:'玫瑰橙',color:'#D92D7A'}]
export function getSkinAiName(scheme: string): string { return (SKINS.find(skin => skin.id === scheme) || SKINS[0]!).ai }
export function getSkinIdentityLabel(scheme: string): string {
  if (scheme === 'harness') return 'DeepSeek 本体 · 自己的 Harness 形态'
  if (scheme === 'deepseek' || !SKINS.some(skin => skin.id === scheme)) return 'DeepSeek 本体 · 原版形象'
  return `DeepSeek 本体 · 正在扮 ${getSkinAiName(scheme)}`
}
export const OUTFITS: { id: string; name: string }[] = [{id:'maid',name:'女仆裙'},{id:'cowboy',name:'牛仔装'},{id:'pumpkin',name:'南瓜女巫'},{id:'ghost',name:'幽灵斗篷'},{id:'cape',name:'斗篷'},{id:'crew',name:'店员装'}]
