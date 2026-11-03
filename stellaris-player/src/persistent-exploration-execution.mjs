import {bindFleetExploration,planExplorationLeg,recordExplorationLeg,syncExplorationLegs} from './persistent-fleet-exploration.mjs';

const validId=n=>Number.isSafeInteger(n)&&n>=0&&n<0xffffffff;
const validGeneration=n=>Number.isSafeInteger(n)&&n>=0;
const enabled=state=>state?.userEconomicPolicy?.version===1&&state.userEconomicPolicy.source==='user-current-chat'&&state.userEconomicPolicy.militaryPolicy==='exploration_until_threat';
const idle=f=>validId(f?.fleet_id)&&validId(f.system_id)&&f.total_ships>0&&f.available_to_merge===true&&/无指令|无任务|idle|no orders/i.test(f.status??'');
const emergency=state=>state.wars?.length>0||['energy','minerals','alloys','food','consumer_goods'].some(key=>{
 const r=state.resources?.[key];return r?.net_known!==false&&r?.stockpile_known!==false&&Number.isFinite(r?.stockpile)&&Number.isFinite(r.net)&&r.net<0&&Math.max(0,r.stockpile)/-r.net<=6;
});
const text=value=>String(value??'').replace(/[\r\n]/g,' ').slice(0,300);
const readMethods=new Set(['get_wars','get_fleet_tactics','get_system','find_path']);
const rejectionPolicy=error=>{
 const value=String(error??'').toLowerCase();
 if(/invalid|not_found|not_owned|foreign|unsupported|ref_invalid|permission|unauthorized/.test(value))return {retryable:false};
 if(/safe_intel|mia|has_orders|not_idle|busy|combat|war|threat|risk|path|adjacen|position_changed|origin_changed|from_system/.test(value))return {retryable:true,cooldownMs:/safe_intel/.test(value)?120000:60000};
 return {retryable:false};
};

/** Serial, current-session exploration supervisor. It never pauses, recruits,
 * disables country AI, cancels orders or performs native writes itself.
 *
 * readControl() must return a fresh, bound native readback:
 * {binding,owner:'native',phase:'running',generation,protectionSupported:true,
 *  protectedFleetIds:[...],explorationMinimumIntel?:3}. Protection callbacks must use generation CAS,
 * preserve every other protected target, and read back the exact fleet list.
 * ensureProtection(...) returns {binding,generation,confirmed:true,added}; an
 * added:false fleet belongs to an existing protection and is never released.
 * releaseProtection(...) removes ONLY the matching protection this execution
 * acquired, preserving all other fleet/job/colony/shipyard protections.
 *
 * dispatch(...) owns the normal command-scope/world/ownership/path/risk checks,
 * durable command journal and OrderTracker registration. Its result is
 * {accepted:true,trackingId} or an explicit rejection/definitely-unsent result.
 * A missing receipt is NOT permission to replay. persist(snapshot) must durably
 * finish before dispatch; restoring a prepared write leaves it uncertain.
 */
export class PersistentExplorationExecution {
 constructor({rpc,readControl,ensureProtection,releaseProtection,dispatch,persist,now=Date.now,reconsiderAfterMs=15000,maxFleets=2}={}){
  Object.assign(this,{rpc,readControl,ensureProtection,releaseProtection,dispatch,persist,now});
  this.reconsiderAfterMs=Number.isFinite(reconsiderAfterMs)?Math.max(0,reconsiderAfterMs):15000;this.maxFleets=Number.isInteger(maxFleets)?Math.min(64,Math.max(1,maxFleets)):2;
  this.binding=null;this.data=null;this.protections=[];this.pending=[];this.sequence=0;this.lastPlan=new Map();this.cooldowns=new Map();this.restoredTrackingIds=new Set();this.cursor=0;this.running=false;
 }
 restore(saved,{binding,date}={}){
  if(this.running)throw Error('持续探索执行中不能替换会话数据');
  if(saved?.version!==1||saved.binding!==binding||typeof binding!=='string'||!binding||typeof date!=='string'||typeof saved.data?.date!=='string'||date<saved.data.date)return false;
  this.binding=binding;this.data=bindFleetExploration(saved.data,binding,date);
  const seen=new Set();this.pending=(Array.isArray(saved.pending)?saved.pending:[]).slice(0,64).flatMap(p=>{
   if(!validId(p?.fleetId)||!validId(p.targetSystemId)||typeof p.requestId!=='string'||!p.requestId||seen.has(p.fleetId))return [];seen.add(p.fleetId);
   return [{fleetId:p.fleetId,targetSystemId:p.targetSystemId,fromSystemId:validId(p.fromSystemId)?p.fromSystemId:null,requestId:text(p.requestId),
    trackingId:typeof p.trackingId==='string'?text(p.trackingId):'',status:p.status==='tracked'?'tracked':'unknown'}];
  });
  // A saved ownership record is never itself a protection readback. Every use
  // and release below requires the same generation and fresh exact fleet list.
  this.protections=(Array.isArray(saved.protections)?saved.protections:[]).filter(p=>validId(p?.fleetId)&&validGeneration(p.generation)).slice(0,64).map(p=>({fleetId:p.fleetId,generation:p.generation}));
  this.sequence=Number.isSafeInteger(saved.sequence)&&saved.sequence>=0?saved.sequence:0;
  this.cooldowns=new Map((Array.isArray(saved.cooldowns)?saved.cooldowns:[]).filter(p=>Array.isArray(p)&&validId(p[0])&&Number.isFinite(p[1])).slice(0,64).map(([fleetId,until])=>[fleetId,Math.min(until,this.now()+120000)]));
  this.restoredTrackingIds=new Set(this.pending.filter(p=>p.status==='tracked').map(p=>p.requestId));
  for(const p of this.pending)if(p.status==='unknown'){const row=this.data.fleets.find(f=>f.fleetId===p.fleetId);if(row)Object.assign(row,{phase:'blocked',retryable:false,reason:'上轮派单回执未知，禁止重放或自动换目标'});}
  return true;
 }
 serialize(){return this.data?structuredClone({version:1,binding:this.binding,data:this.data,protections:this.protections,pending:this.pending,sequence:this.sequence,cooldowns:[...this.cooldowns]}):null;}
 async save(){if(typeof this.persist!=='function')throw Error('持续探索缺少写前持久化，不提交新航段');await this.persist(this.serialize());}
 bind(binding,date){
  if(typeof binding!=='string'||!binding||typeof date!=='string'||!date)throw Error('持续探索需要当前会话/世界绑定和真实日期');
  if(this.binding!==binding||!this.data||date<this.data.date){
   this.binding=binding;this.data=bindFleetExploration(null,binding,date);this.protections=[];this.pending=[];this.lastPlan.clear();this.cooldowns.clear();this.restoredTrackingIds.clear();this.cursor=0;
  }else this.data.date=date;
 }
 controlMatches(c,{running=true}={}){
  return c?.binding===this.binding&&validGeneration(c.generation)&&Array.isArray(c.protectedFleetIds)&&c.protectedFleetIds.every(validId)&&
   (!running||c.owner==='native'&&c.phase==='running'&&c.protectionSupported===true);
 }
 async control(){return typeof this.readControl==='function'?await this.readControl():null;}
 async release(fleetId,control){
  const owned=this.protections.find(p=>p.fleetId===fleetId);if(!owned)return {released:false};
  if(!this.controlMatches(control))return {blocked:true,reason:'当前同世界原生保护回读未确认，未释放任何保护'};
  if(owned.generation!==control.generation||!control.protectedFleetIds.includes(fleetId)){
   this.protections=this.protections.filter(p=>p!==owned);return {released:false};
  }
  if(typeof this.releaseProtection!=='function')return {blocked:true,reason:'缺少按所有权释放逐舰保护的能力'};
  const result=await this.releaseProtection({fleetId,binding:this.binding,generation:control.generation});
  const after=await this.control();
  if(result?.confirmed!==true||!this.controlMatches(after)||after.generation!==control.generation||after.protectedFleetIds.includes(fleetId))return {blocked:true,reason:'逐舰保护释放未得到同代原生回读确认'};
  this.protections=this.protections.filter(p=>p!==owned);return {released:true,control:after};
 }
 async releaseAll(control){
  for(const p of [...this.protections]){const result=await this.release(p.fleetId,control);if(result.blocked)return result;control=result.control??control;}
  return {released:true,control};
 }
 async tick(options={}){
  if(this.running)return {status:'busy',reason:'上一轮持续探索尚未完成，未并行派单'};
  this.running=true;try{return await this.step(options);}catch(error){return {status:'attention',reason:text(error.message),allowNativeEconomy:true};}finally{this.running=false;}
 }
 async step({state={},orders=[],binding,fleetIds,allowDispatch=true}={}){
  this.bind(binding,state.date);syncExplorationLegs(this.data,{state,orders});
  let control=await this.control();
  if(!enabled(state)||emergency(state)||allowDispatch!==true){
   for(const row of this.data.fleets){row.phase='suspended';row.reason=!enabled(state)?'本人持续探索授权已撤回':allowDispatch!==true?'控制边界暂停派单':'战争或真实保供危机，交还舰队并继续原生经营';}
   const released=await this.releaseAll(control);await this.save();
   return {status:released.blocked?'attention':'yield',reason:released.reason??this.data.fleets[0]?.reason??'没有当前本人探索授权',allowNativeEconomy:true};
  }
  if(!this.controlMatches(control))return {status:'needs_native_fleet_protection',reason:'同会话原生委派、逐舰保护能力或真实保护列表未确认',allowNativeEconomy:true};
  // Completed means the exact tracked destination proof, never idle text or a
  // successful move receipt. Unknown/failed legs cannot unlock another order.
  for(const p of [...this.pending]){
   const tracked=orders.find(o=>o.id===p.trackingId&&o.command==='move_fleet'&&o.arguments?.fleet_id===p.fleetId&&o.arguments.system_id===p.targetSystemId);
   if(this.restoredTrackingIds.has(p.requestId)){this.restoredTrackingIds.delete(p.requestId);if(!tracked)p.status='unknown';}
   if(tracked?.status==='completed')this.pending=this.pending.filter(x=>x!==p);
   else if(p.status==='prepared'||p.status==='unknown'||tracked&&['failed','expired_unknown'].includes(tracked.status)){
    p.status='unknown';const row=this.data.fleets.find(f=>f.fleetId===p.fleetId);if(row)Object.assign(row,{phase:'blocked',retryable:false,reason:'航段失败或回执未知，停止自动派单并保留核对信息'});
    const released=await this.release(p.fleetId,control);control=released.control??control;
   }
  }
  const cache=new Map(),read=async(method,params={})=>{
   if(!readMethods.has(method))throw Error('持续探索执行器只允许既有只读接口');
   const key=JSON.stringify([method,params]);if(!cache.has(key))cache.set(key,Promise.resolve(this.rpc(method,params)));return cache.get(key);
  };
  if(typeof this.rpc!=='function')return {status:'attention',reason:'没有当前世界只读接口'};
  const wars=await read('get_wars');
  if(!Array.isArray(wars?.wars)||wars.wars.length||wars.warGoalsWindow){
   for(const row of this.data.fleets)if(row.phase!=='blocked')row.phase='suspended';
   const released=await this.releaseAll(control);await this.save();return {status:released.blocked?'attention':'yield',reason:released.reason??'真实战争或战况不可读，暂停探索并交还防务',allowNativeEconomy:true};
  }
  const tactics=await read('get_fleet_tactics',{details:false});
  if(!Array.isArray(tactics?.fleets))return {status:'attention',reason:'现有军舰列表未确认，不创建或猜测舰队'};
  const selected=fleetIds===undefined?null:new Set((Array.isArray(fleetIds)?fleetIds:[]).filter(validId));
  if(selected)for(const p of [...this.protections])if(!selected.has(p.fleetId)){
   const released=await this.release(p.fleetId,control);control=released.control??control;if(released.blocked)return {status:'attention',reason:released.reason,allowNativeEconomy:true};
  }
  // Only adopt real, idle, existing own military ships. Foreign/transit/combat,
  // upgrade and unknown tasks are never overwritten for this ongoing goal.
  for(const fleet of tactics.fleets){
   if(this.data.fleets.length>=this.maxFleets)break;
   if(!idle(fleet)||selected&&!selected.has(fleet.fleet_id)||this.data.fleets.some(r=>r.fleetId===fleet.fleet_id))continue;
   const system=await read('get_system',{system_id:fleet.system_id});
   if(system?.id!==fleet.system_id||!Array.isArray(system.hyperlanes)||!system.fleets?.some(f=>f.id===fleet.fleet_id&&f.own===true&&f.ship_class==='shipclass_military'))continue;
   this.data.fleets.push({fleetId:fleet.fleet_id,phase:'planning',targetSystemId:null,trackingId:'',visited:[],graph:[],retryable:true,reason:'本人的现有空闲军舰持续安全探索目标'});
  }
  const now=this.now(),eligible=this.data.fleets.slice(0,this.maxFleets).filter(row=>row.phase!=='moving'&&!(row.phase==='blocked'&&row.retryable!==true)&&
   !this.pending.some(p=>p.fleetId===row.fleetId)&&(!selected||selected.has(row.fleetId))&&now>=(this.cooldowns.get(row.fleetId)??-Infinity)&&now-(this.lastPlan.get(row.fleetId)??-Infinity)>=this.reconsiderAfterMs);
  if(!eligible.length){await this.save();return {status:this.pending.some(p=>p.status==='unknown')?'attention':'waiting',reason:this.pending.some(p=>p.status==='unknown')?'存在未知航段，未重放；其余已受理航段继续等待真实抵达':'等待真实抵达、已有任务完成或前沿条件变化',allowNativeEconomy:true};}
  const row=eligible[this.cursor++%eligible.length];this.lastPlan.set(row.fleetId,now);
  const actual=tactics.fleets.find(f=>f.fleet_id===row.fleetId);
  if(!idle(actual)){
   const released=await this.release(row.fleetId,control);await this.save();return {status:released.blocked?'attention':'waiting',fleetId:row.fleetId,reason:released.reason??'舰队已有真实任务或当前位置不可用，不覆盖；交还原生防务',allowNativeEconomy:true};
  }
  if(!control.protectedFleetIds.includes(row.fleetId)){
   if(typeof this.ensureProtection!=='function')return {status:'needs_native_fleet_protection',fleetId:row.fleetId,reason:'没有保持原生经济运行的逐舰保护通路',allowNativeEconomy:true};
   // Claim the absent extra protection before its native write. If the write
   // succeeds but its receipt/readback is lost, withdrawal can still release
   // this exact generation's protection after a fresh native list read.
   this.protections=this.protections.filter(p=>p.fleetId!==row.fleetId);
   const claim={fleetId:row.fleetId,generation:control.generation};this.protections.push(claim);
   try{await this.save();}catch(error){this.protections=this.protections.filter(p=>p!==claim);throw error;}
   const result=await this.ensureProtection({fleetId:row.fleetId,binding:this.binding,generation:control.generation});
   if(result?.added===false){this.protections=this.protections.filter(p=>p!==claim);await this.save();}
   const after=await this.control();
   if(result?.confirmed!==true||typeof result.added!=='boolean'||result.binding!==this.binding||result.generation!==control.generation||!this.controlMatches(after)||after.generation!==control.generation||!after.protectedFleetIds.includes(row.fleetId))return {status:'attention',fleetId:row.fleetId,reason:'逐舰保护未得到本轮同代原生回读，未派移动',allowNativeEconomy:true};
   control=after;
   try{await this.save();}catch(error){await this.release(row.fleetId,control);throw error;}
  }
  const plan=await planExplorationLeg(this.data,{state,fleetId:row.fleetId,rpc:read,protectionConfirmed:true,minimumIntel:control.explorationMinimumIntel});
  if(plan.status!=='ready'){
   if(Number.isFinite(plan.retryAfterMs))this.cooldowns.set(row.fleetId,now+Math.min(120000,Math.max(this.reconsiderAfterMs,plan.retryAfterMs)));
   const released=await this.release(row.fleetId,control);await this.save();return {...plan,fleetId:row.fleetId,...released.blocked?{status:'attention',reason:released.reason}:{},allowNativeEconomy:true};
  }
  if(typeof this.dispatch!=='function'){const released=await this.release(row.fleetId,control);await this.save();return {status:'attention',fleetId:row.fleetId,reason:released.reason??'缺少已保护单舰正常命令派发通路，未调用 human-only apply',allowNativeEconomy:true};}
  const checked=await this.control();
  if(!this.controlMatches(checked)||checked.generation!==control.generation||!checked.protectedFleetIds.includes(row.fleetId))return {status:'attention',fleetId:row.fleetId,reason:'派单前逐舰保护或原生会话已变化，未写入'};
  const pending={fleetId:row.fleetId,fromSystemId:actual.system_id,targetSystemId:plan.order.arguments.system_id,
   requestId:`owner-exploration:${++this.sequence}:${row.fleetId}:${plan.order.arguments.system_id}`,status:'prepared',trackingId:''};
  this.pending.push(pending);
  // A crash after this durable preparation cannot replay a possibly accepted
  // engine command. The native adapter must also maintain its durable receipt.
  try{await this.save();}catch(error){this.pending=this.pending.filter(p=>p!==pending);await this.release(row.fleetId,checked);throw error;}
  let result;
  try{result=await this.dispatch({order:plan.order,proof:plan.proof,requestId:pending.requestId,binding:this.binding,generation:checked.generation});}
  catch(error){result={accepted:false,error:text(error.message),nativeWriteAttempted:error.nativeWriteAttempted===false?false:undefined};}
  if(result?.accepted===true&&typeof result.trackingId==='string'&&result.trackingId){
   pending.status='tracked';pending.trackingId=result.trackingId;
   recordExplorationLeg(this.data,{state,fleetId:row.fleetId,fromSystemId:actual.system_id,targetSystemId:pending.targetSystemId,trackingId:result.trackingId,accepted:true});
   await this.save();return {status:'moving',fleetId:row.fleetId,trackingId:result.trackingId,order:plan.order,proof:plan.proof,allowNativeEconomy:true};
  }
  const definitelyUnsent=result?.nativeWriteAttempted===false&&result?.unknown!==true,explicitRejection=result?.accepted===false&&result?.rejected===true&&result?.unknown!==true;
  if(definitelyUnsent||explicitRejection){
   this.pending=this.pending.filter(p=>p!==pending);const policy=explicitRejection&&!definitelyUnsent?rejectionPolicy(result?.error):{retryable:true,cooldownMs:this.reconsiderAfterMs};
   Object.assign(row,{phase:'blocked',retryable:policy.retryable,reason:text(result?.error??'引擎明确未受理，等待重新核对条件')});
   if(policy.retryable)this.cooldowns.set(row.fleetId,now+policy.cooldownMs);
  }
  else{
   pending.status='unknown';if(typeof result?.trackingId==='string'&&result.trackingId){pending.trackingId=result.trackingId;row.trackingId=result.trackingId;row.targetSystemId=pending.targetSystemId;}
   Object.assign(row,{phase:'blocked',retryable:false,reason:'移动回执或跟踪号未知，禁止自动重放或替换航段'});
  }
  const released=await this.release(row.fleetId,checked);await this.save();
  return {status:definitelyUnsent?'deferred':'attention',fleetId:row.fleetId,reason:released.reason??row.reason,unknown:!definitelyUnsent&&!explicitRejection,allowNativeEconomy:true};
 }
}
