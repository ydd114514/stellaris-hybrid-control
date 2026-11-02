export interface ControllerWorld {
 pid:number;creationTime:string;generation:number;country:number;capital:number;day:number
}
const day=(text:unknown)=>{
 const m=typeof text==='string'?/^(\d{4,})\.(\d{2})\.(\d{2})$/.exec(text):null
 return m&&+m[2]>=1&&+m[2]<=12&&+m[3]>=1&&+m[3]<=30?+m[1]*360+(+m[2]-1)*30+ +m[3]-1:null
}
/** A controller UUID is not a save/world identity. Unknown fields never match. */
export function controllerWorld(snapshot:any):ControllerWorld|undefined{
 const binding=snapshot?.binding,state=snapshot?.state,player=state?.player,generation=state?.nativeWorldGeneration
 const observed=day(state?.date)
 if(!Number.isSafeInteger(binding?.pid)||binding.pid<=0||typeof binding.creationTime!=='string'||!/^\d{1,30}$/.test(binding.creationTime)||
  !Number.isSafeInteger(generation)||generation<0||!Number.isSafeInteger(player?.country_id)||player.country_id<0||
  !Number.isSafeInteger(player?.capital_system_id)||player.capital_system_id<0||observed===null)return
 const runtime=snapshot.runtimeStatus,liveDay=runtime?.sessionId===snapshot.sessionId?day(runtime.date):null
 return {pid:binding.pid,creationTime:binding.creationTime,generation,country:player.country_id,capital:player.capital_system_id,
  day:liveDay===null?observed:Math.max(observed,liveDay)}
}
export function sameControllerWorld(previous:ControllerWorld|undefined,current:ControllerWorld|undefined):boolean{
 return !!previous&&!!current&&previous.pid===current.pid&&previous.creationTime===current.creationTime&&
  previous.generation===current.generation&&previous.country===current.country&&previous.capital===current.capital&&current.day>=previous.day
}
