// Survey IsValid can accept a jump-drive destination for which ordinary pathfinding
// returns no route. Native automation must not be admitted on that check alone.
export async function reachableSurveyCandidate(rpc,fleetId,{limit=8,referenceSystemId}={}) {
 if(!Number.isInteger(limit)||limit<1||limit>8)throw Error('调查路径检查上限无效');
 if(!Number.isSafeInteger(referenceSystemId)||referenceSystemId<0||referenceSystemId>=0xffffffff)throw Error('缺少已知参照星系，不能核对科研船位置');
 const origin=await rpc('find_path',{fleet_id:fleetId,to_system_id:referenceSystemId});
 if(origin?.fleet_id!==fleetId||!Number.isSafeInteger(origin.from_system_id)||origin.from_system_id<0||origin.from_system_id>=0xffffffff)throw Error('科研船真实出发星系未知，暂不委派');
 const targets=await rpc('find_systems',{purpose:'unsurveyed',fleet_id:fleetId,from_system_id:origin.from_system_id,limit});
 if(!Array.isArray(targets?.systems))throw Error('无法确认当前合法调查目标');
 if(!targets.systems.length)throw Error('当前没有合法调查目标，保留手动控制');
 const checked=[];
 for(const target of targets.systems.slice(0,limit)){
  if(!Number.isSafeInteger(target?.id)||target.id<0||target.id>=0xffffffff)throw Error('调查候选ID未知');
  // A normal survey command can be legal for an unexplored star without the
  // survey-only automation choosing it. Do not authorize explore implicitly.
  if(!Number.isInteger(target.intel)||target.intel<0||target.intel>4)throw Error('调查候选探索情报未知，暂不委派');
  if(target.intel===0){checked.push({systemId:target.id,requiresExploration:true});continue;}
  const path=await rpc('find_path',{fleet_id:fleetId,to_system_id:target.id});
  checked.push({systemId:target.id,reachable:path?.reachable===true});
  if(path?.fleet_id===fleetId&&path?.to_system_id===target.id&&path.reachable===true&&Array.isArray(path.systems)&&path.systems.length)
   return {target,path,checked};
 }
 if(checked.length&&checked.every(x=>x.requiresExploration))throw Error('本轮候选均未探索，不能以可手动调查推断原生会主动选取；先选择方向正常航行，抵达且订单清空后重新核对委派，不自动开启探索');
 throw Error('本轮候选未确认可达调查路线，保留手动控制；不盲目重复委派');
}
