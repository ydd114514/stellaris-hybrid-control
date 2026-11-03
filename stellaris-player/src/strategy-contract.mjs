import {STEERING_EFFECTS} from './strategy-brief.mjs';
import {surveyGameDay} from './survey-idle-policy.mjs';

export const STRATEGY_DIMENSIONS={economyFocus:['balanced','consumer_stability','alloys_military','research'],expansionStance:['aggressive','consolidate'],militaryStance:['peaceful','prepare_war']};
export const RESERVED_ACTIONS={declare_war:'declare_war',offer_peace:'offer_peace',diplo_propose:'diplomacy',diplo_respond:'respond_diplomacy'};
export const reservedOrder=command=>Object.values(RESERVED_ACTIONS).includes(command);
export const steeringRPC=(method,params)=>method==='toggle_edict'&&/^cfsteer_(economy|expansion|military)_/.test(params?.edict_key??'')&&typeof params.enabled==='boolean';
export const reservedRPC=method=>['declare_war','offer_peace','diplomacy_action','respond_diplomacy'].includes(method);
const GOAL_METRICS=['pops','colonies','systems','research_monthly','alloys_monthly','fleet_power','naval_used_ratio'];
const countryIdSchema={type:'integer',minimum:0,maximum:4294967294};
const countryId=value=>Number.isSafeInteger(value)&&value>=0&&value<=countryIdSchema.maximum;

function validateGoals(goals,currentDate){
 if(!Array.isArray(goals)||goals.length<1||goals.length>3)throw Error('战略需要1～3个可量化目标（goals）');
 const today=surveyGameDay(currentDate);
 if(today===null)throw Error('当前游戏日期未知，请先读取战略简报');
 return goals.map(goal=>{
  const deadline=surveyGameDay(goal?.byDate);
  if(!goal||Object.keys(goal).length!==3||!GOAL_METRICS.includes(goal.metric)||!Number.isFinite(goal.target)||goal.target<0||deadline===null)
   throw Error('战略目标需要有效指标、非负数值和 YYYY.MM.DD 截止日期');
  if(deadline>today+20*360)throw Error('战略目标的截止日期不能超过当前游戏日期20年');
  return {metric:goal.metric,target:goal.target,byDate:goal.byDate};
 });
}

function validateCountryDirection(value,key){
 if(!value||Object.keys(value).length!==1||!countryId(value[key]))throw Error('扩张方向或备战目标需要有效的已知帝国ID');
 return {[key]:value[key]};
}

export function validateStrategyContract(raw,validateOrder,{currentDate,empireType,requireGoals=true}={}){
 const goalFields=requireGoals?['goals','expansionDirection','warTarget']:[];
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>![...Object.keys(STRATEGY_DIMENSIONS),'oneOffActions','reason',...goalFields].includes(k)))throw Error('StrategyContract字段无效');
 for(const [key,values] of Object.entries(STRATEGY_DIMENSIONS))if(!values.includes(raw[key]))throw Error('战略方针无效：'+key);
 if(['hive','machine'].includes(empireType)&&raw.economyFocus==='consumer_stability'){
  throw Error(STEERING_EFFECTS[empireType].economyFocus.consumer_stability+'；请改选其他方针或用 balanced');
 }
 const goals=requireGoals?validateGoals(raw.goals,currentDate):undefined;
 const expansionDirection=raw.expansionDirection===undefined?undefined:validateCountryDirection(raw.expansionDirection,'towardCountryId');
 const warTarget=raw.warTarget===undefined?undefined:validateCountryDirection(raw.warTarget,'countryId');
 if(warTarget&&raw.militaryStance!=='prepare_war')throw Error('只有备战（prepare_war）方针才能设置战争目标');
 if(typeof raw.reason!=='string'||!raw.reason.trim()||raw.reason.length>300)throw Error('战略需要1..300字公开理由');
 if(!Array.isArray(raw.oneOffActions)||raw.oneOffActions.length>4)throw Error('战略只接受最多4项保留决定');
 const oneOffActions=raw.oneOffActions.map(a=>{
  if(!a||!Object.hasOwn(RESERVED_ACTIONS,a.type)||Object.keys(a).some(k=>!['type','arguments'].includes(k)))throw Error('战略只接受宣战、议和、外交提议和回应');
  if(!a.arguments||typeof a.arguments!=='object'||Array.isArray(a.arguments))throw Error('保留决定缺少参数');
  const order=validateOrder?.({command:RESERVED_ACTIONS[a.type],arguments:a.arguments});
  return {type:a.type,arguments:structuredClone(order?.arguments??a.arguments)};
 });
 return {...Object.fromEntries(Object.keys(STRATEGY_DIMENSIONS).map(k=>[k,raw[k]])),oneOffActions,reason:raw.reason.trim(),
  ...(goals?{goals}:{}),...(expansionDirection?{expansionDirection}:{}),...(warTarget?{warTarget}:{})};
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
export const legacyStrategyContractSchema={type:'object',additionalProperties:false,required:[...Object.keys(STRATEGY_DIMENSIONS),'oneOffActions','reason'],properties:{
 ...Object.fromEntries(Object.entries(STRATEGY_DIMENSIONS).map(([k,v])=>[k,{enum:v}])),reason:{type:'string',minLength:1,maxLength:300},
 oneOffActions:{type:'array',maxItems:4,items:{type:'object',additionalProperties:false,required:['type','arguments'],properties:{type:{enum:Object.keys(RESERVED_ACTIONS)},arguments:{type:'object'}}}}
}};

export const strategyContractSchema={
 ...legacyStrategyContractSchema,
 required:[...legacyStrategyContractSchema.required,'goals'],
 properties:{
  ...legacyStrategyContractSchema.properties,
  goals:{type:'array',minItems:1,maxItems:3,items:{type:'object',additionalProperties:false,required:['metric','target','byDate'],properties:{
   metric:{enum:GOAL_METRICS},target:{type:'number',minimum:0,description:'期限内至少达到的数值；舰容占用用比例，例如 0.8'},
   byDate:{type:'string',pattern:'^[0-9]{4,7}\.[0-9]{2}\.[0-9]{2}$',description:'游戏日期，最多从当前日期起20年'}
  }}},
  expansionDirection:{type:'object',additionalProperties:false,required:['towardCountryId'],properties:{towardCountryId:countryIdSchema},description:'已知帝国方向，仅用于复查和解说'},
  warTarget:{type:'object',additionalProperties:false,required:['countryId'],properties:{countryId:countryIdSchema},description:'仅备战方针可设，仅用于复查和解说'}
 }
};
