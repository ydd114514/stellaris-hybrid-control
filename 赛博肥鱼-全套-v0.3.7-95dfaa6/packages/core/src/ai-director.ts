/*
 * 场控编排：把弹幕、游戏快照和两位 AI 同事串起来。
 *
 * - 弹幕先排队，按间隔成批交给场控老师；观众的玩法建议进黑板，参谋尽快评估，结论下一轮由场控公布。
 * - 参谋按固定间隔复盘快照（快照没变就不花钱），有待判断的观众建议时提前。
 * - 每小时请求总数有硬上限；停止会中止在途请求，迟到的结果按代次丢弃，不会在停止后继续说话。
 * - 不直接接触密钥和网络：调用模型由宿主注入，测试全部离线。
 */
import type { AiAgentConfig, AiAgentRole, AiBlackboard, AiDirectorConfig, AiDirectorStatus, AiFeedItem, AiUsageTotals, AiRoleHealth, AiSnapshotStatus,AiAudienceTask,AiAudienceQueryBus } from '../../shared/src/ai'
import type { LiveEvent } from '../../shared/src/index'
import { addNote, addSuggestion, applyHost, applyStrategist, clip, createBlackboard, pendingSuggestions } from './ai-blackboard'
import type { AiChatResult, AiMessage } from './ai-providers'
import { AiProviderError, aiFailure, parseJsonObject } from './ai-providers'
import {safePublicGameText} from './public-game-text'
import { digestSnapshot, hostMessages, strategistMessages, type Danmaku } from './ai-prompts'
import {captainMessages,qualifyCaptainReply} from './stellaris-captain'
import type {ConversationLine} from './stellaris-community'
import {answerable,cancelAudienceTasks,createAudienceTask,queryBus,syncAudienceTasks} from './audience-query-tasks'

export const DEFAULT_DIRECTOR: AiDirectorConfig = { replyIntervalSeconds: 8, batchSize: 12, strategyIntervalSeconds: 180, maxRequestsPerHour: 240, idleCommentSeconds: 150, hostNote: '', strategyNote: '' }
export function normalizeDirector(value: any): AiDirectorConfig {
  const n = (v: unknown, min: number, max: number, fallback: number) => typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, Math.round(v))) : fallback
  return { replyIntervalSeconds: n(value?.replyIntervalSeconds, 3, 120, DEFAULT_DIRECTOR.replyIntervalSeconds), batchSize: n(value?.batchSize, 1, 40, DEFAULT_DIRECTOR.batchSize),
    strategyIntervalSeconds: n(value?.strategyIntervalSeconds, 30, 3600, DEFAULT_DIRECTOR.strategyIntervalSeconds), maxRequestsPerHour: n(value?.maxRequestsPerHour, 10, 3000, DEFAULT_DIRECTOR.maxRequestsPerHour),
    idleCommentSeconds: n(value?.idleCommentSeconds, 0, 3600, DEFAULT_DIRECTOR.idleCommentSeconds), hostNote: clip(value?.hostNote, 600), strategyNote: clip(value?.strategyNote, 600) }
}

export interface Spoken { id: string; to: string; text: string; at: number; agentId: string;taskId?:string }
export interface Directive { id: string; priority: 'low' | 'normal' | 'high'; text: string; at: number; agentId: string; focus: string; nextSteps: string[]; gameSessionId?: string; targetResource?: string }
export interface DirectorDeps {
  now?: () => number
  agents(): AiAgentConfig[]
  config(): AiDirectorConfig
  /** Runs one agent's request. The host owns keys, providers and network. */
  call(agent: AiAgentConfig, messages: AiMessage[], signal: AbortSignal): Promise<AiChatResult>
  readSnapshot(): Promise<unknown>
  board?: AiBlackboard
  onFeed?(item: AiFeedItem): void
  onSay?(lines: Spoken[],canPublish?:()=>boolean): unknown
  readQueryResults?():Promise<unknown>
  onQueries?(bus:AiAudienceQueryBus):unknown
  onDirective?(directive: Directive): void
  onChange?(): void
}

const MUSIC = /^\s*(点歌|切歌|下一首|播放)/
const STRATEGIST_URGENT_GAP = 20000
const LINK = /(https?:\/\/|www\.|\.com\b|\.cn\b|qq群|vx|微信号)/i

export function createDirector(deps: DirectorDeps) {
  const now = deps.now || Date.now
  const board = deps.board || createBlackboard()
  let running = false, generation = 0, message = '场控未启动。', counter = 0
  let lastHostAt = 0, lastStrategyAt = 0, lastAudienceAt = 0, lastIdleAt = 0, lastSignature = '', announce = false
  let hostHasStarted=false
  const pending: Danmaku[] = [], seen = new Set<string>(), talkers = new Set<string>()
  const busy = new Map<AiAgentRole, AbortController>(), requests: number[] = [], recent: string[] = []
  const conversation: ConversationLine[] = []
  const speakerIds = new Map<string,string>()
  const speakerIdFor = (key:string) => {
    let value = speakerIds.get(key)
    if (!value) { value = id('viewer'); speakerIds.set(key,value); if(speakerIds.size>500) speakerIds.delete(speakerIds.keys().next().value!) }
    return value
  }
  function remember(line:ConversationLine) {
    conversation.push(line)
    while(conversation.length>32 || (conversation.length && now()-conversation[0]!.at>180000))conversation.shift()
  }
  const usage: Record<string, AiUsageTotals> = {}, feed: AiFeedItem[] = []
  const health: Partial<Record<AiAgentRole,AiRoleHealth>> = {}
  let snapshotStatus: AiSnapshotStatus = {state:'missing'}, pendingDropped=0
  let queryRunId='',queryPublishing=Promise.resolve()
  let tickInFlight:Promise<void>|undefined
  const id = (prefix: string) => `${prefix}-${now().toString(36)}-${(++counter).toString(36)}`
  const pick = (role: AiAgentRole) => deps.agents().find(a => a.role === role && a.enabled && a.providerId && a.model)

  function post(kind: AiFeedItem['kind'], text: string, extra: Partial<AiFeedItem> = {}) {
    const item = { id: id('f'), at: now(), kind, text: clip(text, 400), ...extra }
    feed.unshift(item); feed.length = Math.min(feed.length, 200)
    deps.onFeed?.(item)
  }
  const changed = () => deps.onChange?.()

  function feedEvent(event: LiveEvent) {
    if (!event?.id || seen.has(event.id)||(board.audience.tasks??[]).some(t=>t.sourceEventId===event.id)) return false
    seen.add(event.id); if (seen.size > 5000) seen.delete(seen.values().next().value!)
    if (event.kind === 'like' || event.kind === 'enter') return false
    const text = clip(event.text, 120)
    if (event.kind === 'chat' && (!text || MUSIC.test(text))) return false
    const name = clip(event.user?.name, 20) || '匿名观众'
    const firstVisit = event.kind === 'chat' && !talkers.has(event.user?.id || name)
    if (event.kind === 'chat') talkers.add(event.user?.id || name)
    pending.push({ id: event.id, name, speakerId:speakerIdFor(event.user?.id || name), text, at: event.at || now(), kind: event.kind, firstVisit, gift: clip(event.giftName || event.claimed?.gift, 20) || undefined, count: event.count })
    if (pending.length > 200) pendingDropped+=pending.splice(0, pending.length - 200).length
    lastAudienceAt = now()
    if (event.kind === 'chat') post('danmaku', text, { name })
    changed()
    return true
  }

  function allow() {
    const t = now()
    while (requests.length && t - requests[0]! > 3600000) requests.shift()
    if (requests.length >= deps.config().maxRequestsPerHour) { message = `本小时已用满 ${deps.config().maxRequestsPerHour} 次请求，暂停调用模型，弹幕继续排队。`; return false }
    requests.push(t); return true
  }
  function account(agent: AiAgentConfig, result?: AiChatResult, failed = false) {
    const u = usage[agent.id] ||= { requests: 0, failed: 0, inputTokens: 0, outputTokens: 0, usageMissing: 0,cachedTokens:0,cacheWriteTokens:0,cacheUsageMissing:0 }
    u.requests++
    if (failed) { u.failed++; u.usageMissing++; return }
    if (result?.usage.inputTokens === undefined || result.usage.outputTokens === undefined) u.usageMissing++
    u.inputTokens += result?.usage.inputTokens ?? 0; u.outputTokens += result?.usage.outputTokens ?? 0
    u.cachedTokens=(u.cachedTokens??0)+(result?.usage.cachedTokens??0);u.cacheWriteTokens=(u.cacheWriteTokens??0)+(result?.usage.cacheWriteTokens??0)
    if(result?.usage.cachedTokens===undefined)u.cacheUsageMissing=(u.cacheUsageMissing??0)+1
  }
  function observeSnapshot(value:unknown) {
    const snapshot=value && typeof value==='object'?value as {stopped?:boolean;observedAt?:number;state?:{date?:string}}:undefined
    const observedAt=Number.isFinite(snapshot?.observedAt)?snapshot!.observedAt:undefined
    snapshotStatus={state:!snapshot?.state?'missing':snapshot.stopped?'stopped':observedAt===undefined?'unknown':now()-observedAt>60000?'stale':'live',...(observedAt!==undefined?{observedAt}:{}),...(typeof snapshot?.state?.date==='string'?{gameDate:snapshot.state.date}:{})}
  }
  const roleReady=(role:AiAgentRole)=>!health[role]?.circuitOpen && now()>=(health[role]?.nextRetryAt??0)
  function publishQueries(snapshot:unknown) {
    const bus=queryBus(board,queryRunId,snapshot,now())
    queryPublishing=queryPublishing.catch(()=>{}).then(async()=>{await deps.onQueries?.(bus)})
    return queryPublishing
  }
  async function updateTasks(snapshot:unknown) {
    const ticket=generation,runId=queryRunId
    let results:unknown;try{results=await deps.readQueryResults?.()}catch{/* Timeout closes missing results. */}
    if(!running||ticket!==generation)return
    const changedTasks=syncAudienceTasks(board,{snapshot,results,runId,now:now(),requestId:()=>id('query')})
    try{await publishQueries(snapshot)}catch{
      if(ticket!==generation)return
      for(const task of board.audience.tasks??[])if(task.status==='querying'&&task.runId===runId){task.status='unavailable';task.reason='transport_error';task.updatedAt=now();task.answerDeadline=now()+60000}
      post('error','只读查询入口暂不可用，相关问题将明确回复无法确认。')
    }
    if(changedTasks)changed()
  }
  function fallbackAnswer(task:AiAudienceTask) {
    const reason=task.reason
    return reason==='stopped'?'现在游戏状态没有更新，这项信息暂时无法确认。':reason==='expired'?'这次查询超时了，暂时无法确认这项信息。':reason==='invalid_entity'?'暂时无法确认你指的是哪颗己方星球，这次先不猜。':reason==='queue_full'?'这轮待查问题较多，暂时没能完成这项查询。':'这次没能可靠回答这个问题，先不报未经确认的结论。'
  }
  async function publishLines(lines:Spoken[],ticket:number) {
    if(!lines.length||!running||generation!==ticket)return
    let publicSnapshot:unknown;try{publicSnapshot=await deps.readSnapshot()}catch{}
    if(!running||generation!==ticket)return
    lines=lines.map(line=>line.taskId?line:{...line,text:qualifyCaptainReply(line.text,publicSnapshot,now())})
    const canPublish=()=>running&&generation===ticket
    try{const accepted=await deps.onSay?.(lines,canPublish);if(accepted===false||!canPublish())return}catch{post('error','公开答复未能保存，问题仍保留待答状态。');return}
    for(const line of lines){
      remember({role:'captain',eventId:line.id,speakerId:'captain',name:line.to,text:line.text,at:now()})
      recent.unshift(line.text);post('host',line.text,{agentId:line.agentId,name:line.to||undefined})
      const task=line.taskId&&(board.audience.tasks??[]).find(t=>t.id===line.taskId)
      if(task&&answerable(task)){task.status='answered';task.answer=line.text;task.answerId=line.id;task.answeredAt=now();task.updatedAt=now()}
    }
    recent.length=Math.min(recent.length,8);changed()
  }

  /** One agent turn with cancellation and stale-result protection. Returns parsed JSON or undefined. */
  async function run(role: AiAgentRole, agent: AiAgentConfig, messages: AiMessage[]) {
    const ticket = generation, controller = new AbortController()
    let accounted=false
    busy.set(role, controller); changed()
    try {
      const result = await deps.call(agent, messages, controller.signal)
      if (ticket !== generation || controller.signal.aborted) return
      account(agent, result)
      accounted=true
      const parsed=parseJsonObject(result.text)
      if(role==='host'&&!Array.isArray(parsed.replies)&&!Array.isArray(parsed.toStrategist))throw new AiProviderError('场控回复缺少公开回复或建议列表。',undefined,'invalid_response')
      const recovered=!!health[role]?.consecutiveFailures
      health[role]={consecutiveFailures:0,lastSuccessAt:now(),circuitOpen:false}
      if(recovered)post('system',`${agent.label}已恢复，继续处理排队消息。`,{agentId:agent.id})
      return parsed
    } catch (error) {
      if (ticket !== generation || controller.signal.aborted) return
      if(accounted)usage[agent.id]!.failed++;else account(agent, undefined, true)
      const failure=aiFailure(error),consecutiveFailures=(health[role]?.consecutiveFailures??0)+1
      const circuitOpen=!failure.retryable||consecutiveFailures>=5
      // Cap our exponential delay, while respecting a longer provider retry window (bounded to 24h by aiFailure).
      const delay=Math.max(Math.min(300000,30000*2**(consecutiveFailures-1)),failure.retryAfterMs??0)
      health[role]={consecutiveFailures,...(health[role]?.lastSuccessAt?{lastSuccessAt:health[role]!.lastSuccessAt}:{}),lastFailureAt:now(),category:failure.category,...(failure.httpStatus!==undefined?{httpStatus:failure.httpStatus}:{}),message:failure.message,circuitOpen,...(!circuitOpen?{nextRetryAt:now()+delay}:{})}
      post('error', `${agent.label}：${failure.message}${circuitOpen?'已暂停该角色请求，检查后停止并重新启动场控。':` ${Math.ceil(delay/1000)}秒后再试，弹幕保留排队。`}`, { agentId: agent.id })
    } finally { if (busy.get(role) === controller) busy.delete(role); changed() }
  }

  async function hostTurn(agent: AiAgentConfig, idle: boolean) {
    const ticket=generation
    const config = deps.config()
    const batch = pending.splice(0, config.batchSize)
    const shown = batch
    lastHostAt = now();hostHasStarted=true; if (idle) lastIdleAt = now()
    const wasAnnounce = announce; announce = false
    let snapshot:unknown;try{snapshot=await deps.readSnapshot()}catch{/* The host can still chat without live game data. */}
    if(!running||generation!==ticket)return
    observeSnapshot(snapshot)
    if(deps.onQueries||(board.audience.tasks??[]).length)await updateTasks(snapshot)
    if(!running||generation!==ticket)return
    const awaiting=(board.audience.tasks??[]).filter(answerable).slice(0,3)
    const messages=hostMessages({ board, danmaku: shown, dropped: batch.length - shown.length, recentReplies: recent, note: config.hostNote, idle: idle && !wasAnnounce, now: now(), conversation })
    const out = await run('host', agent, captainMessages(messages,snapshot,now()))
    if(!running||generation!==ticket)return
    if (!out) {
      if (!running||generation!==ticket) return
      pending.unshift(...batch)
      if(pending.length>200)pendingDropped+=pending.splice(0,pending.length-200).length
      if (wasAnnounce) announce = true
      return
    }
    applyHost(board, out, agent.id, now())
    for(const event of shown)if(event.kind==='chat')remember({role:'viewer',eventId:event.id,speakerId:event.speakerId||'',name:event.name,text:event.text,at:now()})
    const lines: Spoken[] = (Array.isArray(out.replies) ? out.replies : []).slice(0, 3)
      .flatMap((r:any)=>{
        const task=r?.taskId!==undefined?awaiting.find(t=>t.id===r.taskId):undefined
        if(r?.taskId!==undefined&&!task)return []
        return [{id:task?`answer-${task.id}`:id('say'),to:safePublicGameText(task?.name??r?.to,20),text:task&&task.status!=='ready'?fallbackAnswer(task):safePublicGameText(r?.text,90),at:now(),agentId:agent.id,...(task?{taskId:task.id}:{})}]
      })
      .filter((r: Spoken) => r.text && !LINK.test(r.text))
    for(const task of awaiting){
      if(lines.some(l=>l.taskId===task.id))continue
      task.answerAttempts=Math.min(3,(task.answerAttempts??0)+1)
      if(task.answerAttempts>=3){task.reason='answer_unavailable';lines.unshift({id:`answer-${task.id}`,taskId:task.id,to:safePublicGameText(task.name,20),text:fallbackAnswer(task),at:now(),agentId:agent.id})}
    }
    const unique=lines.filter((l,i,a)=>a.findIndex(x=>x.id===l.id)===i).slice(0,3)
    const bindings=new Map(unique.flatMap(l=>{const task=l.taskId&&(board.audience.tasks??[]).find(t=>t.id===l.taskId);return task?[[task.id,`${task.status}:${task.updatedAt}`]]:[] as [string,string][]}))
    if(bindings.size){let latest:unknown;try{latest=await deps.readSnapshot()}catch{};if(!running||ticket!==generation)return;await updateTasks(latest)}
    await publishLines(unique.filter(l=>!l.taskId||(board.audience.tasks??[]).some(task=>task.id===l.taskId&&answerable(task)&&bindings.get(task.id)===`${task.status}:${task.updatedAt}`)),ticket)
    if(!running||generation!==ticket)return
    for(const q of Array.isArray(out.queries)?out.queries.slice(0,4):[]){
      const event=shown.find(d=>d.id===q?.eventId&&d.kind==='chat')
      if(!event)continue
      const query=Object.fromEntries(Object.entries(q).filter(([key])=>key!=='eventId'))
      createAudienceTask(board,{id:id('q'),requestId:id('query'),runId:queryRunId,event,query,snapshot,now:now()})
    }
    await publishQueries(snapshot).catch(()=>{})
    changed()
    let queued = 0
    for (const s of Array.isArray(out.toStrategist) ? out.toStrategist.slice(0, 4) : []) if (addSuggestion(board, { id: `s${(++counter).toString(36)}`, name: clip(s?.name, 20) || '观众', text: s?.text, at: now() })) queued++
    if (queued) post('system', `场控把 ${queued} 条观众建议转给了参谋。`)
    if (clip(out.note, 160)) addNote(board, { id: id('n'), from: agent.label, to: 'strategist', text: out.note, at: now() })
  }

  async function strategistTurn(agent: AiAgentConfig, reason: string, snapshot: ReturnType<typeof digestSnapshot>) {
    const ticket=generation
    lastStrategyAt = now(); lastSignature = snapshot.signature
    const before = pendingSuggestions(board).map(s => s.id)
    const out = await run('strategist', agent, strategistMessages({ board, snapshot: snapshot.text, note: deps.config().strategyNote, now: now(), reason }))
    if (!running||ticket!==generation)return
    if (!out) { lastSignature='';return }
    const decided = applyStrategist(board, { ...out, date: out.date || snapshot.date }, agent.id, now())
    if (decided && before.length) announce = true
    post('strategist', [board.plan.focus && `方针：${board.plan.focus}`, decided ? `处理了 ${decided} 条观众建议` : ''].filter(Boolean).join('；') || '参谋更新了局势判断。', { agentId: agent.id })
    const d = out.directive
    if (d && typeof d === 'object' && clip(d.text, 200)) {
      const targetResource=['consumer_goods','food','alloys','energy','minerals','unity','research','defense'].includes(d.targetResource)?d.targetResource:undefined
      const directive: Directive = { id: id('d'), priority: ['low', 'normal', 'high'].includes(d.priority) ? d.priority : 'normal', text: clip(d.text, 200), at: now(), agentId: agent.id, focus: board.plan.focus, nextSteps: board.plan.nextSteps, ...(snapshot.gameSessionId ? { gameSessionId: snapshot.gameSessionId } : {}),...(targetResource?{targetResource}:{}) }
      post('directive', directive.text, { agentId: agent.id })
      deps.onDirective?.(directive)
    }
  }

  /** Decides who speaks next. Called by the host's timer; also directly by tests. */
  async function tickOnce() {
    if (!running) return
    const ticket = generation
    const config = deps.config(), t = now(), jobs: Promise<void>[] = []
    const host = pick('host'), strategist = pick('strategist')
    if (!host && !strategist) { message = '请先在“角色分工”里为场控老师或游戏参谋选好服务商和模型。'; changed(); return }
    if((board.audience.tasks??[]).some(task=>task.status!=='answered'&&task.status!=='cancelled')){
      let raw:unknown;try{raw=await deps.readSnapshot()}catch{/* Missing snapshot resolves as unavailable. */}
      if(!running||ticket!==generation)return
      observeSnapshot(raw);await updateTasks(raw)
      if(!running||ticket!==generation)return
      if(host){
        const fallback=(board.audience.tasks??[]).filter(task=>answerable(task)&&(health.host?.circuitOpen||(task.answerDeadline!==undefined&&t>=task.answerDeadline))).slice(0,3).map(task=>({id:`answer-${task.id}`,taskId:task.id,to:safePublicGameText(task.name,20),text:fallbackAnswer(task),at:now(),agentId:host.id}))
        await publishLines(fallback,ticket)
      }
    }
    if (strategist && !busy.has('strategist') && roleReady('strategist')) {
      const urgent = pendingSuggestions(board).length > 0 && t - lastStrategyAt >= STRATEGIST_URGENT_GAP
      const due = t - lastStrategyAt >= config.strategyIntervalSeconds * 1000 || !!health.strategist?.consecutiveFailures
      if (urgent || due) {
        let snapshot = { text: '', signature: '' } as ReturnType<typeof digestSnapshot>
        try { const raw=await deps.readSnapshot();if(!running||generation!==ticket)return;observeSnapshot(raw);snapshot = digestSnapshot(raw,3500,now()) } catch { /* Missing checkpoint is a normal state. */ }
        if (!running || generation !== ticket) return
        // A periodic review of an unchanged game is wasted money; audience suggestions still get answered.
        const worth = urgent || !lastStrategyAt || snapshot.signature !== lastSignature
        if (worth && allow()) jobs.push(strategistTurn(strategist, urgent ? '有观众建议等待判断' : !lastStrategyAt ? '开场第一次复盘' : '游戏快照有变化，例行复盘', snapshot))
        else if (!worth) lastStrategyAt = t
      }
    }
    if (host && !busy.has('host') && roleReady('host') && (!hostHasStarted||t - lastHostAt >= config.replyIntervalSeconds * 1000)) {
      const quiet = config.idleCommentSeconds > 0 && t - Math.max(lastAudienceAt, lastIdleAt, lastHostAt) >= config.idleCommentSeconds * 1000
      if ((pending.length || announce || quiet || (board.audience.tasks??[]).some(answerable)) && allow()) jobs.push(hostTurn(host, !pending.length))
    }
    if (jobs.length) message = '场控运行中。'
    changed()
    await Promise.all(jobs)
  }

  function tick():Promise<void> {
    if(tickInFlight)return tickInFlight
    tickInFlight=tickOnce().finally(()=>{tickInFlight=undefined})
    return tickInFlight
  }

  function start() {
    if (running) return { ok: true, message: '场控已经在运行。' }
    if (!pick('host') && !pick('strategist')) return { ok: false, message: '请先为场控老师或游戏参谋选好服务商和模型。' }
    running = true; generation++; message = '场控运行中，等待弹幕。'
    queryRunId=crypto.randomUUID()
    for(const role of Object.keys(health) as AiAgentRole[])delete health[role]
    lastHostAt = 0;hostHasStarted=false; lastIdleAt = now(); lastAudienceAt = now()
    post('system', '场控已启动。'); changed()
    return { ok: true, message: '场控已启动：有弹幕才会调用模型，参谋按间隔复盘游戏快照。' }
  }
  function stop() {
    if (!running && !busy.size) return { ok: true, message: '场控已经停止。' }
    running = false; generation++
    cancelAudienceTasks(board,now());void publishQueries(undefined).catch(()=>{})
    for (const controller of busy.values()) controller.abort()
    busy.clear(); pending.length = 0; announce = false; message = '场控已停止，在途请求已取消。'
    conversation.length=0; speakerIds.clear(); recent.length=0
    post('system', '场控已停止。'); changed()
    return { ok: true, message }
  }
  function status(): AiDirectorStatus {
    const t = now()
    const degraded=Object.entries(health).find(([,value])=>value.consecutiveFailures>0)
    const statusMessage=running&&degraded?`${degraded[0]==='host'?'场控回复':'游戏参谋'}：${degraded[1].message}${degraded[1].circuitOpen?' 已暂停该角色，检查后停止并重新启动场控。':` 等待重试（${Math.max(0,Math.ceil(((degraded[1].nextRetryAt??t)-t)/1000))}秒）。`}`:message
    const currentSnapshot=snapshotStatus.state==='live'&&snapshotStatus.observedAt!==undefined&&t-snapshotStatus.observedAt>60000?{...snapshotStatus,state:'stale' as const}:snapshotStatus
    return { running, message:statusMessage, busy: [...busy.keys()], pending: pending.length, hourRequests: requests.filter(at => t - at <= 3600000).length,
      ...(hostHasStarted ? { lastHostAt } : {}), ...(lastStrategyAt ? { lastStrategyAt } : {}), usage: structuredClone(usage),health:structuredClone(health),snapshot:{...currentSnapshot},pendingDropped }
  }
  return { feed: feedEvent, tick, start, stop, status, board,flushQueries:()=>queryPublishing.catch(()=>{}), feedItems: () => feed.slice(), clearFeed() { feed.length = 0; changed() } }
}
