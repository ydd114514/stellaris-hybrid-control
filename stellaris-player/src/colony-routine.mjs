import {randomUUID} from 'node:crypto';
import {surveyGameDay} from './survey-idle-policy.mjs';
const id=x=>Number.isInteger(x)&&x>=0&&x<0xffffffff;
const live=new Set(['active','waiting','blocked','paused']);
const construction=new Set(['build_district','build_building','upgrade_building','set_district_zone','set_job_priority','clear_blocker']);
const budget=x=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length>0&&Object.entries(x).every(([k,n])=>/^[a-z_][a-z0-9_]{0,99}$/.test(k)&&Number.isFinite(n)&&n>=0&&n<=1e9);
const fitsBudget=(available,cost)=>Number.isFinite(available)&&(available>=cost||Math.abs(available-cost)<=Number.EPSILON*Math.max(1,Math.abs(available),cost)*8);
export const validColonyBudget=budget;
export function assertColonyBudget(s,r,cost,{commitments={},floors={}}={}){
 if(!budget(cost))throw Error('建设费用未知');
 for(const [k,n]of Object.entries(cost)){
  const row=s.status.resources?.[k],floor=floors[k]??0,reserved=commitments[k]??0;
  if(!Number.isFinite(row?.stockpile)||row.stockpile<0||row.stockpile_known===false||!Number.isFinite(row.net)||row.net_known===false||!Number.isFinite(floor)||floor<0||!Number.isFinite(reserved)||reserved<0||!fitsBudget(r.remainingBudget[k],n)||row.stockpile+Math.min(0,row.net)*3-reserved-floor<n)throw Error('建设超过授权预算、共享预留或维护底线：'+k);
 }
}
export function validateColonyRoutine(input){
 const fields=['planetId','goal','districtKey','housingTarget','maxBuilds','budget','reviewDays'];
 if(!input||Object.keys(input).some(k=>!fields.includes(k))||fields.some(k=>!Object.hasOwn(input,k)))throw Error('单星球住房委派参数缺失或含多余字段');
 if(!id(input.planetId)||typeof input.goal!=='string'||!input.goal.trim()||input.goal.length>200)throw Error('需要真实星球ID和明确住房目标');
 if(!['district_city','district_hive','district_nexus'].includes(input.districtKey))throw Error('首版仅允许已核对的城市/蜂巢/机械住房区划');
 if(!Number.isFinite(input.housingTarget)||input.housingTarget<0||input.housingTarget>1000||!Number.isInteger(input.maxBuilds)||input.maxBuilds<1||input.maxBuilds>4||!budget(input.budget)||!Number.isInteger(input.reviewDays)||input.reviewDays<30||input.reviewDays>360)throw Error('住房目标、1..4次建设上限、预算或30..360天复查间隔无效');
 return structuredClone(input);
}
// Local scheduling of ordinary commands. It never turns on native colony AI.
export class ColonyRoutine {
 constructor({store,save,snapshot,execute,assertActive,sessionId,budgetOptions=()=>({}),now=Date.now}){Object.assign(this,{store,save,snapshot,execute,assertActive,sessionId,budgetOptions,now});}
 view(){return {mode:'local_housing_scheduler',nativeAutomation:false,records:structuredClone(this.store().slice(-8).map(r=>({...Object.fromEntries(['id','planetId','colonyId','goal','districtKey','housingTarget','maxBuilds','budget','remainingBudget','reviewDays','status','sessionId','reason','createdDate','reviewRequired'].map(k=>[k,r[k]])),actions:r.actions.map(a=>({requestId:a.requestId,status:a.status,queueItemId:a.queueItemId,cost:a.cost,date:a.date,writeAttempted:a.writeAttempted}))}))),queuedWorkCancelled:false};}
 assertManual(order,authority){if(authority)return;const r=this.store().find(r=>live.has(r.status)&&r.sessionId===this.sessionId&&r.planetId===order.arguments?.planet_id);if(r&&construction.has(order.command))throw Error('该星球由本地住房托管，请先colony_control reclaim再手动建设');}
 valid(s,r){
  if(s.native?.known!==true||s.native.enabled!==false||s.native.planet_id!==r.planetId||s.native.queue?.known!==true)throw Error('殖民地归属、队列或原生自动化状态未知/未关闭，不启动第二个建设者');
  if(s.planet?.planet_id!==r.planetId||s.planet.colony_id!==s.native.colony_id||!Array.isArray(s.planet.construction_queue))throw Error('殖民地与施工队列身份不一致');
  if(s.districts?.success!==true||s.districts.planet_id!==r.planetId||s.districts.colony_id!==s.native.colony_id||!Array.isArray(s.districts.buildable)||!Array.isArray(s.districts.current))throw Error('区划候选不属于当前殖民地或覆盖未知');
  if(!Array.isArray(s.native.queue.items)||!s.native.queue.items.every(x=>id(x.item_id)))throw Error('施工队列条目句柄未知');
  if(!Number.isFinite(s.planet.kpi?.housing)||surveyGameDay(s.date)===null)throw Error('住房或游戏日期未知');
  if(r.colonyId!==undefined&&(s.native.colony_id!==r.colonyId||s.native.owner_id!==r.ownerId||s.native.queue.queue_id!==r.queueId))throw Error('殖民地控制对象发生变化');
  if(r.lastDay!==undefined&&surveyGameDay(s.date)<r.lastDay)throw Error('日期回退，不能接续旧托管');
 }
 async delegate(input){
  this.assertActive();const spec=validateColonyRoutine(input);
  if(this.store().some(r=>live.has(r.status)))throw Error('首版只允许一颗星球托管，旧会话先收回');
  if(this.store().length>=128)throw Error('托管记录达到上限，需先归档');
  const s=await this.snapshot(spec.planetId);this.valid(s,spec);
  const candidate=s.districts?.buildable?.find(x=>x.key===spec.districtKey&&x.can_build===true);
  if(!candidate||!budget(candidate.cost))throw Error('需要当前真实可建住房区划及完整费用');
  const r={...spec,id:randomUUID(),sessionId:this.sessionId,mode:'local_housing_scheduler',status:'active',colonyId:s.native.colony_id,ownerId:s.native.owner_id,queueId:s.native.queue.queue_id,designation:s.planet.designation_key??null,remainingBudget:{...spec.budget},actions:[],createdDate:s.date};
  this.affordable(s,r,candidate.cost);
  this.store().push(r);await this.save();return this.view();
 }
 affordable(s,r,cost){
  assertColonyBudget(s,r,cost,this.budgetOptions());
 }
 async advance({force=false,reconcileOnly=false}={}){
  const r=this.store().find(r=>r.sessionId===this.sessionId&&live.has(r.status));if(!r)return this.view();
  if(r.status==='paused'||r.reviewRequired)return this.view();
  if(reconcileOnly&&!r.actions.some(a=>['issued','unknown','queued'].includes(a.status)))return this.view();
  const pollKey=reconcileOnly?'lastReconcileAt':'lastPollAt';
  if(!force&&this.now()-(this[pollKey]??-Infinity)<5000)return this.view();
  this[pollKey]=this.now();
  try{
   this.assertActive();const s=await this.snapshot(r.planetId);
   this.valid(s,r);
   if((s.planet.designation_key??null)!==r.designation)throw Error('星球定位已变化，交回战略决策');
   const pending=r.actions.find(a=>['issued','unknown','queued'].includes(a.status));
   if(pending){
    const knownQueue=s.planet.construction_queue;
    const row=knownQueue.find(x=>x.key===r.districtKey&&(pending.queueItemId===undefined||pending.queueItemId===x.item_id)&&!pending.beforeItems.includes(x.item_id)&&s.native.queue.items.some(i=>i.item_id===x.item_id));
    const count=s.districts?.current?.find(x=>x.key===r.districtKey)?.built;
    if(row){pending.status='queued';pending.queueItemId=row.item_id;r.status='waiting';}
    else if(Number.isInteger(count)&&count===pending.beforeCount+1&&knownQueue.length===0&&s.native.queue.items.length===0){pending.status='completed';r.status='active';}
    else {r.status='blocked';r.reason='在途建设未确认，禁止自动重发';await this.save();return this.view();}
    if(pending.status==='queued'){await this.save();return this.view();}
   }
   if(r.actions.length>=r.maxBuilds){r.status='completed';r.reason='达到本轮建设次数上限';await this.save();return this.view();}
   if(reconcileOnly){r.status='active';r.reason='本次施工完工已核对，尚未派发下一项';await this.save();return this.view();}
   const day=surveyGameDay(s.date);
   if(!force&&r.lastDay!==undefined&&day-r.lastDay<r.reviewDays)return this.view();
   r.lastDay=day;
   if(s.planet.kpi.housing>=r.housingTarget){r.status='active';r.reason='住房达到目标，等待下次复查';await this.save();return this.view();}
   if(s.planet.construction_queue.length||s.native.queue.items.length){r.status='waiting';r.reason='保留现有施工，不追加队列';await this.save();return this.view();}
   const candidate=s.districts?.buildable?.find(c=>c.key===r.districtKey&&c.can_build===true);
   const beforeCount=s.districts?.current?.find(c=>c.key===r.districtKey)?.built??0;
   if(!candidate)throw Error('当前住房区划不可建，不猜替代建设');
   this.affordable(s,r,candidate.cost);this.assertActive();
   const a={requestId:randomUUID(),status:'issued',beforeCount,beforeItems:s.native.queue.items.map(x=>x.item_id),cost:structuredClone(candidate.cost),budgetCharged:true,date:s.date};
   for(const [k,n]of Object.entries(a.cost))r.remainingBudget[k]=Math.max(0,r.remainingBudget[k]-n);
   r.actions.push(a);r.status='blocked';r.reason='提交后等待真实队列';await this.save();
   this.assertActive();
   const result=await this.execute({record:r,action:a,order:{command:'build_district',arguments:{planet_id:r.planetId,district_key:r.districtKey}}});
   a.receipt=result;
   if(['rejected','deferred','rejected_cached','duplicate_skipped','pending_confirmation','unconfirmed_not_replayed'].includes(result?.status)){
    a.status='rejected';a.writeAttempted=result.nativeWriteAttempted??result.status==='rejected';r.reviewRequired=true;r.reason='本次未确认新建设，停止自动重试；先核对费用和在途记录，再收回或重新委派';
    if(result.nativeWriteAttempted===false){for(const [k,n]of Object.entries(a.cost))r.remainingBudget[k]+=n;a.budgetCharged=false;}
   }
   else {a.status='unknown';r.reason='已提交，需队列或区划数量回读确认';}
   await this.save();
   if(result?.nativeWriteAttempted===false)return this.view();
   // Readback is immediate, but it never re-enters the submission branch.
   const after=await this.snapshot(r.planetId);this.valid(after,r);
   const row=after.planet.construction_queue.find(x=>x.key===r.districtKey&&!a.beforeItems.includes(x.item_id)&&after.native.queue.items.some(i=>i.item_id===x.item_id));
   if(row){a.status='queued';a.queueItemId=row.item_id;r.status='waiting';r.reviewRequired=false;r.reason='已回读施工队列，等待完工';}
   await this.save();return this.view();
  }catch(error){r.status='blocked';r.reason=error.message;await this.save();return this.view();}
 }
 async reclaim(planetId,{stop=false}={}){
  const rows=this.store().filter(r=>(planetId===undefined||r.planetId===planetId)&&live.has(r.status));
  for(const r of rows){r.status=stop?'stopped':'reclaimed';r.reason='不再派发新建设；既有施工保留，不宣称取消或退款';await this.save();}
  return this.view();
 }
 async pause(planetId){
  const r=this.store().find(r=>r.sessionId===this.sessionId&&r.planetId===planetId&&live.has(r.status));
  if(!r)throw Error('当前会话没有该星球的活动委派');
  this.assertActive();if(r.status==='paused')return this.view();
  r.statusBeforePause=r.status;r.status='paused';r.reason='本地派发已暂停；已排施工保留，原预算不重置';await this.save();return this.view();
 }
 async resume(planetId){
  this.assertActive();const r=this.store().find(r=>r.sessionId===this.sessionId&&r.planetId===planetId&&r.status==='paused');
  if(!r)throw Error('恢复仅支持当前会话已暂停的委派，旧会话需收回后重新授权');
  if(r.reviewRequired)throw Error('委派存在拒绝动作，不能通过恢复绕过核对');
  const s=await this.snapshot(r.planetId);this.valid(s,r);
  if((s.planet.designation_key??null)!==r.designation)throw Error('星球定位已改变，需重新授权');
  const pending=r.actions.find(a=>['issued','unknown','queued'].includes(a.status));
  if(pending){
   const present=s.planet.construction_queue.find(q=>(pending.queueItemId===undefined||q.item_id===pending.queueItemId)&&!pending.beforeItems.includes(q.item_id)&&q.key===r.districtKey&&s.native.queue.items.some(i=>i.item_id===q.item_id));
   const count=s.districts.current.find(c=>c.key===r.districtKey)?.built;
   if(present){pending.status='queued';pending.queueItemId=present.item_id;}
   else {
    if(count===pending.beforeCount+1&&s.planet.construction_queue.length===0&&s.native.queue.items.length===0)pending.status='completed';
    else throw Error('原施工队列已变化或消失，保持暂停，不采用替代施工');
   }
  }
  if(r.actions.length<r.maxBuilds&&!r.actions.some(a=>a.status==='queued')&&s.planet.kpi.housing<r.housingTarget){
   const candidate=s.districts.buildable.find(c=>c.key===r.districtKey&&c.can_build===true);
   if(!candidate)throw Error('恢复时住房区划不可建');this.affordable(s,r,candidate.cost);
  }
  this.assertActive();r.status=r.actions.length>=r.maxBuilds&&r.actions.every(a=>a.status==='completed')?'completed':r.actions.some(a=>a.status==='queued')?'waiting':'active';delete r.statusBeforePause;
  r.reason='已核对当前对象并恢复本地派发；沿用原预算、次数和在途记录';await this.save();return this.view();
 }
 ownsTask(taskId){return this.store().some(r=>live.has(r.status)&&r.actions.some(a=>a.taskId===taskId));}
}
export const colonyRoutineSchema={type:'object',properties:{planetId:{type:'integer',minimum:0,maximum:4294967294},goal:{type:'string',minLength:1,maxLength:200},districtKey:{enum:['district_city','district_hive','district_nexus']},housingTarget:{type:'number',minimum:0,maximum:1000},maxBuilds:{type:'integer',minimum:1,maximum:4},budget:{type:'object',additionalProperties:{type:'number',minimum:0,maximum:1e9}},reviewDays:{type:'integer',minimum:30,maximum:360}},required:['planetId','goal','districtKey','housingTarget','maxBuilds','budget','reviewDays'],additionalProperties:false};
