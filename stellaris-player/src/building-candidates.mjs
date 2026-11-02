import {inspectBuildingQuote} from './construction-inspection.mjs';
import {buildingZoneIdentityError} from './candidate-feedback.mjs';
const costKnown=cost=>cost&&typeof cost==='object'&&!Array.isArray(cost)&&Object.keys(cost).length>0&&Object.entries(cost).every(([key,n])=>/^[a-z_][a-z0-9_]{0,99}$/.test(key)&&Number.isFinite(n)&&n>=0&&n<=1e12);
const reject=message=>{throw Object.assign(Error(message),{rejected:true});};

/** Exact engine admission; a positive target quote never becomes a bulk candidate. */
export async function readBuildingAdmission(params,rpc,{choices,forceTarget=false}={}){
 const snapshot=choices??await rpc('get_buildable_buildings',{planet_id:params.planet_id});
 if(snapshot?.success!==true||snapshot.planet_id!==params.planet_id)reject(snapshot?.error||'建筑候选的当前星球身份未知');
 const zones=snapshot.zones?.filter(z=>z.zone_id===params.slot_index);
 if(zones?.length!==1)throw buildingZoneIdentityError('slot_index必须是此星球当前唯一完整 zone_id，不是列表顺位或空槽序号',snapshot,params.planet_id,zones?.length?'zone_id_not_unique':'zone_id_not_found');
 const zone=zones[0];
 if(zone.district!==params.district_type)reject('district_type与当前真实特区不匹配');
 if(Number.isFinite(zone.max_buildings)&&Number.isFinite(zone.buildings)&&zone.buildings>=zone.max_buildings)reject('当前特区建筑数量已满，不能追加新建筑');
 const matches=zone.buildable?.filter(c=>c.key===params.building_key)??[];
 if(matches.length>1)reject('同特区建筑候选不唯一，不能猜测费用');
 if(matches.length===1&&!forceTarget){
  if(!costKnown(matches[0].cost))reject('当前唯一建筑候选的实时费用未知');
  return {basis:'bulk_engine_candidate',cost:{...matches[0].cost}};
 }
 const quote=await inspectBuildingQuote({planetId:params.planet_id,buildingTarget:{buildingKey:params.building_key,zoneId:params.slot_index},rpc,zoneSnapshot:snapshot});
 if(quote.district!==params.district_type)reject('定向核验时建筑特区已改变');
 if(quote.can_build!==true)reject(quote.reason||'当前引擎不允许在此特区建造该建筑');
 if(quote.quote?.costKnown!==true||!costKnown(quote.quote.cost))reject('当前定向建筑费用尚未完整核验，不能支出');
 return {basis:'targeted_engine_quote',cost:{...quote.quote.cost},quote};
}

export function buildingCandidateProblem(list,{slot_index,building_key,district_type}) {
  if(list?.coverageKnown===false)return list.coverageReason||'建筑候选覆盖未知，不能由空列表认定无合法建筑';
  if(list?.success!==true)return list?.error||'当前建筑候选不可读取，先 inspect buildings';
  const zone=list.zones?.find(x=>x.zone_id===slot_index);
  if(!zone)return 'slot_index 必须是此星球 inspect buildings 返回的完整 zone_id，不是列表顺位或空槽序号';
  if(zone.district!==district_type)return 'district_type 与当前特区不匹配，请使用返回的 district';
  if(Number.isFinite(zone.max_buildings)&&zone.max_buildings>=0&&Number.isFinite(zone.buildings)&&zone.buildings>=zone.max_buildings)return '当前特区建筑数量已满，先检查队列、其他合法特区和人口，不要换编号反复尝试';
  if(!zone.buildable?.some(x=>x.key===building_key))return '该特区当前没有这个可建候选，请检查前置、专精与在建队列，不换槽位猜测';
  return null;
}
