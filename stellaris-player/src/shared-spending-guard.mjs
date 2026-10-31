// Admission against actual engine costs, never an engine-enforced hard cap.
const resources=x=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length>0&&Object.entries(x).every(([k,n])=>/^[a-z_][a-z0-9_]{0,99}$/.test(k)&&Number.isFinite(n)&&n>=0&&n<=1e12);
const fits=(available,required)=>available>=required||Math.abs(available-required)<=Number.EPSILON*Math.max(1,Math.abs(available),required)*8;
export const sharedCostCommands=new Set(['market_trade','build_district','build_building','upgrade_building','build_ship','claim_system']);
export function hasSpendingReservations({commitments={},floors={}}={}){
 return [...Object.values(commitments),...Object.values(floors)].some(n=>!Number.isFinite(n)||n<0||n>0);
}
export function checkActualSpending({cost,status,commitments={},floors={},task,maintenanceMonths=3,expenseCycle=false}){
 if(!resources(cost))throw Error('实时费用未知，不能兑现共享支出');
 if(!Number.isFinite(maintenanceMonths)||maintenanceMonths<0||maintenanceMonths>12)throw Error('维护复查期无效');
 if(typeof expenseCycle!=='boolean')throw Error('实际支出周期选项无效');
 if(task&&(!['ready','executing','blocked','waiting'].includes(task.status)||!task.budget||Array.isArray(task.budget)))throw Error('支出任务状态或预算无效');
 const rows=[];
 for(const [resource,actual]of Object.entries(cost)){
  const row=status?.resources?.[resource],reserved=commitments[resource]??0,floor=floors[resource]??0,allocation=task?.budget?.[resource]??0;
  if(![reserved,floor,allocation].every(n=>Number.isFinite(n)&&n>=0)||allocation>reserved)throw Error('共享预算或本任务预留覆盖未知：'+resource);
  if(task&&!fits(allocation,actual))throw Error('真实费用超过任务声明预算，空预算不能绕过共享预留：'+resource);
  if(!Number.isFinite(row?.stockpile)||row.stockpile<0||!Number.isFinite(row.net)||row.stockpile_known===false||row.net_known===false)throw Error('支出资源库存或净收支未知：'+resource);
  if(expenseCycle&&(!Number.isFinite(row.expense)||row.expense<0||row.expense_known===false))throw Error('实际维护支出周期未知：'+resource);
  const otherReserved=reserved-allocation,deficitReserve=Math.max(0,-row.net)*maintenanceMonths,upkeepExpenseCycle=expenseCycle?row.expense:0,maintenance=Math.max(deficitReserve,upkeepExpenseCycle),available=row.stockpile-otherReserved-floor-maintenance;
  if(!fits(available,actual))throw Error('真实支出将占用其他任务、月度订单或维护底线：'+resource);
  rows.push({resource,actual,allocated:allocation,otherReserved,floor,maintenance,deficitReserve,upkeepExpenseCycle,stockpile:row.stockpile,available});
 }
 return {basis:'fresh_engine_candidate_cost',maintenanceMonths,expenseCycle,rows,hardNativeBudget:false};
}

export async function readActualSpendingCost(order,rpc){
 const p=order.arguments;
 if(order.command==='claim_system'){
  if(p.remove===true)return {influence:0};
  const q=await rpc('get_claim_quote',{system_id:p.system_id});
  if(q?.success!==true||q.system_id!==p.system_id||q.action!=='add'||q.count!==1||q.legal!==true||q.cost_basis!=='engine_add_system_claim_cost'||!Number.isSafeInteger(q.influence_cost_fixed)||q.influence_cost_fixed<0||q.influence_cost_fixed>1e14||!resources(q.cost)||Object.keys(q.cost).length!==1||q.cost.influence!==q.influence_cost_fixed/100000)throw Error('宣称实时费用或引擎合法性未知；需支持宣称报价的新桥，不猜影响力花费');
  return q.cost;
 }

 if(order.command==='market_trade'){
  const q=await rpc('get_market_quote',p),market=await rpc('get_market');
  if(q?.success!==true||q.price_basis!=='engine_transaction_total'||q.resource!==p.resource||q.action!==p.action||q.units!==p.units||q.includes_fee!==true||q.settlement_currency!==market.settlement_currency||typeof q.settlement_currency!=='string'||!Number.isFinite(q.total)||q.total<=0)throw Error('交易实时整笔报价来源未知');
  return p.action==='buy'?{[q.settlement_currency]:q.total}:{[p.resource]:p.units};
 }
 let snapshot,candidates;
 if(order.command==='build_district'){
  snapshot=await rpc('get_buildable_districts',{planet_id:p.planet_id});
  candidates=snapshot.buildable?.filter(c=>c.key===p.district_key&&c.can_build===true);
 }else if(order.command==='build_building'){
  snapshot=await rpc('get_buildable_buildings',{planet_id:p.planet_id});
  candidates=snapshot.zones?.filter(z=>z.zone_id===p.slot_index&&z.district===p.district_type).flatMap(z=>(z.buildable||[]).filter(c=>c.key===p.building_key));
 }else if(order.command==='upgrade_building'){
  snapshot=await rpc('get_building_upgrade_candidates',{planet_id:p.planet_id});
  candidates=snapshot.candidates?.filter(c=>c.building_id===p.building_id&&c.upgrade_key===p.upgrade_key&&c.can_upgrade===true);
 }else if(order.command==='build_ship'){
  snapshot=await rpc('get_buildable_ships',{system_id:p.system_id});
  candidates=snapshot.buildable?.filter(c=>c.design_id===p.design_id&&c.can_build===true);
 }else throw Error('该支出尚无可核对的实时费用接口；保留共享资源，先撤销承诺或选择已支持动作');
 if(snapshot?.success!==true||order.command!=='build_ship'&&snapshot.planet_id!==p.planet_id||candidates?.length!==1||!resources(candidates[0].cost))throw Error('当前唯一合法候选的实时费用不可确认');
 const count=order.command==='build_ship'?p.count??1:1;
 if(!Number.isInteger(count)||count<1)throw Error('实时费用数量无效');
 const cost=Object.fromEntries(Object.entries(candidates[0].cost).map(([k,n])=>[k,n*count]));
 if(!resources(cost))throw Error('实时批量费用超出范围');return cost;
}
