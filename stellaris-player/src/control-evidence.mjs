const read=method=>method==='ping'||/^(get_|find_)/.test(method);
export function rpcEvidenceCategory(method,params={}) {
 if(['country_ai_lease','country_ai_observation','country_ai_routine_gate'].includes(method)&&params.action==='status')return 'read';
 if(method==='country_ai_lease')return params.action==='stop'||params.action==='reclaim_changed_world'?'cleanup':'control';
 if(read(method))return 'read';
 if(method==='set_survey_automation'&&params.execute!==true)return 'validation';
 if(method==='set_monthly_trade'&&params.cancel===true)return 'cleanup';
 if(method==='set_paused'&&params.paused===true||method==='set_survey_automation'&&params.enabled===false)return 'cleanup';
 if(['focus_fleet','focus_planet','show_panel'].includes(method))return 'presentation';
 if(method==='set_paused'||method==='set_speed')return 'control';
 return 'work';
}
const time=row=>Date.parse(row?.at);

// Measurements describe these logs only. Missing samples or request telemetry
// never become a zero, and sampled intervals are not exact engine pause times.
export function analyzeControlEvidence(events,{maxSampleGapMs=5000}={}) {
 if(!Number.isFinite(maxSampleGapMs)||maxSampleGapMs<=0)throw Error('采样间隔上限无效');
 const meta=events.find(r=>r.type==='session_meta'&&r.evidenceVersion===1);
 const stop=events.find(r=>r.type==='stop_requested');
 const end=events.findLast(r=>r.type==='stop');
 const writes=events.filter(r=>r.type==='rpc_write');
 const samples=events.filter(r=>r.type==='runtime_sample'&&r.afterStop!==true&&Number.isFinite(time(r))&&(!stop||time(r)<=time(stop))).sort((a,b)=>time(a)-time(b));
 const intervals={runningMs:0,pausedMs:0,uncertainMs:0,unobservedGapMs:0,slowResponsePausedMs:0};
 const pauses=events.filter(r=>r.type==='decision_guard_pause'&&Number.isFinite(time(r))).sort((a,b)=>time(a)-time(b));
 for(let i=1;i<samples.length;i++){
  const a=samples[i-1],b=samples[i],duration=time(b)-time(a);
  if(duration>maxSampleGapMs){intervals.unobservedGapMs+=duration;continue;}
  if(typeof a.paused!=='boolean'||typeof b.paused!=='boolean'||a.paused!==b.paused){intervals.uncertainMs+=duration;continue;}
  intervals[a.paused?'pausedMs':'runningMs']+=duration;
  const cause=pauses.findLast(r=>time(r)<=time(a));
  // Do not attach an old pause reason to a later pause after a running sample.
  const lastRunning=samples.slice(0,i).findLast(r=>r.paused===false);
  if(a.paused&&cause?.reasons?.includes('model_response_slow')&&(!lastRunning||time(cause)>=time(lastRunning)))intervals.slowResponsePausedMs+=duration;
 }
 const sequences=writes.map(r=>r.sequence).sort((a,b)=>a-b);
 const contiguous=sequences.every((value,index)=>value===index+1)&&sequences.length===end?.controlEvidence?.lastWriteSequence;
 const stopBoundary=Number.isSafeInteger(stop?.lastWriteSequence)&&stop.lastWriteSequence>=0&&stop.lastWriteSequence<=sequences.length&&writes.every(r=>r.afterStop===(r.sequence>stop.lastWriteSequence));
 const complete=!!meta?.writeBoundaryObserved&&end?.controlEvidence?.incomplete===false&&contiguous&&stopBoundary;
 return {sessionId:meta?.sessionId??null,mode:meta?.mode??null,watchMaximumSeconds:[20,60,90].includes(meta?.watchMaximumSeconds)?meta.watchMaximumSeconds:null,bridgeVersion:meta?.bridgeVersion??null,
  featureFlags:['colonyUpgrade','monthlyLifecycle','localWait'].every(key=>typeof meta?.featureFlags?.[key]==='boolean')?Object.fromEntries(['colonyUpgrade','monthlyLifecycle','localWait'].map(key=>[key,meta.featureFlags[key]])):null,
  durationMs:meta&&end&&Number.isFinite(time(meta))&&Number.isFinite(time(end))?time(end)-time(meta):null,
  writeBoundaryComplete:complete,
  writeAttempts:meta?.writeBoundaryObserved?writes.reduce((a,r)=>(a[r.category]=(a[r.category]||0)+1,a),{}):null,
  forbiddenWritesAfterStop:complete&&stop?writes.filter(r=>r.afterStop===true&&r.category!=='cleanup').length:null,
  sampledIntervals:samples.length>1?{...intervals,spanMs:time(samples.at(-1))-time(samples[0]),samples:samples.length}:null,
  modelRequests:null,tokens:null,cost:null,completedWork:null,
  limitations:['原生RPC调用不是模型请求；模型请求、tokens、费用及完成工作量需要独立证据。','暂停时长按同状态相邻采样区间估计，状态转换区间与超过采样上限的缺口单列。','运行段时长包含初始化和停止清理，不能当作有效任务时长。','无工作完成或同条件存档证据时，不计算效率提升。']};
}
