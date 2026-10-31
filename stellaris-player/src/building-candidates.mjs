export function buildingCandidateProblem(list,{slot_index,building_key,district_type}) {
  if(list?.success!==true)return list?.error||'当前建筑候选不可读取，先 inspect buildings';
  const zone=list.zones?.find(x=>x.zone_id===slot_index);
  if(!zone)return 'slot_index 必须是此星球 inspect buildings 返回的完整 zone_id，不是列表顺位或空槽序号';
  if(zone.district!==district_type)return 'district_type 与当前特区不匹配，请使用返回的 district';
  if(Number.isFinite(zone.max_buildings)&&zone.max_buildings>=0&&Number.isFinite(zone.buildings)&&zone.buildings>=zone.max_buildings)return '当前特区建筑数量已满，先检查队列、其他合法特区和人口，不要换编号反复尝试';
  if(!zone.buildable?.some(x=>x.key===building_key))return '该特区当前没有这个可建候选，请检查前置、专精与在建队列，不换槽位猜测';
  return null;
}
