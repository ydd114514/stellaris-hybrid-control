import {randomUUID} from 'node:crypto';
import {surveyIdleReason} from './survey-idle-policy.mjs';

const validId=id=>Number.isSafeInteger(id)&&id>=0&&id<0xffffffff;
const exactSurvey=s=>s?.known===true&&s.automation_enabled===true&&
 s.order_chain_complete===true&&s.automation_order_count===1&&
 s.orders?.filter(o=>o.automation===true).length===1&&
 [2,0x402].includes(s.orders.find(o=>o.automation===true).settings_bits)&&
 s.orders.find(o=>o.automation===true).action_option_count===0;
const disabled=s=>s?.known===true&&s.automation_enabled===false&&s.order_chain_complete===true;
export const surveyEnableUnconfirmed=r=>r&&Object.hasOwn(r,'enableUnconfirmed')?r.enableUnconfirmed!==false:!!(r?.pending&&r.desired===true&&r.writeAttempted!==false&&r.receipt?.success!==false);

// Stored with existing durable tasks; native replies never grant authority alone.
export class SurveyDelegation {
 constructor({store,save,rpc,isStopped,sessionId=randomUUID(),now=Date.now}) {
  Object.assign(this,{store,save,rpc,isStopped,sessionId,now});this.closed=false;
 }
 record(id){
  if(!validId(id))throw Error('科研舰队ID无效');
  const data=this.store();data.records??={};data.revision??=0;
  return data.records[id];
 }
 assertManual(order){
  const a=order.arguments||{},ids=[a.fleet_id,...(a.fleet_ids||[])].filter(validId);
  for(const id of ids){const r=this.record(id);if(r&&(r.sessionId!==this.sessionId||r.owner!=='manual'))throw Error('科研船控制权尚未交回，禁止覆盖自动化订单');}
 }
 async inspect(id){
  this.record(id);
  return this.rpc('get_fleet_automation',{fleet_id:id});
 }
 async change(id,enabled,{recover=false}={}){
  if(typeof enabled!=='boolean')throw Error('委派状态必须为布尔值');
  if(this.closed||this.isStopped())throw Error('控制会话已停止');
  const previous=this.record(id);
  if(previous&&previous.sessionId!==this.sessionId&&!recover)throw Error('旧会话的控制权先用recover核对收回');
  if(previous?.pending&&!(recover&&!enabled))throw Error('上次控制权交接尚未对账');
  const before=await this.inspect(id);
  if(this.closed||this.isStopped())throw Error('控制会话已停止');
  if(before?.known!==true)throw Error('自动化真实状态未知，禁止交接');
  if(recover&&surveyEnableUnconfirmed(previous)&&disabled(before))
   throw Error('开启结果仍未确认，不能用一次空闲回读解除在途保护');
  if(enabled&&(!disabled(before)||before.orders?.length))throw Error('先收回现有订单，再委派自动调查');
  const data=this.store(),revision=++data.revision;
  const record={fleetId:id,sessionId:this.sessionId,revision,owner:'unknown',desired:enabled,pending:true,writeAttempted:false};
  data.records[id]=record;await this.save(); // durable intent before any write
  const current=()=>!this.closed&&!this.isStopped()&&data.records[id]===record&&data.revision===revision;
  if(!current())throw Error('交接已过期或停止');
  try{
   if(!(disabled(before)&&!enabled)){
    const candidate=await this.rpc('set_survey_automation',{fleet_id:id,enabled,execute:false});
    if(!current())throw Error('交接已过期或停止');
    if(candidate?.success!==true)throw Error(candidate?.error||'引擎拒绝自动调查交接');
    // Once the write is attempted, all failures retain unknown ownership.
    record.writeAttempted=true;await this.save();
    if(!current())throw Error('交接已过期或停止');
    const result=await this.rpc('set_survey_automation',{fleet_id:id,enabled,execute:true});
    if(!current())throw Error('交接已过期或停止');
    record.receipt=result;
   }
   return await this.reconcile(id,record);
  }catch(error){record.error=error.message;await this.save();throw error;}
 }
 async reconcile(id,expected=this.record(id),{gameDate}={}){
  if(!expected)throw Error('没有该科研船的交接记录');
  const state=await this.inspect(id);
  if(this.closed||this.isStopped()||this.record(id)!==expected||expected.sessionId!==this.sessionId)
   throw Error('交接回读已过期或停止');
  expected.observation=state;
  expected.observedAt=this.now();
  if(state?.known===true&&state.automation_enabled===true)expected.enableUnconfirmed=false;
  if(expected.desired?exactSurvey(state):disabled(state)&&!expected.enableUnconfirmed){
   expected.owner=expected.desired?'native':'manual';expected.pending=false;
   const idle=expected.owner==='native'&&!state.orders.some(o=>o.automation===false);
   if(idle){expected.idleSince??=this.now();if(gameDate!==undefined)expected.idleReason=surveyIdleReason(expected,{gameDate,now:this.now()});}
   else for(const key of ['idleSince','idleGameDay','idleLastGameDay','idleReason'])delete expected[key];
  }else{expected.owner='unknown';expected.pending=true;}
  await this.save();return structuredClone(expected);
 }
 async recover(id){return this.change(id,false,{recover:true});}
 async monitor({maxQueries=2,gameDate}={}){
  if(this.closed||this.isStopped())return {trusted:false,reasons:['survey_monitor_stopped']};
  const rows=Object.values(this.store().records||{}),reasons=[];
  const current=rows.filter(r=>r.sessionId===this.sessionId);
  if(rows.some(r=>r.sessionId!==this.sessionId))reasons.push('survey_recovery_required');
  const start=current.length?(this.monitorCursor||0)%current.length:0;
  this.monitorCursor=start+maxQueries;
  const selected=current.length?Array.from({length:Math.min(maxQueries,current.length)},(_,i)=>current[(start+i)%current.length]):[];
  for(const r of selected){
   try{await this.reconcile(r.fleetId,r,{gameDate});}catch(error){r.owner='unknown';r.pending=true;r.error=error.message;}
  }
  if(this.closed||this.isStopped())return {trusted:false,reasons:['survey_monitor_stopped']};
  if(current.some(r=>r.owner==='unknown'||r.pending))reasons.push('survey_state_unknown');
  const native=current.filter(r=>r.owner==='native');
  for(const r of native.filter(r=>selected.includes(r)&&Number.isFinite(r.idleSince))){
   if(gameDate===undefined)reasons.push('survey_state_unknown');
   else if(r.idleReason)reasons.push(r.idleReason);
  }
  const trusted=!reasons.length&&native.length>0&&native.every(r=>this.now()-r.observedAt<=3000&&exactSurvey(r.observation)&&r.observation.orders.some(o=>o.automation===false));
  return {trusted,reasons};
 }
 close(){if(this.closed)return;this.closed=true;for(const r of Object.values(this.store().records||{}))if(r.owner!=='manual'){r.enableUnconfirmed=surveyEnableUnconfirmed(r);r.owner='unknown';r.pending=true;}}
 async cleanup(){
  const outcomes=[];
  for(const r of Object.values(this.store().records||{}).filter(r=>r.sessionId===this.sessionId&&r.owner!=='manual')){
   try{
    r.enableUnconfirmed=surveyEnableUnconfirmed(r);r.owner='unknown';r.pending=true;r.desired=false;await this.save();
    let observed=await this.inspect(r.fleetId);
    if(observed?.known===true&&observed.automation_enabled===true){
     r.enableUnconfirmed=false;
     await this.rpc('set_survey_automation',{fleet_id:r.fleetId,enabled:false,execute:true});
     observed=await this.inspect(r.fleetId);
    }
    const confirmed=disabled(observed)&&!r.enableUnconfirmed;
    r.owner=confirmed?'manual':'unknown';r.pending=!confirmed;r.desired=false;r.observation=observed;
    outcomes.push({fleetId:r.fleetId,confirmed,state:observed});
   }catch(error){r.owner='unknown';r.pending=true;r.error=error.message;outcomes.push({fleetId:r.fleetId,confirmed:false,error:error.message});}
  }
  if(outcomes.length)await this.save();return outcomes;
 }
 view(){return structuredClone(this.store());}
}
