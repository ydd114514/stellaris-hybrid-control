const methods={buildings:'get_buildable_buildings',districts:'get_buildable_districts',jobs:'get_planet_jobs',upgrades:'get_building_upgrade_candidates',zones:'get_available_district_zones'};
const id=n=>Number.isSafeInteger(n)&&n>=0&&n<0xffffffff;
export function constructionInspectionScope({topic,sections,district_type}={}){
 if(topic!=='construction'){if(sections!==undefined)throw Error('sections仅用于construction查询');return null;}
 const selected=sections??['buildings','districts'];
 if(!Array.isArray(selected)||selected.length<1||selected.length>3||new Set(selected).size!==selected.length||selected.some(x=>!Object.hasOwn(methods,x)))throw Error('construction需要1..3类不重复的真实查询范围');
 if(district_type!==undefined&&(!selected.includes('zones')||typeof district_type!=='string'||!/^district_[a-z_]{1,60}$/.test(district_type)))throw Error('district_type仅供zones范围使用当前区划key');
 return {sections:[...selected],districtType:district_type??'district_city'};
}
// No caching, inferred candidates or writes. Each section retains its native
// legality and cost fields; failures are explicit, never substituted with [].
export async function inspectConstruction({planetId,scope,rpc}){
 if(!id(planetId)||!scope)throw Error('建设合并查询需要完整星球ID和范围');
 const raw=await rpc('get_planet_details',{planet_id:planetId});
 if(raw?.planet_id!==planetId||!id(raw.colony_id))throw Error('建设查询的星球/殖民地身份未知');
 const keys=['planet_id','colony_id','name','designation','designation_key','kpi','workforce_summary','construction_queue','status_alerts','monthly_production'];
 const planet=Object.fromEntries(keys.filter(k=>Object.hasOwn(raw,k)).map(k=>[k,raw[k]])),sections={};
 for(const key of scope.sections){
  try{
   const data=await rpc(methods[key],{planet_id:planetId,...key==='zones'?{district_type:scope.districtType}:{}});
   const fields={buildings:['zones'],districts:['current','buildable'],jobs:['strata'],upgrades:['candidates'],zones:['districts']}[key];
   const known=data?.success===true&&data.planet_id===planetId&&data.colony_id===raw.colony_id&&fields.every(k=>Array.isArray(data[k]))&&(key!=='upgrades'||id(data.queue_id));
   if(key==='zones'&&known)for(const district of data.districts||[])for(const slot of district.slots||[])if(slot.zone!==null)delete slot.buildable_zones;
   sections[key]=known?{known:true,data}:{known:false,reason:'候选失败或星球/殖民地身份不一致'};
  }catch(error){sections[key]={known:false,reason:error.message};}
 }
 return {scope:'single_colony_construction',readOnly:true,atomicObservation:false,planet,sections,allRequestedKnown:Object.values(sections).every(x=>x.known),executionRequiresFreshValidation:true,note:'仅查询所选范围，不是建设或委派授权；空数组不代表空槽，费用与合法性仍须执行前回读。'};
}
