import {ECONOMY_FOCUSES} from './operator-standing.mjs';
import {councilAgendaProblem} from './council-agendas.mjs';
import {normalizeNativeOwnerPolicy} from './native-country-ai-economic-policy.mjs';
import {economicEdictActivationProblem} from './owner-economic-policy.mjs';
export const STRATEGY_DIMENSIONS={economyFocus:ECONOMY_FOCUSES,expansionStance:['aggressive','consolidate'],militaryStance:['peaceful','prepare_war']};
export const RESERVED_ACTIONS={declare_war:'declare_war',offer_peace:'offer_peace',diplo_propose:'diplomacy',diplo_respond:'respond_diplomacy'};
export const reservedOrder=command=>Object.values(RESERVED_ACTIONS).includes(command);
export const steeringRPC=(method,params)=>method==='toggle_edict'&&/^cfsteer_(economy|expansion|military)_/.test(params?.edict_key??'')&&typeof params.enabled==='boolean';
export const reservedRPC=method=>['declare_war','offer_peace','diplomacy_action','respond_diplomacy'].includes(method);
// Verified toggle edicts in Stellaris 4.5.2 common/edicts/00_edicts.txt.
// Keep this explicit: active mod/system/role edicts are not ordinary settings.
export const ORDINARY_EDICT_KEYS=Object.freeze([
 'evacuation_protocols','fortify_the_border','nutritional_plenitude','nutritional_plenitude_hive','expanded_breeding_program_servitor',
 'fleet_supremacy','diplomatic_grants','enhanced_surveillance','bureau_of_espionage','observation_instinct','covert_analysis_algorithm',
 'tracking_implants','thought_enforcement','thought_enforcement_gestalt','extended_shifts','synaptic_reinforcement','industrial_maintenance',
 'drone_overdrive','drone_overdrive_wilderness','capacity_subsidies','capacity_subsidies_wilderness','mining_subsidies','mining_subsidies_wilderness',
 'mining_subsidies_nomadic','farming_subsidies','farming_subsidies_wilderness','industrial_subsidies','forge_subsidies','forge_subsidies_wilderness',
 'research_subsidies','research_subsidies_wilderness','veneration_of_saints','peace_festivals','information_quarantine','encourage_free_thought',
 'map_the_stars','land_of_opportunity','greater_than_ourselves'
]);
const ordinaryEdicts=new Set(ORDINARY_EDICT_KEYS);
const taskIdValid=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(value);
const nativeTargetName=row=>[row?.name,row?.title].find(x=>typeof x==='string'&&x.trim())?.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,120);
export function validateDomesticAction(action){
 if(!action||typeof action!=='object'||Array.isArray(action)||!['toggle_edict','set_council_agenda','launch_council_agenda'].includes(action.type)||Object.keys(action).some(k=>!['type','arguments','taskId'].includes(k))||action.taskId!==undefined&&!taskIdValid(action.taskId))throw Error('国内战略设置仅接受普通法令及内阁议程，任务编号须合法');
 const args=action.arguments;
 const task=action.taskId!==undefined?{taskId:action.taskId}:{};
 if(action.type!=='toggle_edict'){
  if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).length!==1||typeof args.agenda_key!=='string'||!/^agenda_[a-zA-Z0-9_]{1,100}$/.test(args.agenda_key))throw Error('内阁议程参数无效，只接受当前真实候选的agenda_key');
  return {type:action.type,arguments:{agenda_key:args.agenda_key},...task};
 }
 if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).length!==2||Object.keys(args).some(k=>!['edict_key','enabled'].includes(k))||typeof args.enabled!=='boolean'||!ordinaryEdicts.has(args.edict_key))throw Error('国内战略法令无效；方针、系统和角色维护法令不由此入口修改');
 return {type:'toggle_edict',arguments:{edict_key:args.edict_key,enabled:args.enabled},...task};
}
export function validateStrategyContract(raw,validateOrder){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>![...Object.keys(STRATEGY_DIMENSIONS),'oneOffActions','domesticActions','nativePolicy','reason','taskIds','taskUpdates'].includes(k)))throw Error('StrategyContract字段无效');
 for(const [key,values] of Object.entries(STRATEGY_DIMENSIONS))if(!values.includes(raw[key]))throw Error('战略方针无效：'+key);
 if(typeof raw.reason!=='string'||!raw.reason.trim()||raw.reason.length>300)throw Error('战略需要1..300字公开理由');
 if(!Array.isArray(raw.oneOffActions)||raw.oneOffActions.length>4)throw Error('战略只接受最多4项保留决定');
 const oneOffActions=raw.oneOffActions.map(a=>{
  if(!a||!Object.hasOwn(RESERVED_ACTIONS,a.type)||Object.keys(a).some(k=>!['type','arguments'].includes(k)))throw Error('战略只接受宣战、议和、外交提议和回应');
  if(!a.arguments||typeof a.arguments!=='object'||Array.isArray(a.arguments))throw Error('保留决定缺少参数');
  const order=validateOrder?.({command:RESERVED_ACTIONS[a.type],arguments:a.arguments});
  return {type:a.type,arguments:structuredClone(order?.arguments??a.arguments)};
 });
 let domesticActions;
 if(raw.domesticActions!==undefined){
  if(!Array.isArray(raw.domesticActions)||raw.domesticActions.length>4)throw Error('国内战略设置每次最多4项');
  domesticActions=raw.domesticActions.map(validateDomesticAction);
  if(new Set(domesticActions.map(a=>a.type==='toggle_edict'?`${a.type}:${a.arguments.edict_key}`:a.type)).size!==domesticActions.length)throw Error('同一次战略不能重复调整同一法令或重复设置/发动议程');
 }
 let taskIds,taskUpdates;
 if(raw.taskIds!==undefined){
  if(!Array.isArray(raw.taskIds)||raw.taskIds.length>12||!raw.taskIds.every(taskIdValid)||new Set(raw.taskIds).size!==raw.taskIds.length)throw Error('战略任务编号须为至多12个不同的合法编号');
  taskIds=[...raw.taskIds];
 }
 if(raw.taskUpdates!==undefined){
  if(!Array.isArray(raw.taskUpdates)||raw.taskUpdates.length>12)throw Error('战略任务更新每次最多12项');
  taskUpdates=raw.taskUpdates.map(row=>{
   if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).some(k=>!['taskId','status','reason'].includes(k))||!taskIdValid(row.taskId)||!['working','verifying','blocked','superseded'].includes(row.status)||typeof row.reason!=='string'||!row.reason.trim()||row.reason.length>180)throw Error('任务更新仅接受进行中、待核实、受阻或已取代及真实理由，不能自称完成');
   return {taskId:row.taskId,status:row.status,reason:row.reason.trim()};
  });
  if(new Set(taskUpdates.map(row=>row.taskId)).size!==taskUpdates.length)throw Error('同一次战略不能重复更新同一任务');
 }
 const stoppedTasks=new Set((taskUpdates??[]).filter(row=>['blocked','superseded'].includes(row.status)).map(row=>row.taskId));
 if((domesticActions??[]).some(action=>action.taskId&&stoppedTasks.has(action.taskId)))throw Error('已标受阻或终止的任务不能在同一次战略中继续下达具体操作');
 return {...Object.fromEntries(Object.keys(STRATEGY_DIMENSIONS).map(k=>[k,raw[k]])),oneOffActions,...(raw.nativePolicy!==undefined?{nativePolicy:normalizeNativeOwnerPolicy(raw.nativePolicy)}:{}),...(domesticActions?{domesticActions}:{}),...(taskIds?{taskIds}:{}),...(taskUpdates?{taskUpdates}:{}),reason:raw.reason.trim()};
}
export async function applyDomesticEdict({action,rpc,write,policyState,checkScope=async()=>{},heartbeat=async()=>{},wait=ms=>new Promise(r=>setTimeout(r,ms)),attempts=20,receipt={}}){
 const checked=validateDomesticAction(action);if(checked.type!=='toggle_edict')throw Error('法令入口不接受其他国内战略设置');
 const {arguments:params}=checked;let attempted=false;
 Object.assign(receipt,{type:'toggle_edict',arguments:params,...(checked.taskId?{taskId:checked.taskId}:{}),status:'checking',confirmed:false});
 const read=async()=>{
  await checkScope();await heartbeat();const raw=await rpc('get_edicts');
  const active=raw?.active_edicts,count=raw?.summary?.active_edicts_count;
  if(!Array.isArray(active)||!Number.isSafeInteger(count)||count!==active.length||active.some(e=>typeof e?.key!=='string')||new Set(active.map(e=>e.key)).size!==active.length)throw Error('当前启用法令清单不完整，不能执行或确认法令调整');
  return {raw,active:active.some(e=>e.key===params.edict_key)};
 };
 try{
  const before=await read();receipt.beforeActive=before.active;
  const targetName=nativeTargetName(before.raw.active_edicts.find(e=>e.key===params.edict_key))??nativeTargetName(before.raw.available_edicts?.find(e=>e.key===params.edict_key));
  if(targetName)receipt.targetName=targetName;
  if(before.active===params.enabled){Object.assign(receipt,{status:'confirmed',confirmed:true,changed:false});return receipt;}
  const candidate=before.raw.available_edicts?.find(e=>e.key===params.edict_key);
  if(params.enabled&&policyState?.userEconomicPolicy?.edictPolicy==='unity_net_gain'){
   await checkScope();await heartbeat();const status=await rpc('get_status'),wars=await rpc('get_wars');
   const problem=economicEdictActivationProblem(checked,{...policyState,resources:status?.resources,wars:wars?.wars,warGoalsWindow:wars?.warGoalsWindow});
   if(problem)throw Error(problem);
  }
  // Legacy available_edicts is a static catalog, not an engine legality query.
  if(params.enabled&&candidate?.can_activate!==true)throw Error('原生接口未确认该法令当前可启用，未发送；旧目录不代表合法候选');
  if(!params.enabled&&(candidate?.can_deactivate===false||before.raw.active_edicts.find(e=>e.key===params.edict_key)?.can_deactivate===false))throw Error('该法令当前不可停用，未发送');
  await checkScope();await heartbeat();attempted=true;receipt.status='submitting';
  const posted=await write('toggle_edict',params);
  if(posted?.success!==true)throw Object.assign(Error('法令调整未被原生接口接受'),{nativeWriteAttempted:false});
  receipt.status='posted';
  for(let i=0;i<attempts;i++){
   const after=await read();
   if(after.active===params.enabled){Object.assign(receipt,{status:'confirmed',confirmed:true,changed:true});return receipt;}
   if(i+1<attempts)await wait(100);
  }
  throw Error('法令调整已提交但回读尚未确认；不重发命令');
 }catch(error){receipt.status=attempted&&error.nativeWriteAttempted!==false?'unknown':'rejected';receipt.error=error.message;throw error;}
}
export async function applyDomesticCouncilAgenda({action,rpc,write,checkScope=async()=>{},heartbeat=async()=>{},wait=ms=>new Promise(r=>setTimeout(r,ms)),attempts=20,receipt={}}){
 const checked=validateDomesticAction(action),{type,arguments:params}=checked;let attempted=false;
 if(!['set_council_agenda','launch_council_agenda'].includes(type))throw Error('议程入口不接受其他国内战略设置');
 Object.assign(receipt,{type,arguments:params,...(checked.taskId?{taskId:checked.taskId}:{}),status:'checking',confirmed:false});
 const read=async()=>{
  await checkScope();await heartbeat();const council=(await rpc('get_status'))?.council;
  if(!council||typeof council.active_agenda!=='string')throw Error('当前内阁议程状态未知，未完成调整');
  return council;
 };
 try{
  const before=await read();receipt.beforeAgenda=before.active_agenda;
  await checkScope();await heartbeat();const government=await rpc('get_government');
  const targetName=nativeTargetName(government?.available_agendas?.find(row=>row.key===params.agenda_key))??nativeTargetName(government?.agenda?.key===params.agenda_key?government.agenda:null);
  if(targetName)receipt.targetName=targetName;
  if(type==='set_council_agenda'){
   if(before.active_agenda===params.agenda_key){Object.assign(receipt,{status:'confirmed',confirmed:true,changed:false});return receipt;}
   const problem=councilAgendaProblem(params.agenda_key,government??{});if(problem)throw Error(problem);
  }else if(before.active_agenda!==params.agenda_key||before.agenda_ready!==true||!Number.isFinite(before.agenda_progress)||!Number.isFinite(before.agenda_cost)||before.agenda_cost<=0||before.agenda_progress<before.agenda_cost){
   throw Error('当前议程不匹配或完整进度未就绪；不提前花费凝聚力发动');
  }
  // Re-read immediately before posting: native AI remains enabled and may have
  // changed agenda while the model was deciding. No stale ready flag is reused.
  const current=await read();
  if(type==='launch_council_agenda'&&(current.active_agenda!==params.agenda_key||current.agenda_ready!==true||!Number.isFinite(current.agenda_progress)||!Number.isFinite(current.agenda_cost)||current.agenda_cost<=0||current.agenda_progress<current.agenda_cost))throw Error('发送前议程或完整就绪条件改变，未发动');
  if(type==='set_council_agenda'&&current.active_agenda!==before.active_agenda)throw Error('发送前议程已被原生AI调整，先重新评估，不覆盖变化');
  await checkScope();await heartbeat();attempted=true;receipt.status='submitting';
  // The bridge launch RPC has no early-launch payment option. It only posts
  // CFinishAgendaCommand after engine progress has reached its required cost.
  const posted=await write(type,params);
  if(posted?.success!==true)throw Object.assign(Error('议程调整未被原生接口接受'),{nativeWriteAttempted:false});
  receipt.status='posted';
  if(type==='launch_council_agenda'){
   const after=await read();receipt.afterAgenda=after.active_agenda;
   throw Error('议程正常发动已提交；当前桥无已发动历史或增益回读，尚未确认效果，不重发命令');
  }
  for(let i=0;i<attempts;i++){
   const after=await read();
   if(after.active_agenda===params.agenda_key){Object.assign(receipt,{status:'confirmed',confirmed:true,changed:true});return receipt;}
   if(i+1<attempts)await wait(100);
  }
  throw Error('议程选择已提交但回读尚未确认；不重发命令');
 }catch(error){receipt.status=attempted&&error.nativeWriteAttempted!==false?'unknown':'rejected';receipt.error=error.message;throw error;}
}
export async function applyDomesticAction(options){
 const checked=validateDomesticAction(options.action);
 return checked.type==='toggle_edict'?applyDomesticEdict({...options,action:checked}):applyDomesticCouncilAgenda({...options,action:checked});
}
export function steeringKeys(contract){return {economyFocus:'cfsteer_economy_'+contract.economyFocus,expansionStance:'cfsteer_expansion_'+contract.expansionStance,militaryStance:'cfsteer_military_'+contract.militaryStance};}
const prefixes={economyFocus:'cfsteer_economy_',expansionStance:'cfsteer_expansion_',militaryStance:'cfsteer_military_'};
export async function applySteering({contract,rpc,heartbeat=async()=>{},wait=ms=>new Promise(r=>setTimeout(r,ms)),attempts=20}){
 const read=async()=>{const raw=await rpc('get_edicts');if(!Array.isArray(raw?.active_edicts))throw Error('方针法令状态不可读');return new Set(raw.active_edicts.map(e=>e.key));};
 const confirmed=async(key,on)=>{for(let i=0;i<attempts;i++){await heartbeat();const active=await read();if(active.has(key)===on)return;if(i+1<attempts)await wait(100);}throw Error('方针切换尚未确认；不重放命令，请检查mod已启用');};
 let active=await read();
 for(const [dimension,key] of Object.entries(steeringKeys(contract))){
  for(const old of active)if(old.startsWith(prefixes[dimension])&&old!==key){
   const r=await rpc('toggle_edict',{edict_key:old,enabled:false});if(r?.success!==true)throw Error('旧方针未撤销');await confirmed(old,false);
  }
  active=await read();if(!active.has(key)){const r=await rpc('toggle_edict',{edict_key:key,enabled:true});if(r?.success!==true)throw Error('新方针未提交');await confirmed(key,true);}
  active=await read();
 }
 return {confirmed:true,keys:steeringKeys(contract)};
}
export const strategyContractSchema={type:'object',additionalProperties:false,required:[...Object.keys(STRATEGY_DIMENSIONS),'oneOffActions','reason'],properties:{
 ...Object.fromEntries(Object.entries(STRATEGY_DIMENSIONS).map(([k,v])=>[k,{enum:v}])),reason:{type:'string',minLength:1,maxLength:300},
 nativePolicy:{type:'object',additionalProperties:false,required:['peaceful_exploration','use_existing_science'],properties:{peaceful_exploration:{type:'boolean'},use_existing_science:{type:'boolean'}},description:'把已采纳的目标转为原生生产约束：和平探索阶段不新造军舰；复用现有科研船，失去现有船后允许补充。真实战争/和平不可确认时保留原生防务。本人明确要求优先，不能用false解除本人要求；此设置不等于舰队已经执行探索移动。'},
 taskIds:{type:'array',maxItems:12,uniqueItems:true,items:{type:'string',pattern:'^[a-zA-Z0-9_-]{1,100}$'},description:'当前任务账本中由本次战略推进的任务编号；不能猜编号或关联旧局任务'},
 taskUpdates:{type:'array',maxItems:12,items:{type:'object',additionalProperties:false,required:['taskId','status','reason'],properties:{taskId:{type:'string',pattern:'^[a-zA-Z0-9_-]{1,100}$'},status:{enum:['working','verifying','blocked','superseded']},reason:{type:'string',minLength:1,maxLength:180}}},description:'逐条说明推进、待核实、受阻或被新意图取代的原因，不能输入成功；已取代不撤销已提交操作，完成仅依据真实回读'},
 domesticActions:{type:'array',maxItems:4,description:'低频国内战略设置：普通法令、选择内阁议程、完整就绪后正常发动议程。发动无提前付款选项且当前桥缺效果回读，会保留待核实、不重放。普通法令启用需原生明确can_activate=true；方针和系统/角色维护法令不可修改。',items:{oneOf:[
  {type:'object',additionalProperties:false,required:['type','arguments'],properties:{type:{const:'toggle_edict'},taskId:{type:'string',pattern:'^[a-zA-Z0-9_-]{1,100}$'},arguments:{type:'object',additionalProperties:false,required:['edict_key','enabled'],properties:{edict_key:{enum:ORDINARY_EDICT_KEYS},enabled:{type:'boolean'}}}}},
  ...['set_council_agenda','launch_council_agenda'].map(type=>({
   type:'object',additionalProperties:false,required:['type','arguments'],properties:{
    type:{const:type},taskId:{type:'string',pattern:'^[a-zA-Z0-9_-]{1,100}$'},
    arguments:{type:'object',additionalProperties:false,required:['agenda_key'],properties:{agenda_key:{type:'string',pattern:'^agenda_[a-zA-Z0-9_]{1,100}$'}}}
   }
  }))
 ]}},
 oneOffActions:{type:'array',maxItems:4,items:{type:'object',additionalProperties:false,required:['type','arguments'],properties:{type:{enum:Object.keys(RESERVED_ACTIONS)},arguments:{type:'object'}}}}
}};
