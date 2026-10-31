import type {AiAudienceTask,AiAudienceQuery,AiAudienceQueryBus,AiBlackboard} from '../../shared/src/ai'

export const AUDIENCE_QUERY_TOPICS=new Set(['government','research','traditions','ascension','planet','buildings','jobs','zones','military','upgrades'])
const ENTITY_TOPICS=new Set(['planet','buildings','jobs','zones','upgrades'])
const STATES=new Set(['querying','ready','unavailable','timed_out','cancelled','answered'])
const text=(v:unknown,n:number)=>typeof v==='string'?v.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e]/g,' ').replace(/\s+/g,' ').trim().slice(0,n):''
const identifier=(v:unknown)=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v)?v:''
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=0
export const answerable=(task:AiAudienceTask)=>['ready','unavailable','timed_out'].includes(task.status)
export function restoreAudienceTasks(value:unknown):AiAudienceTask[] {
  const seen=new Set<string>()
  return (Array.isArray(value)?value:[]).slice(0,32).flatMap((v:any)=>{
    const id=identifier(v?.id),sourceEventId=text(v?.sourceEventId,180),question=text(v?.question,120)
    if(!id||seen.has(id)||!sourceEventId||!question||!STATES.has(v.status)||!finite(v.createdAt)||!finite(v.updatedAt))return []
    seen.add(id)
    const task:AiAudienceTask={id,sourceEventId,question,name:text(v.name,20),createdAt:v.createdAt,updatedAt:v.updatedAt,status:v.status}
    const query=normalizeQuery(v.query)
    if(query)task.query=query
    for(const key of ['requestId','runId','gameSessionId','answerId'] as const)if(identifier(v[key]))task[key]=v[key]
    for(const key of ['expiresAt','answeredAt','answerAttempts','answerDeadline'] as const)if(finite(v[key]))task[key]=key==='answerAttempts'?Math.min(3,Math.floor(v[key])):v[key]
    for(const [key,max]of [['facts',1800],['reason',80],['answer',90]] as const)if(text(v[key],max))task[key]=text(v[key],max)
    if(task.status==='answered'&&(!task.answerId||!task.answer))return []
    return [task]
  })
}
export function normalizeQuery(value:any):AiAudienceQuery|undefined {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['topic','entityId'].includes(k))||!AUDIENCE_QUERY_TOPICS.has(value.topic))return
  const entity=ENTITY_TOPICS.has(value.topic)
  if(entity&&(!Number.isSafeInteger(value.entityId)||value.entityId<0||value.entityId>=0xffffffff)||!entity&&value.entityId!==undefined)return
  return {topic:value.topic,...(entity?{entityId:value.entityId}:{})}
}
function context(snapshot:any,now:number) {
  const sessionId=identifier(snapshot?.sessionId)
  const fresh=finite(snapshot?.observedAt)&&now-snapshot.observedAt<=60000&&snapshot.observedAt<=now+5000
  return {sessionId,available:!!sessionId&&!!snapshot?.state&&!snapshot.stopped&&fresh}
}
export function createAudienceTask(board:AiBlackboard,input:{id:string;requestId:string;runId:string;event:{id:string;name:string;text:string};query:unknown;snapshot:unknown;now:number}) {
  const tasks=board.audience.tasks??=[]
  const query=normalizeQuery(input.query),ctx=context(input.snapshot,input.now)
  const sourceTasks=tasks.filter(t=>t.sourceEventId===input.event.id)
  if(sourceTasks.length>=4||sourceTasks.some(t=>JSON.stringify(t.query)===JSON.stringify(query)))return
  const unavailable=!query?'unsupported':!ctx.available?'stopped':tasks.filter(t=>t.status==='querying').length>=8?'queue_full':undefined
  const task:AiAudienceTask={id:input.id,sourceEventId:text(input.event.id,180),name:text(input.event.name,20),question:text(input.event.text,120),createdAt:input.now,updatedAt:input.now,status:unavailable?'unavailable':'querying',runId:input.runId,...(ctx.sessionId?{gameSessionId:ctx.sessionId}:{}),...(query?{query}:{}),...(unavailable?{reason:unavailable,answerDeadline:input.now+60000}:{requestId:input.requestId,expiresAt:input.now+60000})}
  // Keep active tasks and the most recent completed history, bounded independently of chat volume.
  tasks.unshift(task)
  if(tasks.length>32){const old=tasks.map((t,i)=>({t,i})).reverse().find(x=>x.t.status!=='querying');tasks.splice(old?.i??tasks.length-1,1)}
  return task
}
export function syncAudienceTasks(board:AiBlackboard,input:{snapshot:unknown;results:unknown;runId:string;now:number;requestId():string}) {
  const ctx=context(input.snapshot,input.now),tasks=board.audience.tasks??=[]
  let changed=false
  for(const task of tasks){
    if(task.status==='answered'||task.status==='cancelled')continue
    if(task.gameSessionId&&ctx.sessionId&&task.gameSessionId!==ctx.sessionId){task.status='cancelled';task.reason='cross_session';task.updatedAt=input.now;changed=true;continue}
    // A crash may leave unfinished tasks on disk. Rebind same-game reads to a fresh run/request;
    // explicit stop has already marked them cancelled, so those are never revived.
    if(task.runId!==input.runId){
      if(task.query&&ctx.available&&task.gameSessionId===ctx.sessionId){task.status='querying';task.runId=input.runId;task.requestId=input.requestId();task.expiresAt=input.now+60000;delete task.facts;delete task.reason;task.answerAttempts=0}
      else{task.status='cancelled';task.reason='stopped'}
      task.updatedAt=input.now;changed=true
    }
    if(task.status==='ready'&&input.now-task.updatedAt>60000){task.status='timed_out';task.reason='result_expired';delete task.facts;task.updatedAt=input.now;task.answerDeadline=input.now;changed=true}
    if(task.status!=='querying')continue
    if(!ctx.available){task.status='unavailable';task.reason='stopped';task.updatedAt=input.now;task.answerDeadline=input.now+60000;changed=true;continue}
    if(!finite(task.expiresAt)||input.now>=task.expiresAt){task.status='timed_out';task.reason='expired';task.updatedAt=input.now;task.answerDeadline=input.now+60000;changed=true;continue}
    const response=input.results as any
    if(response?.version!==1||response.source!=='cyberfish-audience-query-results'||response.runId!==input.runId||response.gameSessionId!==task.gameSessionId||!finite(response.updatedAt)||response.updatedAt>input.now+5000||!Array.isArray(response.results))continue
    const result=response.results.slice(0,16).find((x:any)=>x?.id===task.requestId&&x.taskId===task.id)
    if(!result||!finite(result.observedAt)||result.observedAt<task.updatedAt||result.observedAt>input.now+5000||input.now-result.observedAt>60000)continue
    const facts=text(result.facts,1800)
    if(result.status==='ok'&&facts){task.status='ready';task.facts=facts;delete task.reason}
    else if(result.status==='unavailable'){task.status='unavailable';task.reason=['unsupported','stopped','expired','cross_session','invalid_entity','error'].includes(result.reason)?result.reason:'error'}
    else continue
    task.updatedAt=input.now;task.answerAttempts=0;task.answerDeadline=input.now+60000;changed=true
  }
  return changed
}
export function queryBus(board:AiBlackboard,runId:string,snapshot:unknown,now:number):AiAudienceQueryBus {
  const ctx=context(snapshot,now)
  return {version:1,source:'cyberfish-ai-hub',runId,gameSessionId:ctx.sessionId,updatedAt:now,requests:ctx.available?(board.audience.tasks??[]).filter(t=>t.status==='querying'&&t.runId===runId&&t.gameSessionId===ctx.sessionId&&t.query&&t.requestId&&finite(t.expiresAt)&&t.expiresAt>now).slice(0,8).map(t=>({id:t.requestId!,taskId:t.id,...t.query!,createdAt:t.updatedAt,expiresAt:t.expiresAt!})):[]}
}
export function cancelAudienceTasks(board:AiBlackboard,now:number) {
  for(const task of board.audience.tasks??[])if(task.status!=='answered'&&task.status!=='cancelled'){task.status='cancelled';task.reason='stopped';task.updatedAt=now}
}
