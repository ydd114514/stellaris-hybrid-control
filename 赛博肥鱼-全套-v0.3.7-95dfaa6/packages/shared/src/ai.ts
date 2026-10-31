/*
 * AI 中枢：服务商、角色分工与共享黑板。
 *
 * - 服务商（AiProvider）只描述接口形态与地址；密钥只在主进程安全存储，永不进入这些结构。
 * - 角色（AiAgentConfig）把一个模型绑到一个职责上：host 场控老师（读弹幕、闲聊吐槽、带玩法），
 *   strategist 游戏参谋（理解局势、定方针）。player 为后续多 AI 群星对战预留：每个帝国一个席位。
 * - 黑板（AiBlackboard）是各角色互通的唯一通道：参谋写局势与方针，场控写观众动向与建议，
 *   每次调用都把对方最新内容带进提示词，所以两边可以用不同厂商的模型。
 */

export type AiProviderKind = 'openai' | 'gemini' | 'anthropic'
export type AiAgentRole = 'host' | 'strategist' | 'player'

export interface AiModelInfo { id: string; name?: string; contextWindow?: number; ownedBy?: string }
/** preset: which built-in template this came from; decides vendor-only request fields such as DeepSeek's thinking switch. */
export interface AiProvider { id: string; name: string; kind: AiProviderKind; preset: string; baseUrl: string; enabled: boolean; models: AiModelInfo[]; modelsFetchedAt?: number }
export interface AiProviderPreset { id: string; name: string; kind: AiProviderKind; baseUrl: string; keyHint: string; suggestedModels: string[] }

export interface AiAgentConfig {
  id: string; role: AiAgentRole; label: string; enabled: boolean
  providerId: string; model: string
  temperature: number; maxTokens: number
  /** Asks the model to reason before answering where the vendor supports a switch; slower and costs more. */
  thinking: boolean
  /** player seats only: which empire this agent commands in a multi-AI match. */
  empire?: string
}

export interface AiDirectorConfig {
  /** Minimum seconds between two host turns; danmaku arriving in between are answered together. */
  replyIntervalSeconds: number
  /** At most this many danmaku go into one host turn; older ones are summarised as a count. */
  batchSize: number
  /** Seconds between strategist reviews of the game snapshot when nothing urgent is queued. */
  strategyIntervalSeconds: number
  /** Hard ceiling on model requests per hour across every agent; protects the bill when chat explodes. */
  maxRequestsPerHour: number
  /** When nobody talks for this long the host may say one line of commentary on the game (0 = never). */
  idleCommentSeconds: number
  /** Streamer's extra instructions for the host, e.g. a running bit or tonight's theme. */
  hostNote: string
  /** Streamer's extra instructions for the strategist, e.g. "tonight we play pacifist". */
  strategyNote: string
}

export interface AiAudienceSuggestion { id: string; name: string; text: string; at: number; status: 'new' | 'adopted' | 'declined' | 'answered'; reply?: string }
export type AiAudienceQueryTopic='government'|'research'|'traditions'|'ascension'|'planet'|'buildings'|'jobs'|'zones'|'military'|'upgrades'
export interface AiAudienceQuery { topic:AiAudienceQueryTopic;entityId?:number }
export type AiAudienceTaskStatus='querying'|'ready'|'unavailable'|'timed_out'|'cancelled'|'answered'
export interface AiAudienceTask {
  id:string;sourceEventId:string;name:string;question:string;createdAt:number;updatedAt:number;status:AiAudienceTaskStatus
  query?:AiAudienceQuery;requestId?:string;runId?:string;gameSessionId?:string;expiresAt?:number;facts?:string;reason?:string
  answer?:string;answerId?:string;answeredAt?:number;answerAttempts?:number;answerDeadline?:number
}
export interface AiAudienceQueryRequest extends AiAudienceQuery { id:string;taskId:string;createdAt:number;expiresAt:number }
export interface AiAudienceQueryBus { version:1;source:'cyberfish-ai-hub';runId:string;gameSessionId:string;updatedAt:number;requests:AiAudienceQueryRequest[] }
/** Public overlay data only; never contains provider settings, keys or internal notes. */
export interface AiAudienceGuidance {
  version: 1; source: 'cyberfish-ai-hub'; updatedAt: number
  status: 'stopped' | 'waiting' | 'collecting' | 'ready'
  summary: string
  items: { id: string; name: string; text: string; status: 'pending' | 'adopted' | 'dismissed' | 'answered'; reply?: string }[]
}
export interface AiBlackboard {
  game: { summary: string; date?: string; threats: string[]; goals: string[]; updatedAt?: number; by?: string }
  plan: { focus: string; nextSteps: string[]; talkingPoint: string; updatedAt?: number; by?: string }
  audience: { mood: string; hotTopics: string[]; suggestions: AiAudienceSuggestion[]; tasks?:AiAudienceTask[]; updatedAt?: number; by?: string }
  /** Short messages one agent leaves for the others; newest first, bounded. */
  notes: { id: string; from: string; to: AiAgentRole | 'all'; text: string; at: number }[]
}

export type AiFeedKind = 'danmaku' | 'host' | 'strategist' | 'directive' | 'system' | 'error'
export interface AiFeedItem { id: string; at: number; kind: AiFeedKind; agentId?: string; name?: string; text: string }
export interface AiUsageTotals { requests: number; failed: number; inputTokens: number; outputTokens: number; usageMissing: number; cachedTokens?:number;cacheWriteTokens?:number;cacheUsageMissing?:number }
export interface AiRoleHealth { consecutiveFailures: number; lastSuccessAt?: number; lastFailureAt?: number; category?: string; httpStatus?: number; message?: string; nextRetryAt?: number; circuitOpen: boolean }
export interface AiSnapshotStatus { state: 'live' | 'stopped' | 'stale' | 'missing' | 'unknown'; observedAt?: number; gameDate?: string }
export interface AiDirectorStatus { running: boolean; message: string; busy: AiAgentRole[]; lastHostAt?: number; lastStrategyAt?: number; pending: number; hourRequests: number; usage: Record<string, AiUsageTotals>; health?: Partial<Record<AiAgentRole,AiRoleHealth>>; snapshot?: AiSnapshotStatus; pendingDropped?: number }

export interface AiHubView {
  basic?: boolean
  localTest: boolean; encrypted: boolean
  providers: (AiProvider & { hasKey: boolean })[]
  presets: AiProviderPreset[]
  agents: AiAgentConfig[]
  director: AiDirectorConfig
  status: AiDirectorStatus
  blackboard: AiBlackboard
  feed: AiFeedItem[]
  overlayUrl?: string
}
export interface AiHubResult { ok: boolean; message?: string; view: AiHubView }
export type AiHubAction =
  | { type: 'save-provider'; provider: Omit<AiProvider, 'models' | 'modelsFetchedAt'> & { models?: AiModelInfo[] } }
  | { type: 'remove-provider'; id: string }
  | { type: 'save-key'; id: string; key: string }
  | { type: 'list-models'; id: string }
  | { type: 'test-agent'; id: string }
  | { type: 'save-agents'; agents: AiAgentConfig[] }
  | { type: 'save-director'; director: AiDirectorConfig }
  | { type: 'start' | 'start-chat' | 'stop' | 'clear-feed' | 'reset-blackboard' | 'copy-overlay' }
  /** The streamer types a line as if it were danmaku, to rehearse the host without a live room. */
  | { type: 'rehearse'; name: string; text: string }
export interface AiHubBridge { view(): Promise<AiHubView>; action(action: AiHubAction): Promise<AiHubResult> }

export const AI_ROLE_LABELS: Record<AiAgentRole, string> = { host: '场控老师', strategist: '游戏参谋', player: '对战席位' }
