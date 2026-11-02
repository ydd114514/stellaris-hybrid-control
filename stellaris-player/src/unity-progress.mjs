const finite=Number.isFinite;
const day=date=>{const m=/^(\d+)\.(\d+)\.(\d+)$/.exec(date??'');return m?+m[1]*360+(+m[2]-1)*30+(+m[3]-1):null;};
const number=x=>finite(x)?x:null;
const round=x=>finite(x)?Math.round(x*10)/10:null;
export function unitySample(state){
 const u=state.resources?.unity;
 if(!finite(u?.net)||u.net_known===false)return;
 return {net:u.net,income:u.income_known===false?null:number(u.income),expense:u.expense_known===false?null:number(u.expense),
  empireSize:number(state.capacities?.empire_size),colonies:number(state.capacities?.colonies),traditions:number(state.traditions?.unlocked_traditions_count)};
}
/** Owner target and observed results, not a promise that a steering flag works. */
export function unityProgress(state,samples=[]){
 const current=unitySample(state),date=day(state.date);
 const focused=state.userEconomicPolicy?.priority==='unity_first'||state.operatorStanding?.economyFocus==='unity_traditions'||state.operationalGoal?.targetResource==='unity'||state.strategyContract?.economyFocus==='unity_traditions';
 const result={known:!!current,focused,
  income:round(current?.income),expense:round(current?.expense),net:round(current?.net),maintenanceShare:null,monthsToNextTradition:null,traditionCost:null,
  unlockedTraditions:current?.traditions??null,estimatedMonthsToFundNext:null,stagnating:false,maintenancePressure:false,scalingBehind:false,baseline:null,reasons:[]};
 if(!current){result.reasons.push('凝聚力净产尚不可读，不能认定目标已落实');return result;}
 if(current.income>0&&current.expense!==null){result.maintenanceShare=round(current.expense/current.income*100)/100;result.maintenancePressure=focused&&current.expense/current.income>=.5;}
 const cost=number(state.traditions?.next_tradition_cost),stock=number(state.resources?.unity?.stockpile);
 const exact=state.traditions?.next_tradition_cost_known===true;
 if(exact)result.traditionCost=cost;
 if(cost!==null&&stock!==null&&current.net>0){
  const months=round(Math.max(0,cost-stock)/current.net);
  if(exact)result.monthsToNextTradition=months;else result.estimatedMonthsToFundNext=months;
 }
 const previous=date===null?null:[...samples].reverse().find(s=>date-s.day>=1080&&date-s.day<=1800&&finite(s.unity?.net));
 if(previous){
  const p=previous.unity,netGrowth=p.net>0?(current.net/p.net-1)*100:null;
  const incomeGrowth=p.income>0&&current.income!==null?(current.income/p.income-1)*100:null;
  const sizeGrowth=p.empireSize>0&&current.empireSize!==null?(current.empireSize/p.empireSize-1)*100:null;
  const gained=p.traditions!==null&&current.traditions!==null?current.traditions-p.traditions:null;
  result.baseline={observedYears:round((date-previous.day)/360),netGrowthPercent:round(netGrowth),incomeGrowthPercent:round(incomeGrowth),empireSizeGrowthPercent:round(sizeGrowth),traditionsGained:gained};
  result.stagnating=focused&&(netGrowth!==null?netGrowth<=10:current.net<=p.net)&&gained!==null&&gained<=0;
  result.scalingBehind=focused&&sizeGrowth!==null&&sizeGrowth>10&&netGrowth!==null&&netGrowth<sizeGrowth;
 }
 if(result.maintenancePressure)result.reasons.push(`凝聚力维护消耗约${round(result.maintenanceShare*100)}%总产出，先inspect edicts和领袖明细核查，未知维护不可算成0`);
 if(result.stagnating)result.reasons.push('同局近3至5年凝聚力净产与传统推进停滞，不能只重复续期原方针');
 if(result.scalingBehind)result.reasons.push('帝国规模增长快于凝聚力净产，新增殖民负担尚未消化');
 if(!exact&&cost!==null)result.reasons.push('当前桥的传统费用是估算，等待月数仅供参考，不能当实际扣费或完成证据');
 return result;
}
