import type {AiAdviceExecutionResult,AiAdviceExecutionStatus,AiBlackboard,AiExecutionTask,AiExecutionTaskState} from '../../shared/src/ai'

const clean=(x:unknown,n:number)=>typeof x==='string'?x.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028-\u202e]/g,' ').replace(/\s+/g,' ').trim().slice(0,n):''
const validId=(x:unknown):x is string=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(x)
const statuses:AiAdviceExecutionStatus[]=['pending','working','verifying','succeeded','blocked','superseded']
export const activeExecutionTask=(task:AiExecutionTaskState)=>!['succeeded','superseded'].includes(task.status)

export function restoreExecutionTasks(value:any):AiBlackboard['executionTasks']{
 if(!validId(value?.gameSessionId)||!Array.isArray(value.tasks))return
 const seen=new Set<string>(),tasks:AiExecutionTaskState[]=[]
 for(const row of value.tasks.slice(0,80)){
  if(!validId(row?.id)||seen.has(row.id)||!['strategist','audience'].includes(row.source)||!clean(row.text,200)||!Number.isFinite(row.at)||row.at<0)continue
  if(row.source==='audience'&&!validId(row.suggestionId))continue
  seen.add(row.id)
  tasks.push({id:row.id,source:row.source,...(row.source==='audience'?{suggestionId:row.suggestionId}:{}),text:clean(row.text,200),at:row.at,status:statuses.includes(row.status)?row.status:'pending',reason:clean(row.reason,200),updatedAt:Number.isFinite(row.updatedAt)?row.updatedAt:row.at,
   ...(clean(row.date,20)?{date:clean(row.date,20)}:{}),...(clean(row.evidence,300)?{evidence:clean(row.evidence,300)}:{}),...(Number.isSafeInteger(row.attempts)&&row.attempts>=0?{attempts:Math.min(row.attempts,999)}:{}),...(Number.isFinite(row.lastPublishedAt)?{lastPublishedAt:row.lastPublishedAt}:{})})
 }
 return {gameSessionId:value.gameSessionId,tasks}
}
export function restoreSuggestionExecution(value:any):AiAdviceExecutionResult|undefined{
 if(!validId(value?.taskId)||!statuses.includes(value.status)||!Number.isFinite(value.updatedAt))return
 return {taskId:value.taskId,status:value.status,reason:clean(value.reason,200),updatedAt:value.updatedAt,...(clean(value.date,20)?{date:clean(value.date,20)}:{}),...(clean(value.evidence,300)?{evidence:clean(value.evidence,300)}:{})}
}
export function syncExecutionTasks(board:AiBlackboard,snapshot:any,now:number){
 const sessionId=snapshot?.sessionId
 let changed=false
 if(validId(sessionId)&&board.executionTasks&&board.executionTasks.gameSessionId!==sessionId){
  delete board.executionTasks
  for(const suggestion of board.audience.suggestions)delete suggestion.execution
  changed=true
 }
 if(!validId(sessionId)||snapshot?.stopped||!Number.isFinite(snapshot?.observedAt)||now-snapshot.observedAt>60000||snapshot.observedAt-now>5000)return changed
 const receipt=snapshot.state?.adviceExecution
 const queue=board.executionTasks
 if(receipt?.version!==1||receipt.gameSessionId!==sessionId||!Array.isArray(receipt.tasks)||!queue||queue.gameSessionId!==sessionId)return changed
 for(const task of queue.tasks){
  const row=receipt.tasks.find((x:any)=>x?.id===task.id&&x.source===task.source&&x.text===task.text&&(task.source!=='audience'||x.suggestionId===task.suggestionId))
  if(!row||!statuses.includes(row.status)||!Number.isFinite(row.updatedAt)||row.updatedAt<task.updatedAt||row.updatedAt>now+5000)continue
  if(!activeExecutionTask(task)&&row.status!==task.status&&row.status!=='superseded')continue
  // Success must contain factual evidence; a label alone is never a completion receipt.
  if(row.status==='succeeded'&&!clean(row.evidence,300))continue
  const result={status:row.status as AiAdviceExecutionStatus,reason:clean(row.reason,200),updatedAt:row.updatedAt,...(clean(row.date,20)?{date:clean(row.date,20)}:{}),...(clean(row.evidence,300)?{evidence:clean(row.evidence,300)}:{}),...(Number.isSafeInteger(row.attempts)&&row.attempts>=0?{attempts:Math.min(row.attempts,999)}:{})}
  const revised=JSON.stringify([task.status,task.reason,task.evidence])!==JSON.stringify([result.status,result.reason,result.evidence])
  if(revised)changed=true
  Object.assign(task,result)
  const suggestion=board.audience.suggestions.find(s=>s.id===task.suggestionId)
  if(suggestion){suggestion.execution={taskId:task.id,...result};if(revised)delete suggestion.announcedAt}
 }
 return changed
}

export function planExecutionTasks(board:AiBlackboard,{gameSessionId,out,now,id}:{gameSessionId?:string;out:any;now:number;id:()=>string}){
 if(!validId(gameSessionId))return
 if(board.executionTasks?.gameSessionId!==gameSessionId){board.executionTasks={gameSessionId,tasks:[]};for(const s of board.audience.suggestions)delete s.execution}
 const tasks=(board.executionTasks??={gameSessionId,tasks:[]}).tasks,plans=Array.isArray(out?.executionPlans)?out.executionPlans.slice(0,12):[]
 const append=(source:AiExecutionTask['source'],text:string,suggestionId?:string)=>{
  text=clean(text,200);if(!text)return
  const existing=tasks.find(t=>t.source===source&&(source==='audience'?t.suggestionId===suggestionId:t.text===text))
  if(existing)return existing
  // Never evict an active promise just because the 12-item audience display rolled over.
  while(tasks.length>=64){const done=tasks.findIndex(t=>!activeExecutionTask(t));if(done<0)return;tasks.splice(done,1)}
  let taskId=id();while(tasks.some(t=>t.id===taskId))taskId=id()
  const task:AiExecutionTaskState={id:taskId,source,...(suggestionId?{suggestionId}:{}),text,at:now,status:'pending',reason:'已纳入执行队列，等待当前游戏状态下的实际安排',updatedAt:now};tasks.push(task);return task
 }
 for(const suggestion of board.audience.suggestions.filter(s=>s.status==='adopted'&&s.executionGameSessionId===gameSessionId)){
  const plan=plans.find((p:any)=>p?.suggestionId===suggestion.id&&clean(p.text,200))
  const task=append('audience',clean(plan?.text,200)||suggestion.text,suggestion.id)
  if(task)suggestion.execution={taskId:task.id,status:task.status,reason:task.reason,updatedAt:task.updatedAt,...(task.evidence?{evidence:task.evidence}:{}),...(task.date?{date:task.date}:{})}
  else suggestion.execution={taskId:`capacity-${suggestion.id}`.slice(0,80),status:'blocked',reason:'执行队列已满，现有未完成任务保留；本条尚未交给游戏执行',updatedAt:now}
 }
 for(const plan of plans.filter((p:any)=>p?.suggestionId===undefined))append('strategist',clean(plan?.text,200))
 for(const step of board.plan.nextSteps)append('strategist',step)
 if(!(Array.isArray(out?.nextSteps)&&out.nextSteps.some((text:any)=>clean(text,100)))&&!plans.some((p:any)=>p?.suggestionId===undefined&&clean(p?.text,200)))append('strategist',clean(out?.directive?.text,200))
}
export function executionTaskBatch(board:AiBlackboard,gameSessionId:string|undefined,now:number):AiExecutionTask[]{
 if(!gameSessionId||board.executionTasks?.gameSessionId!==gameSessionId)return []
 return board.executionTasks.tasks.filter(activeExecutionTask).sort((a,b)=>(a.lastPublishedAt??0)-(b.lastPublishedAt??0)||Number(b.source==='audience')-Number(a.source==='audience')||a.at-b.at).slice(0,12).map(task=>{
  task.lastPublishedAt=now
  return {id:task.id,source:task.source,...(task.suggestionId?{suggestionId:task.suggestionId}:{}),text:task.text,at:task.at}
 })
}
