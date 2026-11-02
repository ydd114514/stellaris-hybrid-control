export interface CaptainSpeechConfig {
  baseUrl:string;workspaceId:string;model:string;voice:string;rate:number;presetId:string;instruction:string
  narrateGame:boolean;replyAudience:boolean;maxRequestsPerHour:number;volume:number
  gameCommentSeconds?:number
}
export interface CaptainVoiceCheck {
  state:'unchecked'|'checking'|'ready'|'unavailable'|'unknown'
  message:string;checkedAt?:number;httpStatus?:number;errorCode?:string
  serviceStatus?:string;targetModel?:string;voiceMatches?:boolean
}
export type CaptainPlayerRole = 'monitor'|'broadcast'
export interface CaptainSpeechView {
  localTest:boolean;enabled:boolean;hasKey:boolean;encrypted:boolean;message:string;config:CaptainSpeechConfig
  queued:number;current?:{id:string;text:string;kind:'game'|'host';phase:'generating'|'ready'|'playing'}
  usage:{requests:number;completed:number;failed:number;cancelled:number;inputTokens:number;outputTokens:number;missing:number}
  playerUrl?:string;auditionsUrl?:string
  playback?:{playerConnected:boolean;status:'idle'|'playing'|'paused';playerRole?:CaptainPlayerRole}
  voiceCheck?:CaptainVoiceCheck
  tunedVoice?:{ready:boolean;name:string;message:string;duration?:number}
}
export type CaptainSpeechAction = {type:'save-config';config:Partial<CaptainSpeechConfig>}|{type:'save-key';key:string}|{type:'set-commentary-interval';seconds:number}|{type:'read-live-text';text:string}|{type:'start'|'stop'|'auditions'|'query-voice'|'use-tuned-voice'|'open-player'|'close-player'|'play-sample'}
export interface CaptainSpeechBridge {
  view():Promise<CaptainSpeechView>
  action(action:CaptainSpeechAction):Promise<{ok:boolean;message:string;view:CaptainSpeechView}>
}
