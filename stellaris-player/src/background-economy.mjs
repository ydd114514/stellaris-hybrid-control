const finite = x => Number.isFinite(x) ? x : null;
const core = ['energy','minerals','food','consumer_goods','alloys','unity'];

/** File-only observation: never competes with the controller's game pipe. */
export function backgroundEconomyStatus(checkpoint, {now=Date.now(),controllerActive=false}={}) {
 const cp=checkpoint??{},state=cp.state??{};
 // Full observations and actual economic reads have separate timestamps. A
 // runtime heartbeat alone cannot make cached resource values look current.
 const economicAt=Number.isFinite(state.economyObservedAt)?state.economyObservedAt:cp.observedAt;
 const age=Number.isFinite(economicAt)?now-economicAt:null;
 const fresh=controllerActive&&cp.stopped===false&&age!==null&&age>=0&&age<=90000;
 const resources=Object.fromEntries(core.map(key=>{
  const r=state.resources?.[key]??{};
  const net=fresh&&r.net_known!==false?finite(r.net):null;
  const stockpile=fresh&&r.stockpile_known!==false?finite(r.stockpile):null;
  return [key,{net,stockpile,income:fresh?finite(r.income):null,expense:fresh&&r.expense_known!==false?finite(r.expense):null,
   monthsToEmpty:net!==null&&net<0&&stockpile!==null?Math.max(0,stockpile)/-net:null}];
 }));
 const progress=fresh?state.strategy?.unityProgress:null;
 const alerts=[];
 for(const [key,r]of Object.entries(resources))if(r.monthsToEmpty!==null&&r.monthsToEmpty<=6)alerts.push({kind:'resource_shortage',resource:key,months:r.monthsToEmpty});
 if(progress?.known){
  if(progress.stagnating)alerts.push({kind:'unity_stagnating',reasons:progress.reasons??[]});
  if(progress.scalingBehind)alerts.push({kind:'unity_scaling_behind',reasons:progress.reasons??[]});
  if(progress.maintenancePressure)alerts.push({kind:'unity_maintenance',share:progress.maintenanceShare});
 }
 if(controllerActive&&cp.stopped===false&&!fresh)alerts.push({kind:'data_stale',ageMs:age});
 return {version:1,observedAt:now,live:fresh,phase:!controllerActive?'waiting':fresh?(state.paused?'paused':'running'):'waiting_for_data',
  sessionId:fresh?cp.sessionId:null,date:fresh?state.date:null,lastRecordedDate:state.date??null,sourceObservedAt:fresh?economicAt:null,
  resources,unityProgress:progress??null,
  expansionHealth:fresh?state.strategy?.expansionHealth??null:null,
  colonyAudit:fresh?state.colonyAudit??null:null,
  colonies:fresh?{owned:state.growth?.colonies??state.colonyAudit?.totalColonies??null,systems:state.player?.owned_systems??null}:null,
  strategyContract:fresh?cp.strategyContract??state.strategyContract??null:null,
  advice:fresh?{tasks:(state.adviceExecution?.tasks??[]).slice(0,64).map(t=>({id:t.id,text:t.text,status:t.status,reason:t.reason,evidence:t.evidence}))}:null,
  alerts};
}

/** An explicit stop is sticky; a dead helper must never restart paid work. */
export function mayStartBackgroundController({settings,gamePid,controllerActive,stopAt=0}) {
 return settings?.armed===true&&Number.isFinite(settings.requestedAt)&&Number.isSafeInteger(gamePid)&&gamePid>0&&
  !controllerActive&&stopAt<settings.requestedAt&&settings.attemptedGamePid!==gamePid;
}
