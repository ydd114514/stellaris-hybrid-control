import {checkEconomicExploration} from './user-economic-intervention.mjs';

const id=n=>Number.isSafeInteger(n)&&n>=0&&n<0xffffffff;
const unique=list=>[...new Set((Array.isArray(list)?list:[]).filter(id))].slice(-2048);
const active=new Set(['moving','planning','needs_protection','blocked','suspended']);
const enabled=state=>state?.userEconomicPolicy?.source==='user-current-chat'&&state.userEconomicPolicy.militaryPolicy==='exploration_until_threat';
const clip=x=>typeof x==='string'?x.replace(/[\r\n]/g,' ').slice(0,180):'';

/** Persistent goal data only: no timer, native write, fleet count or recruitment. */
export function bindFleetExploration(value,identity,date){
 if(typeof identity!=='string'||!identity||typeof date!=='string')throw Error('持续探索需要本轮完整世界绑定与日期');
 if(value?.version!==1||value.identity!==identity||typeof value.date!=='string'||date<value.date)return {version:1,identity,date,fleets:[]};
 const seen=new Set();
 return {version:1,identity,date,fleets:(Array.isArray(value.fleets)?value.fleets:[]).slice(0,64).flatMap(row=>{
  if(!id(row?.fleetId)||seen.has(row.fleetId)||!active.has(row.phase))return [];seen.add(row.fleetId);
  return [{fleetId:row.fleetId,phase:row.phase,targetSystemId:id(row.targetSystemId)?row.targetSystemId:null,
   trackingId:clip(row.trackingId),visited:unique(row.visited),graph:(Array.isArray(row.graph)?row.graph:[]).filter(n=>id(n?.systemId)&&Array.isArray(n.neighbours)).slice(-512).map(n=>({systemId:n.systemId,neighbours:unique(n.neighbours)})),
   reason:clip(row.reason),lastCompletedTrackingId:clip(row.lastCompletedTrackingId),retryable:row.retryable===true}];
 })};
}

/** Call only after an owner-authorized move has an accepted normal receipt. */
export function recordExplorationLeg(data,{state,fleetId,fromSystemId,targetSystemId,trackingId,accepted}){
 if(!enabled(state)||accepted!==true||!id(fleetId)||!id(targetSystemId)||typeof trackingId!=='string'||!trackingId)return false;
 let row=data.fleets.find(f=>f.fleetId===fleetId);
 if(!row){if(data.fleets.length>=64)return false;row={fleetId,visited:[],graph:[]};data.fleets.push(row);}
 row.visited=unique([...row.visited,...id(fromSystemId)?[fromSystemId]:[]]);
 Object.assign(row,{phase:'moving',targetSystemId,trackingId,retryable:false,reason:'本人持续探索目标正在执行当前航段；抵达后仍需选择下一处前沿'});
 return true;
}

/** Only an actual OrderTracker destination proof finishes a leg, never idle text. */
export function syncExplorationLegs(data,{state,orders}){
 for(const row of data.fleets){
  if(!enabled(state)){row.phase='suspended';row.reason='本人探索策略已撤回，停止新航段；不取消已受理的移动';continue;}
  const order=(orders??[]).find(o=>o.id===row.trackingId&&o.command==='move_fleet'&&o.arguments?.fleet_id===row.fleetId&&o.arguments.system_id===row.targetSystemId);
  if(order?.status==='completed'&&row.lastCompletedTrackingId!==row.trackingId){
   row.visited=unique([...row.visited,row.targetSystemId]);row.lastCompletedTrackingId=row.trackingId;row.phase='planning';
   row.reason='当前航段真实抵达；持续探索目标仍在，不能当作全部完成后自动召回';
  }else if(order&&['failed','expired_unknown'].includes(order.status)&&row.lastCompletedTrackingId!==row.trackingId){row.phase='blocked';row.retryable=false;row.reason='当前航段失败或结果未知，先读回核对，不自动重放或换目标掩盖';}
 }
}

const emergency=state=>state.wars?.length>0||['energy','minerals','alloys','food','consumer_goods'].some(key=>{
 const r=state.resources?.[key];return r?.net_known!==false&&r?.stockpile_known!==false&&Number.isFinite(r?.stockpile)&&Number.isFinite(r.net)&&r.net<0&&Math.max(0,r.stockpile)/-r.net<=6;
});
function frontierStep(row,current,claimed){
 const visited=new Set(row.visited),graph=new Map(row.graph.map(n=>[n.systemId,n.neighbours])),queue=[[current]],seen=new Set([current]);
 while(queue.length){
  const path=queue.shift(),node=path.at(-1),neighbours=graph.get(node);
  if(!neighbours){if(path.length>1)return {target:path[1],purpose:'核对已访问连接点尚未记录的分支'};continue;}
  const frontier=neighbours.filter(n=>!visited.has(n)&&!claimed.has(n));
  if(frontier.length)return path.length===1?{targets:frontier,purpose:'探当前真实邻接的未访问前沿'}:{target:path[1],purpose:'沿已知连接点前往仍有未访问分支的前沿'};
  for(const next of neighbours)if(visited.has(next)&&!seen.has(next)&&!claimed.has(next)){seen.add(next);queue.push([...path,next]);}
 }
 return null;
}

/** A local selector and capability boundary. Caller owns the existing serial
 * command path and must independently revalidate the protected native lease. */
export async function planExplorationLeg(data,{state,fleetId,rpc,protectionConfirmed=false,minimumIntel=0}){
 const row=data.fleets.find(f=>f.fleetId===fleetId);
 if(!row||!enabled(state))return {status:'inactive',reason:'没有本人的有效持续探索目标'};
 if(emergency(state)){row.phase='suspended';row.reason='战争或真实保供危机，暂停探索并让原生AI处理防务/经济';return {status:'yield',reason:row.reason};}
 if(row.phase==='moving')return {status:'waiting',reason:'原航段尚未由实际位置确认完成，不派第二单'};
 if(row.phase==='blocked'&&row.retryable!==true)return {status:'attention',reason:row.reason};
 if(!protectionConfirmed){row.phase='needs_protection';row.reason='持续探索目标保留；原生逐舰保护尚未确认，恢复普通经济，不长时间关原生AI，也不假称能并行控制';return {status:'needs_native_fleet_protection',reason:row.reason,allowNativeEconomy:true};}
 const cache=new Map(),read=async(method,params={})=>{
  if(!/^get_|^find_/.test(method))throw Error('探索选择器仅允许只读接口');
  const key=JSON.stringify([method,params]);if(!cache.has(key))cache.set(key,Promise.resolve(rpc(method,params)));return cache.get(key);
 };
 const tactics=await read('get_fleet_tactics',{details:false}),fleet=tactics?.fleets?.find(f=>f.fleet_id===fleetId);
 if(!fleet||!id(fleet.system_id)||fleet.available_to_merge!==true||!/无指令|无任务|idle|no orders/i.test(fleet.status??''))return {status:'waiting',reason:'己方军舰并非空闲，保留已有真实任务，不覆盖'};
 const origin=await read('get_system',{system_id:fleet.system_id});
 if(origin.id!==fleet.system_id||!Array.isArray(origin.hyperlanes)||!origin.fleets?.some(f=>f.id===fleetId&&f.own===true&&f.ship_class==='shipclass_military'))return {status:'attention',reason:'当前位置、归属或真实邻接航道未确认'};
 const intelFloor=Number.isInteger(minimumIntel)&&minimumIntel>0?minimumIntel:0;
 if(intelFloor&&(!Number.isInteger(origin.intel)||origin.intel<intelFloor)){
  row.phase='blocked';row.retryable=true;row.reason=`当前原生移动仅支持起点与目标情报至少${intelFloor}级；当前位置未满足，未把未知星系当成已探索`;
  return {status:'attention',reason:row.reason,capabilityLimited:true,minimumIntel:intelFloor,retryAfterMs:120000,allowNativeEconomy:true};
 }
 row.visited=unique([...row.visited,origin.id]);
 row.graph=row.graph.filter(n=>n.systemId!==origin.id);row.graph.push({systemId:origin.id,neighbours:unique(origin.hyperlanes.map(l=>l.to))});row.graph=row.graph.slice(-512);
 const claimed=new Set(data.fleets.filter(f=>f.fleetId!==fleetId&&f.phase==='moving').map(f=>f.targetSystemId));
 const frontier=frontierStep(row,origin.id,claimed),targets=frontier?.targets??(id(frontier?.target)?[frontier.target]:[]),reasons=[];
 let intelBlocked=0,attempted=0;
 const excluded=new Set(claimed);
 for(let index=0;index<8;index++){
  // A limited bridge may safely traverse a previously visited junction to a
  // known frontier, while low-intel neighbours remain unvisited in the graph.
  const next=intelFloor?frontierStep(row,origin.id,excluded):frontier;
  const options=next?.targets??(id(next?.target)?[next.target]:[]),target=intelFloor?options[0]:targets[index];
  if(!id(target))break;attempted++;excluded.add(target);
  if(intelFloor){
   const system=await read('get_system',{system_id:target});
   if(system?.id!==target||!Number.isInteger(system.intel)||system.intel<intelFloor){intelBlocked++;reasons.push(`目标${target}的情报未达当前原生移动能力下限${intelFloor}`);continue;}
  }
  const order={command:'move_fleet',arguments:{fleet_id:fleetId,system_id:target}};
  try{const proof=await checkEconomicExploration(order,state,read);row.phase='planning';row.reason=next.purpose;return {status:'ready',order,proof,purpose:next.purpose};}
  catch(error){reasons.push(clip(error.message));}
 }
 row.phase='blocked';row.retryable=true;row.reason=intelBlocked?`当前原生移动仅支持情报至少${intelFloor}级的已知安全单跳；未知前沿保留且未标记已探索，等待更强能力或真实情报变化`:attempted?'当前邻接前沿均受真实路线或风险条件限制，目标保留，条件变化再评估':'当前已记录的可达连接点没有未访问前沿，未宣称整张地图探索完毕';
 return {status:'attention',reason:row.reason,details:[...new Set(reasons)].slice(0,3),...(intelBlocked?{capabilityLimited:true,minimumIntel:intelFloor,retryAfterMs:120000}:{}),allowNativeEconomy:true};
}
