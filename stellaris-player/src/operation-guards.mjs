// Stable intent identity is independent of property order. Queue placement does
// not make a failed station target legal, nor does choosing another constructor.
export const stableJson=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export function orderKey(order,eventScope) {
  const args={...order.arguments};
  return stableJson({command:order.command,arguments:args,eventScope});
}
export const stationTarget=arguments_=>`${arguments_.system_id}:${arguments_.station_type}`;
export function stationSignature(system,research={}) {
  // The engine remains the legality gate. A deposit is not a buildable station.
  // Only relevant world/technology facts invalidate a persistent engine refusal;
  // passing time, another request ID or queue position do not.
  return stableJson({owner:system.owner_id,starbase:system.starbase,
    planets:(system.planets||[]).map(p=>({id:p.id,owner_id:p.owner_id,surveyed:p.surveyed,deposits:Array.isArray(p.deposits)?p.deposits.map(d=>({key:d.key})).sort((a,b)=>String(a.key).localeCompare(String(b.key))):undefined})).sort((a,b)=>a.id-b.id),
    stations:(system.fleets||[]).filter(f=>/mining_station|research_station/.test(f.ship_class||'')).map(f=>({id:f.id,ship_class:f.ship_class,owner_id:f.owner_id})).sort((a,b)=>a.id-b.id),
    research:Object.fromEntries(Object.entries(research).map(([k,v])=>[k,{current:v.current?.key,candidates:v.candidates?.map(x=>x.key).sort()}]))});
}
export const persistentStationRefusal=error=>/不能在这个恒星系中任何一个行星周围建设这种空间站|No legal resource station order/i.test(String(error));

export function mergeProblem(ids,tactics) {
  const selected=ids.map(id=>tactics.fleets?.find(f=>f.fleet_id===id));
  if(selected.some(f=>!f))return '合并目标不在当前己方舰队列表，请重新 inspect military';
  if(selected.some(f=>f.available_to_merge===false))return '当前舰队状态不允许合并，请重新 inspect military，不重复提交合并';
  if(selected.some(f=>!Number.isFinite(f.actual_naval_size)||!Number.isFinite(f.command_limit)||f.command_limit<=0))return '合并舰队的真实占用或指挥上限未知，先重新 inspect military；不能猜测合并容量';
  const total=selected.reduce((n,f)=>n+f.actual_naval_size,0),limit=selected[0].command_limit;
  if(total>limit+1e-6)return `合并后实际占用${total}点，会超过接收舰队${limit}点指挥上限，保留分队或重新规划编制`;
  return null;
}

// Native shipyard queue entries expose type=ship and key=decimal design ID.
// Resolve costs only from current engine naval_size data, never a hull-size table.
export function queuedNavalBudget(yard,fleets) {
  if(!Array.isArray(yard.queue))return {known:false,points:0,reason:'船坞队列未返回'};
  const validCost=d=>Number.isSafeInteger(d.design_id)&&d.design_id>=0&&d.design_id<0xffffffff&&Number.isFinite(d.naval_size)&&d.naval_size>=0;
  const points=new Map((fleets.fleets||[]).flatMap(f=>f.designs||[]).filter(validCost).map(d=>[d.design_id,d.naval_size]));
  // The new native bridge exposes the design's own current hull cost, including
  // designs not yet present in any fleet. Prefer this to older fleet templates.
  const designs=[...(yard.refused_designs||[]),...(yard.refused||[]),...(yard.buildable||[]),...(yard.designs||[])];
  for(const d of designs)if(validCost(d))points.set(d.design_id,d.naval_size);
  const civilian=new Set(designs.filter(d=>['science','constructor','colony'].includes(d.ship_size)||d.colony_ship===true).map(d=>d.design_id));
  let total=0;
  for(const entry of yard.queue) {
    if(entry.type==='colony_ship')continue;
    if(entry.type!=='ship')return {known:false,points:total,reason:'船坞队列条目类型未知'};
    const design=Number.isInteger(entry.design_id)?entry.design_id:/^\d+$/.test(entry.key||'')?Number(entry.key):NaN;
    if(civilian.has(design))continue;
    const value=points.get(design);
    if(!Number.isFinite(value)||value<0)return {known:false,points:total,reason:'在建舰船设计的真实舰容未知'};
    total+=value;
  }
  return {known:true,points:total};
}
