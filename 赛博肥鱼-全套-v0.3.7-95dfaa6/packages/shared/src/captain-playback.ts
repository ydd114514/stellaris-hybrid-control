/** Only confirmed media playback supplies audience-facing subtitles. */
export interface CaptainPlayback {
  version:1;sessionId:string;sequence:number;enabled:boolean;status:'idle'|'playing'|'paused';at:number
  id?:string;text?:string;kind?:'game'|'host'
}
