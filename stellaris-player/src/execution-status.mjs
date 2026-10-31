// Separate live execution facts from the complete decision snapshot. A heartbeat
// must not turn old resource/research values into a new authoritative snapshot.
export function executionStatus(checkpoint,now=Date.now()){
 const state=checkpoint?.state||{},live=checkpoint?.runtimeStatus;
 if(checkpoint?.stopped&&typeof checkpoint.cleanup?.paused==='boolean')return {known:true,paused:checkpoint.cleanup.paused,date:checkpoint.cleanup.date||state.date,source:'cleanup'};
 if(live!==undefined){
  const age=now-live?.observedAt;
  const known=live?.sessionId===checkpoint?.sessionId&&typeof live?.paused==='boolean'&&Number.isFinite(live?.observedAt)&&age>=0&&age<=10000;
  return {known,paused:known?live.paused:null,date:known&&typeof live.date==='string'?live.date:state.date,source:known?'live':'unknown'};
 }
 return {known:typeof state.paused==='boolean',paused:typeof state.paused==='boolean'?state.paused:null,date:state.date,source:'snapshot'};
}
