// This candidate is NOT a loader admission or a change of the DSH default.
export const COUNTRY_AI_ECONOMY_CANDIDATE_VERSION='cyberfish-0.6.17-country-ai-economy-wip';
export const COUNTRY_AI_ECONOMY_FEATURES=['country_ai_economic_administration_candidate',
 'country_ai_administration_effect_readback','country_ai_protected_economic_targets','country_ai_ship_production_candidate','country_ai_ship_queue_effect_readback'];
export const COUNTRY_AI_POLICIES={research:['research'],planet_construction:['planet_construction'],
 research_and_planet_construction:['research','planet_construction'],
 economy:['research','planet_construction','workforce','colony_designation'],
 economy_and_ship_production:['research','planet_construction','workforce','colony_designation','ship_production']};
export function normalizeCountryAIProtection(value={}){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['jobs','colonies','shipyards'].includes(k)))
  throw Error('国家 AI 保护目标只接受 jobs、colonies 和 shipyards');
 return Object.fromEntries(['jobs','colonies','shipyards'].map(key=>{
  const refs=Object.hasOwn(value,key)?value[key]:[];
  if(!Array.isArray(refs)||refs.length>256||refs.some(r=>!Number.isSafeInteger(r)||r<0||r>=0xffffffff))
   throw Error('国家 AI 保护目标需要最多256个完整引用，0有效');
  return [key,[...new Set(refs)].sort((a,b)=>a-b)];
 }));
}
