export type StellarisPhase = 'stopped' | 'starting' | 'running' | 'waiting' | 'attention' | 'stopping' | 'error' | 'unavailable'
export type StellarisOrderPhase='submitted'|'queued'|'executing'|'completed'|'failed'|'expired_unknown'
export interface StellarisOrderTracking {counts:Partial<Record<StellarisOrderPhase,number>>;recent:{id:string;command:string;status:StellarisOrderPhase;reason?:string;updatedAt?:number}[]}
export interface StellarisQuality {
  status:'observed'|'unknown';at?:number;reason?:string;source?:'local_obs'
  stats?:{activeFps?:number;averageFrameRenderTime?:number;renderSkippedFrames?:number;renderTotalFrames?:number;outputSkippedFrames?:number;outputTotalFrames?:number}
  stream?:{active:boolean;reconnecting:boolean;outputDuration?:number;outputBytes?:number;outputSkippedFrames?:number;outputTotalFrames?:number;outputCongestion?:number}
  record?:{active:boolean;outputDuration?:number;outputBytes?:number}
  audioIsolation:'not_measured';viewerLatency:'not_measured'
}
export interface StellarisStatus {
  phase: StellarisPhase
  message: string
  canStart: boolean
  canStop: boolean
  hybrid?: {surveyEnabled:boolean;nativeCountryAIEnabled?:boolean;configurationKnown:boolean;message?:string}
  director?:{mode:'auto'|'fixed';active:boolean;topic:string;blocked:string;galaxyRemainingSeconds:number;galaxyOverdue:boolean}
  projectDirectory?: string
  pid?: number
  snapshot?: { countryAI?:{owner:'human'|'native'|'unconfirmed';historical:boolean;domains:string[];message:string;steering?:{economyFocus:string;expansionStance:string;militaryStance:string}|null;lastStrategyReason?:string;blockedCommands?:number;reviewDue:boolean}; campaign?:{phase:string;active:boolean;goal:string;battleObserved:boolean;occupationObserved:boolean;gainKnown:boolean;gainedPlanets:number|null;gainedSystems?:number|null;warEnded:boolean;nextReviewRequired:boolean;needsAttention?:string}; date: string; at: number; orders: number; verified: number; colonies: number; ships: number; alloysNet?: number; pendingEvents: number;orderTracking?:StellarisOrderTracking;quality?:StellarisQuality;survey?:{assigned:number;working:number;uncertain:number};work?:{monthlyRegistered:number;monthlyUncertain:number;monthlyRecoveryRequired?:number;monthlyLifecyclePilotEnabled?:boolean;monthlyConditional?:number;monthlyPolicyCompleted?:number;localColonies:number;colonyPaused?:number;colonyQueued:number;colonyBlocked:number;colonyRetainedQueues?:number;upgradeRetainedQueues?:number;upgradePilotEnabled?:boolean;upgradeColonies?:number;upgradeQueued?:number;upgradeBlocked?:number;stopped:boolean} }
  localTest?: boolean
  engine?: { name: string; version: string; entrypoint: string; mode: 'headless'; pid?: number }
}
export interface StellarisResult { ok: boolean; message?: string; status: StellarisStatus }
export interface StellarisBridge {
  getStatus(): Promise<StellarisStatus>
  start(): Promise<StellarisResult>
  stop(): Promise<StellarisResult>
  setHybridSurvey?(enabled:boolean): Promise<StellarisResult>
  setNativeCountryAI?(enabled:boolean): Promise<StellarisResult>
  presentationMode?(mode?:'auto'|'fixed'):Promise<'auto'|'fixed'>
  chooseProject(): Promise<StellarisResult>
  saveGameKey?(key: string): Promise<StellarisResult>
  music?: {
    view(): Promise<StellarisMusicView>
    action(action: 'connect'|'login'|'poll'|'start'|'stop'|'add'|'remove'|'volume'|'next'|'blacklist'|'queueLimit', value?: string|number): Promise<{ok:boolean;message:string;view:StellarisMusicView;login?:import('./index').QQMusicLogin}>
    feedback(generation: string, kind: 'started'|'ended'|'error'): Promise<void>
  }
  live?: {
    info(): Promise<StellarisLiveInfo>
    action(action: 'prepare' | 'start' | 'stop' | 'test' | 'preview' | 'copyOverlay' | 'copyInput' | 'exportObs' | 'connectRoom' | 'disconnectRoom' | 'loginBilibili', value?:string): Promise<StellarisLiveResult>
  }
  ai?: import('./ai').AiHubBridge
  speech?: import('./stellaris-speech').CaptainSpeechBridge
}
export interface StellarisMusicView {
  localTest:boolean; enabled:boolean; volume:number; maxQueue?:number; account:import('./index').QQMusicStatus;
  state:import('./index').MusicState; bgmTrackIds:string[];blacklist:string[];builtInBlacklist:string[];reviewedLibraryOnly:boolean
}
export interface StellarisLiveInfo {
  localTest: boolean
  ready: boolean
  previewUrl: string
  overlayUrl: string
  bilibili?: {status:string;roomId?:number;loggedIn:boolean;message:string;received:number;lastEventAt?:number;lastHeartbeatAt?:number}
  input: { status: string; message: string; received: number; rejected: number; endpoint: string; lastEventAt?: number }
}
export interface StellarisLiveResult { ok: boolean; message?: string; info: StellarisLiveInfo }
