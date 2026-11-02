// Legacy strategy names remain for rollback; v1.5 defaults to full_with_reserved.
export const COUNTRY_AI_ECONOMY_CANDIDATE_VERSION='cyberfish-0.6.17-country-ai-economy-wip';
export const COUNTRY_AI_ECONOMY_FEATURES=['country_ai_economic_administration_candidate',
 'country_ai_administration_effect_readback','country_ai_protected_economic_targets','country_ai_ship_production_candidate','country_ai_ship_queue_effect_readback'];
export const COUNTRY_AI_POLICIES={full_with_reserved:['native_country_operations'],research:['research'],planet_construction:['planet_construction'],
 research_and_planet_construction:['research','planet_construction'],
 economy:['research','planet_construction','workforce','colony_designation'],
 economy_and_ship_production:['research','planet_construction','workforce','colony_designation','ship_production']};
export const COUNTRY_AI_PROTECTION_REFERENCES={
 jobs:'CPopJob完整岗位id，来自当前岗位明细；不是岗位名称或planet_id。',
 colonies:'CColony完整colony_id，来自当前殖民地摘要；不是planet_id。',
 shipyards:'CStarbase完整starbase_id，来自inspect ships.starbase_id或get_shipyards.shipyards[].starbase_id；不是system_id、fleet_id或queue_id。保护该船坞会拦截全部原生造船，包含科研船和工程船，不能用于只禁军舰。'
 ,fleets:'CFleet完整fleet_id，仅用于本人持续任务的已确认己方舰队；保护移动、取消、合并和解散等原生覆盖，不关闭其他日常经营。'
};
export function normalizeCountryAIProtection(value={}){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['jobs','colonies','shipyards','fleets'].includes(k)))
  throw Error('国家 AI 保护目标只接受 jobs、colonies、shipyards 和 fleets');
 const result=Object.fromEntries(['jobs','colonies','shipyards','fleets'].map(key=>{
  const refs=Object.hasOwn(value,key)?value[key]:[];
  if(!Array.isArray(refs)||refs.length>256||refs.some(r=>!Number.isSafeInteger(r)||r<0||r>=0xffffffff))
   throw Error('国家 AI 保护目标需要最多256个完整引用，0有效');
  return [key,[...new Set(refs)].sort((a,b)=>a-b)];
 }));
 if(!result.fleets.length)delete result.fleets;
 return result;
}
export function normalizeNativeOwnerPolicy(value={}){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['peaceful_exploration','use_existing_science'].includes(k))||Object.values(value).some(v=>typeof v!=='boolean'))throw Error('原生经营约束仅接受已授权的和平探索及复用科研船布尔方针');
 return {peaceful_exploration:value.peaceful_exploration===true,use_existing_science:value.use_existing_science===true};
}
export function nativeOwnerPolicy(state={},contract){
 const p=state.userEconomicPolicy;
 const desired=normalizeNativeOwnerPolicy(contract?.nativePolicy);
 return normalizeNativeOwnerPolicy({peaceful_exploration:p?.militaryPolicy==='exploration_until_threat'||desired.peaceful_exploration,
  use_existing_science:p?.civilianFleetPolicy==='use_existing_explorers'||desired.use_existing_science});
}
const fullRef=value=>Number.isSafeInteger(value)&&value>=0&&value<0xffffffff;
export function assertProtectedShipyardRefs(protection,yards,countryId){
 const refs=normalizeCountryAIProtection(protection).shipyards;
 if(!refs.length)return;
 if(!fullRef(countryId)||yards?.success!==true||yards.coverage_complete!==true||yards.coverage_scope!=='owned_system_starbase_shipyards'||!Array.isArray(yards.shipyards))
  throw Error('保护船坞前需读取完整的当前己方星基船坞清单，不能凭星系号猜starbase_id');
 const rows=yards.shipyards;
 if(rows.some(row=>!fullRef(row?.starbase_id)||!fullRef(row.system_id)||!fullRef(row.queue_id)||row.owner_id!==countryId||row.has_shipyard!==true||row.queue_complete!==true)||new Set(rows.map(row=>row.starbase_id)).size!==rows.length)
  throw Error('船坞完整星基引用、队列或本国归属未确认，未设置保护');
 for(const ref of refs){
  if(rows.some(row=>row.starbase_id===ref))continue;
  const systems=rows.filter(row=>row.system_id===ref),queues=rows.filter(row=>row.queue_id===ref);
  const correction=systems.length?'；system_id='+ref+'对应starbase_id='+systems.map(row=>row.starbase_id).join(','):queues.length?'；queue_id='+ref+'对应starbase_id='+queues.map(row=>row.starbase_id).join(','):'';
  throw Error('protectedTargets.shipyards需要当前己方CStarbase完整starbase_id，引用'+ref+'未匹配'+correction+'；不自动替换其他实体ID');
 }
}
