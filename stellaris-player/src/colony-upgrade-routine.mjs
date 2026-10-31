import {randomUUID} from 'node:crypto';
import {surveyGameDay} from './survey-idle-policy.mjs';
import {buildingUpgradeProblem,verifyBuildingUpgrade,captureUpgradeBaseline,captureUpgradeQueueWitness} from './building-upgrades.mjs';
import {assertColonyBudget,validColonyBudget} from './colony-routine.mjs';
const live=new Set(['active','waiting','blocked','paused']);
const id=x=>Number.isInteger(x)&&x>=0&&x<0xffffffff;
const key=x=>typeof x==='string'&&/^[a-zA-Z0-9_]{1,100}$/.test(x);
const construction=new Set(['build_district','build_building','upgrade_building','set_district_zone','set_job_priority','clear_blocker']);
export function validateColonyUpgradePolicy(input){
 const required=['planetId','goal','allowedUpgradeKeys','maxBuilds','budget','reviewDays'];
 if(!input||required.some(k=>!Object.hasOwn(input,k))||Object.keys(input).some(k=>!required.includes(k)))throw Error('建筑升级托管参数缺失或含多余字段');
 if(!id(input.planetId)||typeof input.goal!=='string'||!input.goal.trim()||input.goal.length>200)throw Error('升级托管需要真实星球与明确目标');
 if(!Array.isArray(input.allowedUpgradeKeys)||input.allowedUpgradeKeys.length<1||input.allowedUpgradeKeys.length>16||!input.allowedUpgradeKeys.every(key)||new Set(input.allowedUpgradeKeys).size!==input.allowedUpgradeKeys.length)throw Error('需要1..16个真实、不重复的允许升级目标key');
 if(!Number.isInteger(input.maxBuilds)||input.maxBuilds<1||input.maxBuilds>4||!validColonyBudget(input.budget)||!Number.isInteger(input.reviewDays)||input.reviewDays<30||input.reviewDays>360)throw Error('升级次数、预算或复查间隔无效');
 return structuredClone(input);
}

// Ordinary upgrade commands under an explicit model-approved key list.
// Exposure is controlled by the caller; each order rechecks current engine eligibility and budget.
export class ColonyUpgradeRoutine {
 constructor({store,save,snapshot,execute,assertActive,sessionId,budgetOptions=()=>({}),now=Date.now}){Object.assign(this,{store,save,snapshot,execute,assertActive,sessionId,budgetOptions,now});}
 view(){return {mode:'local_building_upgrade_scheduler',nativeAutomation:false,validation:'fresh_engine_checks_per_order',records:structuredClone(this.store().slice(-8).map(r=>({id:r.id,planetId:r.planetId,colonyId:r.colonyId,sessionId:r.sessionId,goal:r.goal,allowedUpgradeKeys:r.allowedUpgradeKeys,maxBuilds:r.maxBuilds,remainingBudget:r.remainingBudget,reviewDays:r.reviewDays,status:r.status,reason:r.reason,reviewRequired:r.reviewRequired===true,actions:r.actions.map(a=>({requestId:a.requestId,status:a.status,arguments:a.order.arguments,cost:a.cost,queueItemId:a.queueItemId,date:a.date}))}))),queuedWorkCancelled:false};}
 hasControl(){return this.store().some(r=>live.has(r.status));}
 assertManual(order,authority){if(!authority&&construction.has(order.command)&&this.store().some(r=>r.sessionId===this.sessionId&&live.has(r.status)&&r.planetId===order.arguments?.planet_id))throw Error('该星球由建筑升级托管持有控制权，先收回再手动建设');}
 ownsTask(taskId){return this.store().some(r=>live.has(r.status)&&r.actions.some(a=>a.taskId===taskId));}
 valid(s,r){
  if(s.native?.known!==true||s.native.enabled!==false||s.native.planet_id!==r.planetId||s.native.queue?.known!==true||!Array.isArray(s.native.queue.items)||!s.native.queue.items.every(i=>id(i.item_id)))throw Error('当前玩家、原生开关或施工队列未知');
  if(!id(s.native.owner_id)||!id(s.native.colony_id)||!id(s.native.queue.queue_id))throw Error('升级托管的完整归属或队列句柄无效');
  if(s.planet?.planet_id!==r.planetId||s.planet.colony_id!==s.native.colony_id||!Array.isArray(s.planet.construction_queue))throw Error('升级托管的星球/殖民地不一致');
  if(s.upgrades?.success!==true||s.upgrades.planet_id!==r.planetId||s.upgrades.colony_id!==s.native.colony_id||s.upgrades.queue_id!==s.native.queue.queue_id||!Array.isArray(s.upgrades.candidates))throw Error('建筑升级候选身份或覆盖未知');
  const day=surveyGameDay(s.date);if(day===null||r.lastDay!==undefined&&day<r.lastDay)throw Error('日期未知或回退');
  if(r.colonyId!==undefined&&(r.colonyId!==s.native.colony_id||r.ownerId!==s.native.owner_id||r.queueId!==s.native.queue.queue_id||(s.planet.designation_key??null)!==r.designation))throw Error('升级托管对象、归属或星球定位已变化');
 }
 candidates(s,r){return s.upgrades.candidates.filter(c=>r.allowedUpgradeKeys.includes(c.upgrade_key)&&c.can_upgrade===true&&!r.actions.some(a=>a.status==='completed'&&a.order.arguments.building_id===c.building_id&&a.order.arguments.upgrade_key===c.upgrade_key)).sort((a,b)=>r.allowedUpgradeKeys.indexOf(a.upgrade_key)-r.allowedUpgradeKeys.indexOf(b.upgrade_key)||a.building_id-b.building_id);}
 observe(s,r,a){
  const v=verifyBuildingUpgrade(s.planet,a.order.arguments,a.receipt?.response||{},{baseline:a.upgradeBaseline,queueWitness:a.queueWitness,native:s.native});
  if(v.completed)return {status:'completed',proof:v};
  const q=v.entry;
  if(q&&id(q.item_id)&&!a.beforeItems.includes(q.item_id)&&(a.queueItemId===undefined||a.queueItemId===q.item_id)&&s.native.queue.items.some(i=>i.item_id===q.item_id))return {status:'queued',queueItemId:q.item_id,queueWitness:captureUpgradeQueueWitness(a.upgradeBaseline,a.order.arguments,s.planet,s.native),proof:v};
  return {status:'unknown'};
 }
 async delegate(input){
  this.assertActive();const p=validateColonyUpgradePolicy(input);
  if(this.hasControl())throw Error('已有建筑升级托管，先收回旧控制权');
  if(this.store().length>=128)throw Error('升级托管记录需归档');
  const s=await this.snapshot(p.planetId);this.valid(s,p);
  if(p.allowedUpgradeKeys.some(k=>!s.upgrades.candidates.some(c=>c.upgrade_key===k)))throw Error('允许升级key必须来自当前真实候选，不猜后续升级路径');
  const r={...p,id:randomUUID(),sessionId:this.sessionId,status:'active',colonyId:s.native.colony_id,ownerId:s.native.owner_id,queueId:s.native.queue.queue_id,designation:s.planet.designation_key??null,remainingBudget:{...p.budget},createdDate:s.date,actions:[]};
  const candidate=this.candidates(s,r)[0];if(candidate)assertColonyBudget(s,r,candidate.cost,this.budgetOptions());
  this.assertActive();this.store().push(r);await this.save();return this.view();
 }
 async advance({force=false,reconcileOnly=false}={}){
  const r=this.store().find(r=>r.sessionId===this.sessionId&&live.has(r.status));
  if(!r||r.status==='paused'||r.reviewRequired)return this.view();
  if(reconcileOnly&&!r.actions.some(a=>['issued','unknown','queued'].includes(a.status)))return this.view();
  const pollKey=reconcileOnly?'lastReconcileAt':'lastPollAt';
  if(!force&&this.now()-(this[pollKey]??-Infinity)<5000)return this.view();this[pollKey]=this.now();this.assertActive();
  try{
   const s=await this.snapshot(r.planetId);this.valid(s,r);
   const pending=r.actions.find(a=>['issued','unknown','queued'].includes(a.status));
   if(pending){const v=this.observe(s,r,pending);Object.assign(pending,v);if(v.status!=='completed'){r.status=v.status==='queued'?'waiting':'blocked';r.reason=v.status==='queued'?'等待已确认升级施工':'升级结果未知，不自动重发';await this.save();return this.view();}}
   if(r.actions.length>=r.maxBuilds){r.status='completed';r.reason='达到本轮升级次数上限';await this.save();return this.view();}
   if(reconcileOnly){r.status='active';r.reason='本次升级完工已核对，尚未派发下一项';await this.save();return this.view();}
   const day=surveyGameDay(s.date);if(!force&&r.lastDay!==undefined&&day-r.lastDay<r.reviewDays)return this.view();r.lastDay=day;
   if(s.native.queue.items.length||s.planet.construction_queue.length){r.status='waiting';r.reason='现有施工优先，不追加升级';await this.save();return this.view();}
   const candidate=this.candidates(s,r)[0];
   if(!candidate){r.status='active';r.reason='当前没有允许且合法的升级，等待条件变化';await this.save();return this.view();}
   const args={planet_id:r.planetId,building_id:candidate.building_id,upgrade_key:candidate.upgrade_key},problem=buildingUpgradeProblem(s.upgrades,args);if(problem)throw Error(problem);
   assertColonyBudget(s,r,candidate.cost,this.budgetOptions());
   const a={requestId:randomUUID(),order:{command:'upgrade_building',arguments:args},upgradeBaseline:captureUpgradeBaseline(s.planet,args,s.native),cost:structuredClone(candidate.cost),budgetCharged:true,beforeItems:s.native.queue.items.map(i=>i.item_id),date:s.date,status:'issued'};
   for(const [k,n]of Object.entries(a.cost))r.remainingBudget[k]=Math.max(0,r.remainingBudget[k]-n);
   r.actions.push(a);r.status='blocked';r.reason='等待升级提交与实际队列';await this.save();this.assertActive();
   a.receipt=await this.execute({record:r,action:a,order:a.order});
   if(a.receipt?.status!=='posted'){
    a.status='unknown';r.reviewRequired=!['unknown','unconfirmed'].includes(a.receipt?.status);r.reason='升级未明确接受，不自动重试';
    if(a.receipt?.nativeWriteAttempted===false){a.status='rejected';a.budgetCharged=false;for(const [k,n]of Object.entries(a.cost))r.remainingBudget[k]+=n;}
   }else a.status='unknown';
   await this.save();if(a.receipt?.nativeWriteAttempted===false)return this.view();
   const after=await this.snapshot(r.planetId);this.valid(after,r);const proof=this.observe(after,r,a);
   if(proof.status!=='unknown'){Object.assign(a,proof);r.reviewRequired=false;r.status=proof.status==='completed'?'active':'waiting';r.reason=proof.status==='completed'?'升级实例已确认':'升级队列已确认，不等于完工';}
   await this.save();return this.view();
  }catch(error){r.status='blocked';r.reason=error.message;await this.save();return this.view();}
 }
 async pause(planetId){this.assertActive();const r=this.store().find(r=>r.sessionId===this.sessionId&&r.planetId===planetId&&live.has(r.status));if(!r)throw Error('当前会话没有该星球的升级托管');r.status='paused';r.reason='只暂停升级派发，已排施工保留';await this.save();return this.view();}
 async resume(planetId){
  this.assertActive();const r=this.store().find(r=>r.sessionId===this.sessionId&&r.planetId===planetId&&r.status==='paused');if(!r||r.reviewRequired)throw Error('只能恢复当前会话已暂停且不需重新授权的升级托管');
  const s=await this.snapshot(planetId);this.valid(s,r);const pending=r.actions.find(a=>['issued','unknown','queued'].includes(a.status));
  if(pending){const v=this.observe(s,r,pending);if(v.status==='unknown')throw Error('原升级施工尚未确认，保持暂停');Object.assign(pending,v);}
  this.assertActive();r.status=r.actions.length>=r.maxBuilds&&r.actions.every(a=>a.status==='completed')?'completed':r.actions.some(a=>a.status==='queued')?'waiting':'active';r.reason='核对后恢复，原预算和次数不变';await this.save();return this.view();
 }
 async reclaim(planetId,{stop=false}={}){for(const r of this.store().filter(r=>(planetId===undefined||r.planetId===planetId)&&live.has(r.status))){r.status=stop?'stopped':'reclaimed';r.reason='停止新增升级；既有施工保留，不自动取消或退款';await this.save();}return this.view();}
}
export const colonyUpgradePolicySchema={type:'object',properties:{planetId:{type:'integer',minimum:0,maximum:4294967294},goal:{type:'string',minLength:1,maxLength:200},allowedUpgradeKeys:{type:'array',minItems:1,maxItems:16,uniqueItems:true,items:{type:'string',pattern:'^[a-zA-Z0-9_]{1,100}$'}},maxBuilds:{type:'integer',minimum:1,maximum:4},budget:{type:'object',additionalProperties:{type:'number',minimum:0,maximum:1e9}},reviewDays:{type:'integer',minimum:30,maximum:360}},required:['planetId','goal','allowedUpgradeKeys','maxBuilds','budget','reviewDays'],additionalProperties:false};
