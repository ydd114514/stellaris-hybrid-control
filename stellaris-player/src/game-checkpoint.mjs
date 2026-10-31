// The game is an external authoritative state machine. Its current state and
// execution ledger are a stronger memory source than an LLM retelling old turns.
export function makeGameCheckpoint(checkpoint,rows=[]) {
  if(!checkpoint?.state?.snapshotId)throw new Error('Missing current authoritative game checkpoint');
  const intents=new Map(rows.filter(x=>x.type==='intent').map(x=>[x.requestId,x]));
  const decisions=rows.filter(x=>x.type==='intent').slice(-4).map(x=>({purpose:x.explanation,orders:x.orders}));
  const failures=rows.filter(x=>x.type==='rejected'||x.type==='unknown'||x.type==='receipt'&&x.response?.success===false).slice(-8).map(x=>({
    command:x.command,orders:intents.get(x.requestId)?.orders,error:x.error||x.response?.error,status:x.type}));
  return '压缩后先observe取得新的完整状态，再作下一步决定。后面保留的片段可能比下面这份状态早，以新observe为准，不沿用旧snapshotId下单。\n继续正常经营当前同一世界，优先军队、外交和防守，保留真实游戏画面。运行到工具明确时长结束，不提前结束。这里是本机当前真实状态与操作记忆，不是重新开局。先前重复的逐步记录已省略，近期对话仍保留。\n'+
    '以此完整状态为基础理解后续delta：protocol=merge-v2时changes递归合并到已有对象，省略字段保持原值，数组整个替换；null、false、0、[]都是实际新值，removed是明确删除的字段路径数组。每6次或observe返回全量。重要操作前仍须实时核对候选，不盲重试失败或未知指令。去重、失败记录与未知结果保护一直保留。\n'+
    JSON.stringify({sessionId:checkpoint.sessionId,uncertain:checkpoint.uncertain,state:checkpoint.state,recentIntent:decisions,recentFailures:failures});
}

// Keep durable intent and mistakes, not a second full copy of a state that the
// next observe will refresh. The complete state and execution ledger stay local.
export function makeCompactGameCheckpoint(checkpoint,rows=[],maxChars=6000) {
  if(!checkpoint?.state?.snapshotId)throw new Error('Missing current authoritative game checkpoint');
  const clip=(x,n)=>typeof x==='string'?x.slice(0,n):'',s=checkpoint.state;
  const list=x=>Array.isArray(x)?x:[],current=r=>typeof checkpoint.sessionId==='string'&&r?.sessionId===checkpoint.sessionId;
  const budget=x=>Object.fromEntries(Object.entries(x||{}).filter(([k,n])=>/^[a-z_][a-z0-9_]{0,99}$/.test(k)&&Number.isFinite(n)&&n>=0).slice(0,4));
  const colonies=[...list(s.colonyControl?.records),...list(s.colonyUpgradeControl?.records)].filter(current).filter(r=>['active','waiting','blocked','paused'].includes(r.status)).slice(0,2).map(r=>({planetId:r.planetId,status:clip(r.status,30),goal:clip(r.goal,100),remainingBudget:budget(r.remainingBudget),reviewRequired:r.reviewRequired===true,pending:list(r.actions).filter(a=>['issued','unknown','queued'].includes(a.status)).slice(0,2).map(a=>({requestId:clip(a.requestId,100),status:clip(a.status,30),queueItemId:a.queueItemId}))}));
  const delegationMemory={observedOnly:true,automaticResume:false,controllerStopped:checkpoint.stopped===true,
    monthly:list(s.monthlyControl?.records).filter(current).filter(r=>!r.released).slice(0,4).map(r=>({requestId:clip(r.requestId,100),status:clip(r.status,40),orderId:r.orderId,reservation:budget(r.reservation)})),
    oldMonthly:list(s.monthlyControl?.recovery?.records).slice(0,2).map(r=>({previousSessionId:clip(r.sessionId,100),requestId:clip(r.requestId,100),status:clip(r.status,40)})),colonies};
  const order=x=>({command:clip(x?.command,60),arguments:Object.fromEntries(Object.entries(x?.arguments||{}).slice(0,10).filter(([,v])=>typeof v==='number'||typeof v==='boolean'||typeof v==='string'||Array.isArray(v)&&v.length<=4&&v.every(x=>Number.isSafeInteger(x))).map(([k,v])=>[k,typeof v==='string'?clip(v,100):v]))});
  const intentRows=rows.filter(x=>x.type==='intent'),intents=new Map(intentRows.map(x=>[x.requestId,x]));
  const seen=new Set(),failures=[];
  for(const x of rows.slice().reverse())if(x.type==='rejected'||x.type==='unknown'||x.type==='receipt'&&x.response?.success===false){const key=JSON.stringify([x.command,x.error||x.response?.error,intents.get(x.requestId)?.orders]);if(seen.has(key))continue;seen.add(key);failures.push({requestId:clip(x.requestId,100),status:x.type,command:clip(x.command,60),error:clip(x.error||x.response?.error,150),orders:intents.get(x.requestId)?.orders?.slice(0,2).map(order)});if(failures.length===4)break;}
  const country=checkpoint.countryAIControl??s.countryAIControl;
  const nativeMemory=country?.enabled===true?{countryAIControl:{observedOnly:true,automaticResume:false,
    owner:['native','human','unconfirmed','unmanaged_native_ai'].includes(country.owner)?country.owner:'unconfirmed',
    nativePhase:clip(country.nativePhase,40),generation:Number.isSafeInteger(country.generation)?country.generation:null,
    ordinaryOrdersBlocked:country.ordinaryOrdersBlocked===true,paused:typeof country.paused==='boolean'?country.paused:null,
    domains:list(country.domains).filter(x=>['research','planet_construction'].includes(x)),reviewDue:country.reviewDue===true}}:{};
  const record={...nativeMemory,version:2,sessionId:clip(checkpoint.sessionId,100),uncertain:!!checkpoint.uncertain,refreshRequired:true,
    lastObserved:{date:clip(s.date,20),player:clip(s.player?.name,90),colonies:s.capacities?.colonies,warCount:s.wars?.length||0,pendingEvents:(s.pendingEvents||[]).slice(0,3).map(x=>clip(x.title,60))},
    recentIntent:intentRows.slice(-2).map(x=>({requestId:clip(x.requestId,100),purpose:clip(x.explanation,100),...(x.strategicResearchOverride===true?{strategicResearchOverride:true}:{}),orders:x.orders?.slice(0,3).map(order)})),recentFailures:failures,delegationMemory};
  const prefix=(country?.enabled===true?'v1.4：日常科研与建设交原生国家 AI。先核对当前持权，不把旧记录当新授权；关键干预先确认 takeover，再按需战略干预并 resume，托管时不逐条经营或恢复旧战役。':'' )+'继续当前同一局；这是本机持久记忆，不是新开局。压缩后必须先 observe 读取完整最新状态，再按当前真实候选操作；下面是旧意图、错误和委派请求索引，不包含可下单的 snapshotId。执行结果以本机账本和实时回读为准，未知结果不盲重发；原去重与失败保护不变。持久请求先按原requestId核对，不把旧委派当成新授权。所有任务已排好时按watch工具公布上限等待，控制器核对实际工作后决定窗口，不重复inspect或取消队列。\n';
  while(prefix.length+JSON.stringify(record).length>maxChars){if(record.recentIntent.length)record.recentIntent.shift();else if(record.recentFailures.length)record.recentFailures.pop();else if(delegationMemory.oldMonthly.length)delegationMemory.oldMonthly.pop();else if(delegationMemory.colonies.length)delegationMemory.colonies.pop();else if(delegationMemory.monthly.length)delegationMemory.monthly.pop();else break;}
  return prefix+JSON.stringify(record);
}
