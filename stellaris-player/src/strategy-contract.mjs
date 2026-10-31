export const STRATEGY_DIMENSIONS={economyFocus:['balanced','consumer_stability','alloys_military','research'],expansionStance:['aggressive','consolidate'],militaryStance:['peaceful','prepare_war']};
export const RESERVED_ACTIONS={declare_war:'declare_war',offer_peace:'offer_peace',diplo_propose:'diplomacy',diplo_respond:'respond_diplomacy'};
export const reservedOrder=command=>Object.values(RESERVED_ACTIONS).includes(command);
export const steeringRPC=(method,params)=>method==='toggle_edict'&&/^cfsteer_(economy|expansion|military)_/.test(params?.edict_key??'')&&typeof params.enabled==='boolean';
export const reservedRPC=method=>['declare_war','offer_peace','diplomacy_action','respond_diplomacy'].includes(method);
export function validateStrategyContract(raw,validateOrder){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>![...Object.keys(STRATEGY_DIMENSIONS),'oneOffActions','reason'].includes(k)))throw Error('StrategyContract字段无效');
 for(const [key,values] of Object.entries(STRATEGY_DIMENSIONS))if(!values.includes(raw[key]))throw Error('战略方针无效：'+key);
 if(typeof raw.reason!=='string'||!raw.reason.trim()||raw.reason.length>300)throw Error('战略需要1..300字公开理由');
 if(!Array.isArray(raw.oneOffActions)||raw.oneOffActions.length>4)throw Error('战略只接受最多4项保留决定');
 const oneOffActions=raw.oneOffActions.map(a=>{
  if(!a||!Object.hasOwn(RESERVED_ACTIONS,a.type)||Object.keys(a).some(k=>!['type','arguments'].includes(k)))throw Error('战略只接受宣战、议和、外交提议和回应');
  if(!a.arguments||typeof a.arguments!=='object'||Array.isArray(a.arguments))throw Error('保留决定缺少参数');
  const order=validateOrder?.({command:RESERVED_ACTIONS[a.type],arguments:a.arguments});
  return {type:a.type,arguments:structuredClone(order?.arguments??a.arguments)};
 });
 return {...Object.fromEntries(Object.keys(STRATEGY_DIMENSIONS).map(k=>[k,raw[k]])),oneOffActions,reason:raw.reason.trim()};
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
 oneOffActions:{type:'array',maxItems:4,items:{type:'object',additionalProperties:false,required:['type','arguments'],properties:{type:{enum:Object.keys(RESERVED_ACTIONS)},arguments:{type:'object'}}}}
}};
