// Read-only presentation targets. No cache, camera movement, work orders or game pauses.
const id=value=>Number.isSafeInteger(value)&&value>=0&&value<0xffffffff;
const list=value=>Array.isArray(value)?value:[];
const name=(value,fallback)=>typeof value==='string'&&value.trim()?value.replace(/[\r\n]+/g,' ').trim().slice(0,160):fallback;
const queue=value=>Array.isArray(value)?value.slice(0,20).map(row=>({
 ...(typeof row?.item_name==='string'?{item_name:row.item_name}:typeof row?.name==='string'?{item_name:row.name}:{}),
 ...(typeof row?.key==='string'?{key:row.key}:{}),
 ...(typeof row?.type==='string'?{type:row.type}:{}),
 ...(Number.isFinite(row?.remaining_days)?{remaining_days:row.remaining_days}:{})
})):null;
const player=(status,state)=>state?.player??status?.player??{};

export function directorPlanetTargets(status={},state={}) {
 const fresh=status?.outliner?.sectors_summary?.sectors;
 // An explicitly empty fresh snapshot must not resurrect colonies from stale state.
 const sectors=Array.isArray(fresh)?fresh:list(state?.colonies);
 const result=new Map();
 for(const sector of sectors)for(const row of list(sector?.colonies_summary)){
  if(!id(row?.planet_id)||row.is_colonizing===true||result.has(row.planet_id))continue;
  const construction=typeof row.has_construction==='boolean'?row.has_construction:
   Array.isArray(row.construction_queue)?row.construction_queue.length>0:
    row.current_construction&&typeof row.current_construction==='object'?true:
     row.current_construction===null?false:null;
  result.set(row.planet_id,{
   planet_id:row.planet_id,name:name(row.name,'殖民地 '+row.planet_id),has_construction:construction,
   queue:queue(row.construction_queue),is_capital:row.is_capital===true,
   ...(id(row.colony_id)?{colony_id:row.colony_id}:{}),
   ...(Number.isSafeInteger(row.status_alerts_count)&&row.status_alerts_count>=0?{status_alerts_count:row.status_alerts_count}:{})
  });
 }
 return [...result.values()];
}

function starbaseRow(row,playerId) {
 if(!id(row?.system_id)||row.owner_id!==undefined&&id(playerId)&&row.owner_id!==playerId)return;
 return {
  system_id:row.system_id,name:name(row.name,'星系 '+row.system_id),
  ...(id(row.starbase_id)?{starbase_id:row.starbase_id}:{}),
  queue:queue(row.queue),
  has_construction:Array.isArray(row.queue)?row.queue.length>0:null
 };
}

/**
 * Current bridge: all owned-system starbases, including bases without shipyards.
 * Older bridge fallback: all shipyards plus B-marked owned systems within 12 jumps.
 * That older fallback is deliberately not described as full-empire coverage.
 * Cache the result in NativeDirector, bound to the current native/world generation.
 */
export async function loadDirectorStarbaseTargets({status={},state={},rpc}={}) {
 let who=player(status,state);
 const snapshot=[status,state].find(value=>value?.success===true&&value.coverage_scope==='owned_system_starbases'&&Array.isArray(value.starbases));
 const normalize=raw=>[...new Map(list(raw).map(row=>starbaseRow(row,who.country_id)).filter(Boolean).map(row=>[row.starbase_id===undefined?'system:'+row.system_id:'starbase:'+row.starbase_id,row])).values()];
 if(snapshot)return normalize(snapshot.starbases);
 if(typeof rpc!=='function')return [];
 try{
  const current=await rpc('get_starbase_targets');
  if(current?.success===true&&Array.isArray(current.starbases))return normalize(current.starbases);
 }catch{/* Older bridges do not expose this read method. */}
 if(!id(who.country_id)){
  try{who=(await rpc('get_galaxy_overview'))?.player??{};}catch{}
 }
 const result=new Map();
 try{
  const map=await rpc('get_galaxy_map',{...(id(who.capital_system_id)?{center_system_id:who.capital_system_id}:{}),jumps:12});
  const columns=Object.fromEntries(list(map?.columns).map((key,index)=>[key,index]));
  if(id(who.country_id)&&['id','name','owner_id','flags'].every(key=>Number.isInteger(columns[key])))for(const row of list(map?.rows)){
   if(!Array.isArray(row)||!id(row[columns.id])||row[columns.owner_id]!==who.country_id||!String(row[columns.flags]??'').includes('B'))continue;
   result.set(row[columns.id],{system_id:row[columns.id],name:name(row[columns.name],'星系 '+row[columns.id]),queue:null,has_construction:null});
  }
 }catch{/* Keep a separate shipyard read useful when the bounded map is unavailable. */}
 try{
  const yards=await rpc('get_shipyards');
  if(yards?.success===true&&yards.coverage_scope==='owned_system_starbase_shipyards')for(const entry of list(yards.shipyards)){
   const row=starbaseRow(entry,who.country_id);if(!row)continue;
   const existing=result.get(row.system_id);
   result.set(row.system_id,{...existing,...row,name:existing?.name??row.name});
  }
 }catch{/* A missing shipyard endpoint must not hide map-visible non-shipyard bases. */}
 return [...result.values()];
}

/** Fair rotation: unseen/least-recent targets first; construction breaks ties only. */
export function rankDirectorTargets(items,{key,lastShown=new Map(),now=Date.now(),cooldown=0}={}) {
 const seen=row=>{const value=lastShown.get(key+':'+row[key]);return Number.isFinite(value)&&value<=now?value:-Infinity;};
 return list(items).filter(row=>id(row?.[key])&&now-seen(row)>=cooldown)
  .sort((a,b)=>seen(a)-seen(b)||Number(b.has_construction===true)-Number(a.has_construction===true));
}
