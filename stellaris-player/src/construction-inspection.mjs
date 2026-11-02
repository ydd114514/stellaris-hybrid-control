import {constructionCandidateCoverage} from './construction-coverage.mjs';
import {buildingZoneIdentityError} from './candidate-feedback.mjs';
const methods={buildings:'get_buildable_buildings',districts:'get_buildable_districts',jobs:'get_planet_jobs',upgrades:'get_building_upgrade_candidates',zones:'get_available_district_zones'};
const id=n=>Number.isSafeInteger(n)&&n>=0&&n<0xffffffff;
export const buildingInspectionProperties={building_key:{type:'string',pattern:'^building_[a-z0-9_]{1,100}$'},zone_id:{type:'integer',minimum:0,maximum:2147483647}};
export function buildingInspectionScope({topic,sections,building_key,zone_id}={}){
 if(building_key===undefined&&zone_id===undefined)return null;
 if(!['buildings','construction'].includes(topic))throw Error('building_key和zone_id仅用于buildings或construction的定向只读核验');
 if(typeof building_key!=='string'||!/^building_[a-z0-9_]{1,100}$/.test(building_key)||!Number.isSafeInteger(zone_id)||zone_id<0||zone_id>2147483647)
  throw Error('定向建筑核验需要合法building_key及当前完整zone_id，不能用槽位顺序猜测');
 if(topic==='construction'&&sections!==undefined&&(!Array.isArray(sections)||!sections.includes('buildings')))throw Error('定向建筑核验的construction sections必须包含buildings');
 return {buildingKey:building_key,zoneId:zone_id};
}
export function constructionInspectionScope({topic,sections,district_type,building_key,zone_id}={}){
 const buildingTarget=buildingInspectionScope({topic,sections,building_key,zone_id});
 if(topic!=='construction'){if(sections!==undefined)throw Error('sections仅用于construction查询');return null;}
 const selected=sections??['buildings','districts'];
 if(!Array.isArray(selected)||selected.length<1||selected.length>3||new Set(selected).size!==selected.length||selected.some(x=>!Object.hasOwn(methods,x)))throw Error('construction需要1..3类不重复的真实查询范围');
 if(district_type!==undefined&&(!selected.includes('zones')||typeof district_type!=='string'||!/^district_[a-z_]{1,60}$/.test(district_type)))throw Error('district_type仅供zones范围使用当前区划key');
 return {sections:[...selected],districtType:district_type??'district_city',...(buildingTarget?{buildingTarget}:{})};
}
/** Exact existing DLL path: genuine zone membership + engine validation only. */
export async function inspectBuildingQuote({planetId,buildingTarget,rpc,planet,zoneSnapshot}){
 if(!id(planetId)||!buildingTarget)throw Error('定向建筑核验需要当前己方星球与真实特区');
 const {buildingKey,zoneId}=buildingInspectionScope({topic:'buildings',building_key:buildingTarget.buildingKey,zone_id:buildingTarget.zoneId});
 const raw=planet??await rpc('get_planet_details',{planet_id:planetId});
 if(raw?.planet_id!==planetId||!id(raw.colony_id))throw Error('定向建筑核验的星球/殖民地身份未知');
 // Bulk enumeration may lack legal candidates while still providing the
 // actual colony/zone identities. Never infer zone identity from list order.
 const zones=zoneSnapshot??await rpc('get_buildable_buildings',{planet_id:planetId});
 if(zones?.success!==true||zones.planet_id!==planetId||zones.colony_id!==raw.colony_id||!Array.isArray(zones.zones))throw Error('当前建筑特区归属覆盖未知，不发送定向核验');
 const matches=zones.zones.filter(z=>z?.zone_id===zoneId);
 if(matches.length!==1)throw buildingZoneIdentityError('zone_id不属于当前己方星球的唯一真实建筑特区',zones,planetId,matches.length?'zone_id_not_unique':'zone_id_not_found');
 const checked=await rpc('get_buildable_buildings',{planet_id:planetId,building_key:buildingKey,zone_id:zoneId});
 const rows=checked?.zones;
 if(checked?.success!==true||checked.planet_id!==planetId||checked.building_key!==buildingKey||!Array.isArray(rows)||rows.length!==1||rows[0]?.zone_id!==zoneId||typeof rows[0].can_build!=='boolean'||
  typeof matches[0].zone==='string'&&typeof rows[0].zone==='string'&&matches[0].zone!==rows[0].zone)throw Error(checked?.error||'定向建筑核验结果或特区身份不完整');
 const row=rows[0],cost=row.cost&&typeof row.cost==='object'&&!Array.isArray(row.cost)&&Object.values(row.cost).every(n=>Number.isFinite(n)&&n>=0)?{...row.cost}:null;
 const buildDays=Number.isFinite(row.build_days)&&row.build_days>=0?row.build_days:null,costKnown=row.can_build===true&&cost!==null&&buildDays!==null;
 return {success:true,scope:'targeted_building_engine_quote',readOnly:true,quoteOnly:true,executionAuthorized:false,executionRequiresFreshValidation:true,
  coverageKnown:true,planet_id:planetId,colony_id:raw.colony_id,building_key:buildingKey,zone_id:zoneId,zone:row.zone??matches[0].zone,district:matches[0].district,
  can_build:row.can_build,reason:row.can_build?null:typeof row.reason==='string'&&row.reason?row.reason.slice(0,1200):'引擎拒绝，但未提供具体原因',
  quote:{costKnown,cost:costKnown?cost:null,build_days:costKnown?buildDays:null},
  note:'仅核验此建筑与此真实特区的当前引擎条件和报价，不是全建筑候选，也不授权施工；正常建设仍须执行时重新核验。'};
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
   if(key==='buildings'&&scope.buildingTarget){
    sections[key]={known:true,data:await inspectBuildingQuote({planetId,buildingTarget:scope.buildingTarget,rpc,planet:raw})};continue;
   }
   const data=await rpc(methods[key],{planet_id:planetId,...key==='zones'?{district_type:scope.districtType}:{}});
   const fields={buildings:['zones'],districts:['current','buildable'],jobs:['strata'],upgrades:['candidates'],zones:['districts']}[key];
   const known=data?.success===true&&data.planet_id===planetId&&data.colony_id===raw.colony_id&&fields.every(k=>Array.isArray(data[k]))&&(key!=='upgrades'||id(data.queue_id));
   const coverage=known?constructionCandidateCoverage(key,data,raw):null;
   if(key==='zones'&&known)for(const district of data.districts||[])for(const slot of district.slots||[])if(slot.zone!==null)delete slot.buildable_zones;
   sections[key]=!known?{known:false,reason:'候选失败或星球/殖民地身份不一致'}:coverage.known?{known:true,data}:{...coverage,coverageKnown:false};
  }catch(error){sections[key]={known:false,reason:error.message,...(error.candidateFeedback?{candidateFeedback:error.candidateFeedback}:{})};}
 }
 return {scope:'single_colony_construction',readOnly:true,atomicObservation:false,planet,sections,allRequestedKnown:Object.values(sections).every(x=>x.known),executionRequiresFreshValidation:true,note:'仅查询所选范围，不是建设或委派授权；空数组不代表空槽，费用与合法性仍须执行前回读。'};
}
