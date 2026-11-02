const id=n=>Number.isSafeInteger(n)&&n>=0&&n<0xffffffff;
export const USER_ECONOMIC_COMMANDS=['build_building','move_fleet','set_fleet_stance'];
const base=['declare_war','offer_peace','diplomacy','respond_diplomacy','resolve_event','open_war_goals','set_defender_war_goal','close_war_goals'];
const fail=text=>{throw Object.assign(Error(text),{rejected:true});};
export function userEconomicOrderAllowed(order,state){
 const p=state?.userEconomicPolicy;
 if(p?.version!==1||p.source!=='user-current-chat')return false;
 if(order.command==='build_building')return p.priority==='unity_first'&&p.preferredUnityBuildings?.includes(order.arguments.building_key)===true;
 return p.militaryPolicy==='exploration_until_threat'&&(order.command==='move_fleet'&&order.arguments.queue!==true||order.command==='set_fleet_stance'&&order.arguments.stance==='evasive');
}
export function assertNativeEconomicOrders(orders,state){
 for(const order of orders)if(!base.includes(order.command)&&!userEconomicOrderAllowed(order,state))fail('原生模式仅允许本人明确授权的凝聚力节点、现有军舰安全探索及回避姿态；其他日常命令仍封口');
}
/** Explicit owner-authorized exploration: unknown neighbours are not enemies. */
export async function checkEconomicExploration(order,state,rpc){
 if(!userEconomicOrderAllowed(order,state))fail('当前本人要求未授权该经营干预');
 if(!['move_fleet','set_fleet_stance'].includes(order.command))return;
 const wars=await rpc('get_wars');
 if(!Array.isArray(wars?.wars)||wars.wars.length||wars.warGoalsWindow)fail('已有战争或战况未知，停止探索干预并交还防务');
 const tactics=await rpc('get_fleet_tactics',{details:false}),fleet=tactics?.fleets?.find(f=>f.fleet_id===order.arguments.fleet_id);
 if(!fleet||!id(fleet.system_id)||!(fleet.total_ships>0)||fleet.available_to_merge!==true||typeof fleet.status!=='string'||!/无指令|无任务|idle|no orders/i.test(fleet.status))fail('只调动当前真实己方、空闲且不在战斗/升级中的现有军舰');
 const origin=await rpc('get_system',{system_id:fleet.system_id}),own=origin.fleets?.find(f=>f.id===fleet.fleet_id&&f.own===true&&f.ship_class==='shipclass_military');
 if(origin.id!==fleet.system_id||!own)fail('军舰当前位置或本国归属未确认');
 if(order.command==='set_fleet_stance')return {fleetId:fleet.fleet_id,stance:'evasive'};
 const p=order.arguments,route=await rpc('find_path',{fleet_id:p.fleet_id,to_system_id:p.system_id});
 const systems=route?.systems?.map(s=>s.id);
 if(route?.reachable!==true||route.fleet_id!==p.fleet_id||route.from_system_id!==fleet.system_id||route.to_system_id!==p.system_id||!Array.isArray(systems)||systems.length<2||systems.length>8||systems[0]!==fleet.system_id||systems.at(-1)!==p.system_id||systems.some(n=>!id(n)))fail('当前完整可达路径未确认；仅选可核查的近邻安全探索目标');
 let unexploredNeighbour=false;
 for(const systemId of [...new Set(systems)]){
  const system=systemId===origin.id?origin:await rpc('get_system',{system_id:systemId});
  if(system.id!==systemId||!Number.isInteger(system.intel)||system.intel<0||!Object.hasOwn(system,'owner_id')||!Array.isArray(system.fleets))fail('路线当前结构或归属字段不可读取，未派探索');
  if(system.intel<3&&systemId!==origin.id){
   const direct=systems.length===2&&systemId===p.system_id&&Array.isArray(origin.hyperlanes)&&origin.hyperlanes.some(l=>l.to===systemId);
   if(!direct)fail('低情报探索只进入已确认直接相邻航道，不跨多段未知路线');
   unexploredNeighbour=true;
  }
  if(system.owner_id!==null&&system.owner_id!==state.player?.country_id)fail('探索路线经过外国领土，未获本次授权');
  if(system.fleets.some(f=>f.own!==true&&(f.ship_class==='shipclass_military'||!Number.isFinite(f.military_power)||f.military_power>0)))fail('探索路线有外来军事力量或风险未知，不冒险进入');
  if(system.starbase&&system.owner_id!==state.player?.country_id)fail('无主路线出现非己方星基，归属风险未确认');
 }
 if(unexploredNeighbour&&!['passive','evasive'].includes(own.stance))fail('进入未知邻居前须实际回读非主动追敌姿态；未知或进攻姿态不用于探路，不重复设置未确认命令');
 return {fleetId:p.fleet_id,route:systems,policy:'safe_exploration_only',unexploredNeighbour,evasiveRequired:false,observedStance:own.stance,
  stanceNote:own.stance==='evasive'?'实际回读回避姿态':'普通姿态不主动追敌，不证明具备回避姿态的自动避敌能力',riskCoverage:'current_known_risks_only'};
}
