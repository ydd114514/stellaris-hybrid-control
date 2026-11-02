const finite=Number.isFinite;
const enabled=state=>state?.userEconomicPolicy?.source==='user-current-chat'&&state.userEconomicPolicy.priority==='unity_first'&&state.userEconomicPolicy.resourcePolicy==='deficit_only';
const resources=['energy','minerals','food','consumer_goods','alloys','trade'];

// Net already includes upkeep. A low stockpile or a modest positive income is
// not a production deficit. Upcoming costs must come from the caller's actual
// quotes/commitments, never a desired arbitrary surplus target.
export function economicResourceGap(state,key,{upcomingCost=0,commitments=0,additionalMonthlyUpkeep=0}={}){
 const row=state?.resources?.[key];
 if(!row||row.net_known===false||row.stockpile_known===false||!finite(row.net)||!finite(row.stockpile)||row.stockpile<0||
  ![upcomingCost,commitments,additionalMonthlyUpkeep].every(n=>finite(n)&&n>=0))return {known:false,needed:null,reason:'当前资源或已确认后续费用未知'};
 const projectedNet=row.net-additionalMonthlyUpkeep,availableAfterCosts=row.stockpile-upcomingCost-commitments;
 const actualDeficit=row.net<0,upcomingDeficit=projectedNet<0||availableAfterCosts+Math.min(0,projectedNet)<0;
 return {known:true,needed:actualDeficit||upcomingDeficit,actualDeficit,upcomingDeficit,net:row.net,projectedNet,stockpile:row.stockpile,availableAfterCosts,
  reason:actualDeficit?'已有真实月度赤字':upcomingDeficit?'已确认费用或新增维护会形成缺口':'当前净产与已确认费用可承受，不追加盈余产能目标'};
}

// Effects and unity-denominated upkeep verified from installed 4.5.2
// common/edicts/00_edicts.txt. This table describes purpose, not saved amounts.
const edictResources={
 capacity_subsidies:['energy'],mining_subsidies:['minerals'],farming_subsidies:['food'],
 industrial_subsidies:['consumer_goods'],forge_subsidies:['alloys'],
 research_subsidies:['physics_research','society_research','engineering_research'],
 synaptic_reinforcement:['trade','energy'],industrial_maintenance:['trade','energy'],
 encourage_free_thought:[]
};
const warEdicts=new Set(['fortify_the_border','fleet_supremacy','evacuation_protocols']);
const completeEdicts=raw=>Array.isArray(raw?.active_edicts)&&Number.isSafeInteger(raw.summary?.active_edicts_count)&&raw.summary.active_edicts_count===raw.active_edicts.length&&
 raw.active_edicts.every(row=>typeof row?.key==='string')&&new Set(raw.active_edicts.map(row=>row.key)).size===raw.active_edicts.length;
const inWar=state=>Array.isArray(state?.wars)&&state.wars.length>0||state?.warGoalsWindow===true;
const edictPolicy=state=>enabled(state)&&state.userEconomicPolicy.edictPolicy==='unity_net_gain';
function postDisableResources(projection,key,state,keys){
 // Caller-supplied projections are trusted only after actual verification and
 // binding to this exact observation. Current positive net is not that proof.
 if(projection?.verified!==true||projection.edictKey!==key||projection.action!=='disable'||
  typeof state.snapshotId!=='string'||projection.snapshotId!==state.snapshotId||typeof state.date!=='string'||projection.date!==state.date||
  keys.some(resource=>projection.resources?.[resource]?.net_known!==true||!finite(projection.resources[resource].net)))return null;
 return {...state.resources,...Object.fromEntries(keys.map(resource=>[resource,{...state.resources?.[resource],
  net:projection.resources[resource].net,net_known:true}]))};
}

/** Derives bounded strategic actions; the existing strategy executor owns all
 * writes, native legality checks, uncertainty fencing and effect readback. */
export function ownerEconomicPolicyReview(state,{edicts,upcomingCosts={},commitments={},additionalMonthlyUpkeep={},postDisableProjections={}}={}){
 const active=enabled(state),gaps=Object.fromEntries(resources.map(key=>[key,economicResourceGap(state,key,{upcomingCost:upcomingCosts[key]??0,commitments:commitments[key]??0,additionalMonthlyUpkeep:additionalMonthlyUpkeep[key]??0})]));
 const review={active,resourcePolicy:active?'deficit_only':null,gaps,domesticActions:[],deferred:[],
  civilianFleetPolicy:state?.userEconomicPolicy?.civilianFleetPolicy??null,automaticLeaderRecruitment:false,
  unitySavingsKnown:false};
 if(!edictPolicy(state))return review;
 if(!Array.isArray(state.wars)||inWar(state)){
  review.deferred.push({kind:'edict_review',reason:'真实战争、防务或战况未知时保留现有设置，先完成战略复查'});return review;
 }
 if(!completeEdicts(edicts)){
  review.deferred.push({kind:'edict_review',reason:'当前完整法令清单尚未读取，不把缺失当未启用'});return review;
 }
 for(const row of edicts.active_edicts){
  if(!Object.hasOwn(edictResources,row.key))continue;
  const candidate=edicts.available_edicts?.find(entry=>entry.key===row.key);
  if(row.can_deactivate===false||candidate?.can_deactivate===false){review.deferred.push({key:row.key,reason:'原生明确不可停用'});continue;}
  const nativeZero=row.upkeep_known===true&&row.upkeep&&finite(row.upkeep.unity)&&row.upkeep.unity===0;
  if(nativeZero)continue;
  const keys=edictResources[row.key].filter(resource=>resources.includes(resource));
  if(keys.length){
   const projected=postDisableResources(postDisableProjections[row.key],row.key,state,keys);
   if(!projected){review.deferred.push({key:row.key,reason:'缺少停用后已核实且属于本轮的资源净收支投影；当前正产可能依赖补贴，保留法令'});continue;}
   const needs=keys.map(key=>economicResourceGap({...state,resources:projected},key,{upcomingCost:upcomingCosts[key]??0,commitments:commitments[key]??0,additionalMonthlyUpkeep:additionalMonthlyUpkeep[key]??0}));
   if(needs.some(gap=>!gap.known||gap.needed)){
    review.deferred.push({key:row.key,reason:needs.some(gap=>gap.needed)?'停用后将形成真实或即将发生的资源缺口，保留保供法令':'停用后的资源覆盖未知，保留法令'});continue;
   }
  }
  if(review.domesticActions.length<4)review.domesticActions.push({type:'toggle_edict',arguments:{edict_key:row.key,enabled:false}});
 }
 return review;
}

export function economicEdictActivationProblem(action,state){
 if(action?.type!=='toggle_edict'||action.arguments?.enabled!==true||!edictPolicy(state))return null;
 const key=action.arguments.edict_key;
 if(warEdicts.has(key)&&inWar(state))return null;
 if(Object.hasOwn(edictResources,key)){
  const gaps=edictResources[key].map(resource=>economicResourceGap(state,resource));
  if(gaps.some(gap=>gap.known&&gap.needed))return null;
  return gaps.some(gap=>!gap.known)?'相关资源净产或库存未知，未确认新法令有必要，先复查':
   '本人要求凝聚力净收益优先；当前没有该补贴对应的真实缺口，不新增凝聚力法令消耗';
 }
 return '当前未核实该新法令的凝聚力净收益或必要保供作用，保留凝聚力并先复查';
}

// A direct-order guard for the same owner policy. Native country AI remains
// responsible for ordinary construction; no fixed ship/leader count is imposed.
export function existingExplorerOrderProblem(order,state,{shipClass,leaderClass,leaders}={}){
 if(state?.userEconomicPolicy?.civilianFleetPolicy!=='use_existing_explorers')return null;
 if(order?.command==='build_ship'&&shipClass==='shipclass_science_ship'){
  const ships=state.civilian?.science_ships;
  if(!Array.isArray(ships))return '现有科研船覆盖未知，先核对再新增科研船';
  if(ships.some(ship=>Number.isSafeInteger(ship.fleet_id)&&ship.fleet_id>=0&&(ship.total_ships>0||Number.isSafeInteger(ship.ship_id)&&ship.ship_id>=0&&ship.ship_id<0xffffffff)))return '本人要求先用已有科研船，不为同一探索能力重复造船';
  if(ships.length)return '已有科研舰队但有效舰船数量未确认，先核对现有能力再新增科研船';
 }
 if(order?.command==='hire_leader'&&leaderClass==='scientist'){
  if(!Array.isArray(leaders?.hired_leaders))return '现有科学家明细未知，先核对已有领袖再花凝聚力招募';
  if(leaders.hired_leaders.some(leader=>leader.leader_class==='scientist'||leader.class==='scientist'))return '已有科学家可供调配，先使用或重新分配现有领袖，不额外花凝聚力招募';
 }
 return null;
}
