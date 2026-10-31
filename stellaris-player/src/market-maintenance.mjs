import {actualTradeUpkeep} from './trade-spending-policy.mjs';
export const MARKET_MAINTENANCE={triggerRatio:.95,targetRatio:.7,bufferMonths:24,recoveryMonths:3};

/** A bounded recovery purchase candidate. A fresh whole engine quote and the
 * normal transaction guards are still mandatory before any order is sent. */
export function recoveryPurchasePlan(resources,floors,market){
 for(const [resource,floor]of Object.entries(floors)){
  const r=resources?.[resource];if(!Number.isFinite(floor)||floor<0||!r||!Number.isFinite(r.stockpile)||r.stockpile<0||r.stockpile_known===false||!Number.isFinite(r.net)||r.net_known===false)return {blocked:resource+'库存、维护趋势或战略底线未知'};
  if(r.stockpile>=floor&&r.stockpile+Math.min(0,r.net)*3>=floor)continue;
  const entry=market.resources?.find(x=>x.key===resource),batch=entry?.batch_size;
  if(!Number.isSafeInteger(batch)||batch<=0||batch>5000||market.settlement_currency===resource)return {blocked:resource+'没有已确认的可购买批量或结算货币'};
  const target=floor+Math.max(0,-r.net)*MARKET_MAINTENANCE.recoveryMonths;
  const units=Math.min(Math.floor(5000/batch)*batch,Math.ceil((target-r.stockpile)/batch)*batch);
  if(!Number.isFinite(r.max)||r.max<=0||r.stockpile+units>r.max)return {blocked:resource+'恢复目标在真实仓储上限与合法批量下不可达，需要重新规划预算'};
  return {order:{command:'market_trade',arguments:{resource,action:'buy',units}},settlement:market.settlement_currency};
 }
 return {};
}

/** Quantity advice, never a price or permission to trade. Native guards still decide. */
export function routineSalePlan(resource,{batchSize,settlement,commitments=0,floor=0}={}){
 const {triggerRatio,targetRatio,bufferMonths}=MARKET_MAINTENANCE;
 const hold=reason=>({action:'hold',reason});
 if(!resource||![resource.stockpile,resource.net,resource.max,batchSize].every(Number.isFinite)||resource.max<=0||batchSize<=0||!Number.isInteger(batchSize))return hold('库存、容量、月产出或合法批量未知');
 if(resource.net<=0)return hold('没有持续净产出，不因库存接近上限反复维护');
 if(resource.stockpile<resource.max*triggerRatio)return hold('尚未达到高水位，继续其他经营');
 if(settlement&&(!Number.isFinite(settlement.stockpile)||settlement.stockpile_known===false||!Number.isFinite(settlement.max)||settlement.max<=0))return hold('结算币库存或真实仓储上限未知');
 if(settlement&&settlement.stockpile>=settlement.max)return hold('结算币已满，先安排有收益的真实支出；允许暂时溢出，不反复倒货');
 if(![commitments,floor].every(n=>Number.isFinite(n)&&n>=0)||resource.stockpile_known===false)return hold('当前库存、共享承诺或战略底线未知');
 let upkeep;try{upkeep=actualTradeUpkeep(resource);}catch{return hold('实际维护或净收支未知，需要刷新后再评估');}
 const reserve=upkeep.reserved+commitments+floor,target=Math.max(reserve,Math.min(resource.max*targetRatio,resource.max-resource.net*bufferMonths));
 const available=Math.floor(Math.max(0,resource.stockpile-reserve)/batchSize)*batchSize;
 const total=Math.min(available,Math.ceil(Math.max(0,resource.stockpile-target)/batchSize)*batchSize);
 const perOrder=Math.floor(5000/batchSize)*batchSize;
 if(total<=0||perOrder<=0)return hold('受运营储备或单笔合法批量限制，没有可建议数量');
 return {action:'consider_sell',triggerRatio,targetRatio,bufferMonths,reserve,upkeep,commitments,floor,targetStockpile:target,
   suggestedTotalUnits:total,firstOrderUnitsUpperBound:Math.min(total,perOrder),minimumChunksAtOrderLimit:Math.ceil(total/perOrder),
   monthsToHighWaterAfterPlan:Math.max(0,(resource.max*triggerRatio-(resource.stockpile-total))/resource.net),
   requiresFreshWholeQuote:true,executable:false,
   note:'这是释放空间的总量目标，不是成交承诺；每笔最多5000且必须按真实整笔报价检查结算币容量与储备。容量不允许时缩减或停止，不循环试单。完成有效缓冲后离开市场，等重新达到高水位再评估。'};
}
