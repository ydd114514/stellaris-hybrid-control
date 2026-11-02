import {surveyGameDay as gameDay} from './survey-idle-policy.mjs';

const ID=/^[a-zA-Z0-9_-]{1,100}$/;
const active=new Set(['pending','working','verifying','blocked']);
const statuses=new Set([...active,'succeeded','superseded']);
const clip=(x,n)=>typeof x==='string'?x.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,n):'';
const finite=x=>Number.isFinite(x)?x:null;
const metricFor=text=>{
 if(/不要|不再|停止|别再|无需|不必|关闭|停用|取消|撤销|检查|核查|查看/.test(text)||!/提高|提升|发展|增长|增产|主拉|主攻|优先|加强|改善|恢复|拉.*(?:凝聚|科研|合金)/.test(text))return null;
 return /凝聚|unity/i.test(text)?'unity':/科研|研究产出|research/i.test(text)?'research':/合金|alloys/i.test(text)?'alloys':/消费品|consumer_goods/i.test(text)?'consumer_goods':null;
};
const resourceNet=(state,key)=>state.resources?.[key]?.net_known===false?null:finite(state.resources?.[key]?.net);
const metric=(state,key)=>key==='research'?['physics_research','society_research','engineering_research'].every(k=>resourceNet(state,k)!==null)?['physics_research','society_research','engineering_research'].reduce((n,k)=>n+resourceNet(state,k),0):null:resourceNet(state,key);
export function readExecutionTasks(raw,now){
 if(!Array.isArray(raw))return [];
 const seen=new Set();return raw.slice(0,12).flatMap(row=>{
  if(!ID.test(row?.id??'')||seen.has(row.id)||!['strategist','audience'].includes(row.source)||!clip(row.text,300)||!Number.isFinite(row.at)||row.at>now+5000)return [];
  if(row.source==='audience'&&!ID.test(row.suggestionId??''))return [];
  seen.add(row.id);return [{id:row.id,source:row.source,...(row.source==='audience'?{suggestionId:row.suggestionId}:{}),text:clip(row.text,300),at:row.at}];
 });
}

/** Durable intentions and observed results only; no task text is a command. */
export class AdviceExecution {
 constructor({now=Date.now}={}){this.now=now;this.tasks=new Map();this.bindingKey=null;this.gameSessionId=null;this.lastDay=null;}
 bind(gameSessionId,bindingKey,state={}){
  const day=gameDay(state.date);
  if(this.bindingKey&&this.bindingKey!==bindingKey||this.gameSessionId&&this.gameSessionId!==gameSessionId||this.lastDay!==null&&day!==null&&day<this.lastDay)this.tasks.clear();
  this.bindingKey=bindingKey;this.gameSessionId=gameSessionId;if(day!==null)this.lastDay=day;
 }
 invalidate(){this.tasks.clear();this.bindingKey=null;}
 ingest(rows,state){
  for(const input of readExecutionTasks(rows,this.now())){
   const old=this.tasks.get(input.id);
   // An ID is a stable goal, not permission to replace already executing work.
   if(old){if(old.text!==input.text||old.source!==input.source||old.suggestionId!==input.suggestionId)continue;continue;}
   if(this.tasks.size>=128){const completed=[...this.tasks.values()].find(x=>!active.has(x.status));if(completed)this.tasks.delete(completed.id);else continue;}
   const key=metricFor(input.text),value=key?metric(state,key):null,day=gameDay(state.date);
   this.tasks.set(input.id,{...input,status:'pending',reason:'已送达执行层，等待依据当前局势安排执行',updatedAt:this.now(),date:state.date,attempts:0,metric:key,baseline:value,lastValue:value,baselineDay:day,reviewDay:day});
  }
 }
 require(ids=[]){for(const id of ids){const task=this.tasks.get(id);if(!task)throw Error('建议任务不存在或不属于当前游戏：'+id);if(!active.has(task.status))throw Error('建议任务已经结束，不能沿用旧任务下达新操作：'+id);}}
 update(updates=[],state){
  this.require(updates.map(x=>x.taskId));
  for(const update of updates){const task=this.tasks.get(update.taskId);if(!active.has(task.status))continue;
   if(!['working','verifying','blocked','superseded'].includes(update.status))throw Error('不能由模型直接宣布建议完成');
   if(!clip(update.reason,180))throw Error('任务状态更新需要真实理由');
   if(task.status==='blocked'&&['working','verifying'].includes(update.status))task.reason=clip('仍待结果依据，拟调整：'+update.reason,180);
   else{task.status=update.status;task.reason=clip(update.reason,180);}
   task.updatedAt=this.now();task.date=state.date;
  }
 }
 start(ids,state){this.require(ids);for(const id of ids){const task=this.tasks.get(id);if(!active.has(task.status))continue;if(task.status!=='blocked'){task.status='working';task.reason='已开始处理，等待真实设置或后续经营结果';}task.attempts++;task.updatedAt=this.now();task.date=state.date;}}
 finish(ids,result,state){
  for(const id of ids){const task=this.tasks.get(id);if(!task||!active.has(task.status))continue;
   const rows=(result.domesticActions??[]).filter(r=>r.taskId===id),confirmed=rows.filter(r=>r.confirmed===true&&r.status==='confirmed');
   const concrete=confirmed.length===1&&this.concreteMatch(task,confirmed[0]);
   if(concrete){task.status='succeeded';task.reason='该项具体设置已由原生接口回读确认';task.evidence=this.actionEvidence(confirmed[0]);}
   else if(result.status==='attention'){task.status='blocked';task.reason='本次执行未完成，需核对真实状态并调整；不重发未确认命令';}
   else if(task.status==='blocked'&&!confirmed.length){task.reason='仍无新的对应执行或改善证据，不能重复同一方针掩盖停滞';}
   else{task.status='verifying';task.reason=confirmed.length?'相关设置已确认，持续经营目标仍需观察实际效果':'方针已提交执行，尚不能证明建议目标已经落实';}
   task.updatedAt=this.now();task.date=state.date;
  }
 }
 // Only an explicitly named single setting can finish on a setting receipt.
 // Broad growth/planet-management goals always wait for observed effects.
 concreteMatch(task,row){
  if(/不要|不再|停止|别再|无需|不必|提高|提升|发展|增长|增产|拉凝聚|管理|经营|改善|恢复|并且|同时|以及|然后|[、；;，,]|(?:和|与|及).{1,12}(?:法令|补贴|议程)/.test(task.text)||(task.text.match(/[a-z]+_[a-z_]+/g)??[]).length>1)return false;
  const key=row.arguments?.edict_key??row.arguments?.agenda_key,targetName=clip(row.targetName,100);
  if(!(key&&task.text.includes(key))&&!(targetName.length>=2&&task.text.includes(targetName)))return false;
  if(row.type==='toggle_edict')return row.arguments.enabled?/启用|开启/.test(task.text):/关闭|停用|取消|撤销/.test(task.text);
  return ['set_council_agenda','launch_council_agenda'].includes(row.type)&&/设置|切换|启动|发起|完成/.test(task.text);
 }
 actionEvidence(row){return clip(`${row.type} ${row.targetName??row.arguments?.edict_key??row.arguments?.agenda_key??''} ${row.arguments?.enabled===false?'off':row.arguments?.enabled===true?'on':''} 已回读确认`,180);}
 observe(state){
  const day=gameDay(state.date);if(day===null)return;
  for(const task of this.tasks.values()){
   if(!active.has(task.status)||task.reviewDay===null||day-task.reviewDay<180)continue;
   task.reviewDay=day;task.updatedAt=this.now();task.date=state.date;
   const value=task.metric?metric(state,task.metric):null;
   if(task.metric&&value!==null&&task.baseline!==null){
    const delta=Math.round((value-task.baseline)*10)/10,periodDelta=value-(task.lastValue??task.baseline);task.lastValue=value;
    task.evidence=`${task.metric}月净产从${Math.round(task.baseline*10)/10}变为${Math.round(value*10)/10}，变化${delta>=0?'+':''}${delta}`;
    task.status=periodDelta>0?'verifying':'blocked';task.reason=periodDelta>0?'已有实际净产改善，继续观察能否持续；持续目标不自动宣布完成':'本次观察期未出现净产改善，必须重新诊断并调整，不能只续期原方针';
   }else if(task.status==='pending'||task.status==='working'){
    task.status='blocked';task.reason='本次复查仍无对应的执行或结果证据，需明确可行措施或说明能力限制';
   }else if(task.status==='verifying'){task.status='blocked';task.reason='尚未取得目标结果证据，需继续核查或更换做法，不能据方针已生效宣布完成';}
  }
 }
 view(){return {version:1,gameSessionId:this.gameSessionId,tasks:[...this.tasks.values()].map(({metric,baseline,baselineDay,reviewDay,at,...task})=>({...task}))};}
 serialize(){return {version:1,gameSessionId:this.gameSessionId,bindingKey:this.bindingKey,lastDay:this.lastDay,tasks:[...this.tasks.values()]};}
 restore(saved,state){
  if(saved?.version!==1||!this.bindingKey||saved.bindingKey!==this.bindingKey||saved.gameSessionId!==this.gameSessionId||!Array.isArray(saved.tasks))return false;
  const day=gameDay(state.date);if(Number.isFinite(saved.lastDay)&&day!==null&&saved.lastDay>day)return false;
  const incoming=new Map(this.tasks);
  for(const row of saved.tasks.slice(0,128)){
   if(!ID.test(row?.id??'')||!['strategist','audience'].includes(row.source)||!clip(row.text,300)||!statuses.has(row.status)||!Number.isFinite(row.updatedAt)||row.updatedAt>this.now()+5000)continue;
   if(row.source==='audience'&&!ID.test(row.suggestionId??''))continue;
   const existing=incoming.get(row.id);if(existing&&existing.text!==row.text)continue;
   this.tasks.set(row.id,{id:row.id,source:row.source,...(row.source==='audience'?{suggestionId:row.suggestionId}:{}),text:clip(row.text,300),at:finite(row.at)??this.now(),status:row.status,reason:clip(row.reason,180),evidence:clip(row.evidence,180)||undefined,updatedAt:row.updatedAt,date:clip(row.date,20),attempts:Math.max(0,Math.min(1000,Math.floor(row.attempts)||0)),metric:metricFor(row.text),baseline:finite(row.baseline),lastValue:finite(row.lastValue)??finite(row.baseline),baselineDay:finite(row.baselineDay),reviewDay:finite(row.reviewDay)});
  }
  return true;
 }
}
