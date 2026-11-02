const keyPattern=/^[a-zA-Z0-9_]{1,100}$/;
const fullId=value=>Number.isSafeInteger(value)&&value>=0&&value<0xffffffff;
export function buildingZoneIdentityError(message,snapshot,planetId,reasonCode='zone_id_not_found'){
 const error=Object.assign(Error(message),{rejected:true,nativeWriteAttempted:false});
 if(snapshot?.success===true&&snapshot.planet_id===planetId&&Array.isArray(snapshot.zones)&&snapshot.zones.length<=256&&snapshot.zones.every(row=>fullId(row?.zone_id))){
  const string=value=>typeof value==='string'?value.slice(0,120):null;
  const number=value=>Number.isFinite(value)?value:null;
  error.candidateFeedback={planet_id:planetId,reasonCode,actualZones:snapshot.zones.map(row=>({zone_id:row.zone_id,district:string(row.district),zone_name:string(row.zone_name),buildings:number(row.buildings),max_buildings:number(row.max_buildings)})),
   source:'get_buildable_buildings',readOnly:true,note:'这是本次回读的真实特区身份，不是建筑可建候选或施工授权；使用完整zone_id重新决策，不按列表顺位改号。'};
 }
 return error;
}
export function nativeToolErrorText(error){
 const message=typeof error?.message==='string'?error.message:String(error);
 return error?.candidateFeedback?JSON.stringify({error:message,candidateFeedback:error.candidateFeedback,...(typeof error.nativeWriteAttempted==='boolean'?{nativeWriteAttempted:error.nativeWriteAttempted}:{})}):message;
}
// These are observations, not a reusable permission to write. Every later
// submission still checks the engine's then-current candidate pool.
export function candidateFeedback(command,available,{slot,observedAt}={}){
 const field=command==='select_research'?'tech_key':command==='adopt_tradition'?'tradition_key':'perk_key';
 const source=command==='select_research'?'get_research_state':command==='adopt_tradition'?'get_tradition_candidates':'get_ascension_candidates';
 const pool=available?.candidates;
 const known=Array.isArray(pool)&&pool.length<=256&&pool.every(x=>typeof x?.key==='string'&&keyPattern.test(x.key))&&new Set(pool.map(x=>x.key)).size===pool.length;
 return {command,source,observedAt,known,complete:known&&pool.length<=32,
  candidates:known?pool.slice(0,32).map(x=>({key:x.key,...(typeof x.name==='string'?{name:x.name.slice(0,80)}:{}),arguments:command==='select_research'?{slot,tech_key:x.key}:{[field]:x.key}})):[],
  note:known?'这是刚回读的候选；使用返回state的最新snapshotId和新requestId重新决策，不重复被拒参数。实际提交仍会重新检查；空候选不代表已有动作已完成。':'候选覆盖未知，不能猜key；先查询对应候选。'};
}
export function researchChoices(state,{observedAt}={}){
 const choices=[];
 for(const slot of ['physics','society','engineering']){
  const area=state.research?.[slot];
  if(area&&(area.current===null||area.current?.is_researching===false))choices.push({slot,...candidateFeedback('select_research',area,{slot,observedAt})});
 }
 return choices;
}
