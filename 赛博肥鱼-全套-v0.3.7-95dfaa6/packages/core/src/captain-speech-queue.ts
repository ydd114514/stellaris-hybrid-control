import {spokenText} from './stellaris-captain'
export interface SpeechLine{id:string;text:string;kind:'game'|'host';at:number}
export function createCaptainSpeechQueue(now=Date.now){
  let lines:SpeechLine[]=[];const seen=new Set<string>();let lastGame='',lastGameAt=0,hostsInARow=0
  return {
    push(line:SpeechLine){
      const text=spokenText(line.text,line.kind==='host'?140:100),age=now()-line.at
      if(!text||age>30000||age< -5000||seen.has(line.id))return false
      seen.add(line.id);if(seen.size>2000)seen.delete(seen.values().next().value!)
      if(line.kind==='game'&&lastGame===text&&now()-lastGameAt<60000)return false
      if(line.kind==='game'){lastGame=text;lastGameAt=now();lines=lines.filter(x=>x.kind!=='game')}
      lines.push({...line,text});lines=lines.slice(-8);return true
    },
    take(){lines=lines.filter(x=>now()-x.at<=30000);const host=lines.findIndex(x=>x.kind==='host'),game=lines.findIndex(x=>x.kind==='game'),i=hostsInARow>=2&&game>=0?game:host>=0?host:0;const line=lines.splice(i,1)[0];if(line)hostsInARow=line.kind==='host'?hostsInARow+1:0;return line},
    size(){return lines.filter(x=>now()-x.at<=30000).length},
    clear(){lines=[];seen.clear();lastGame='';lastGameAt=0;hostsInARow=0},
  }
}
