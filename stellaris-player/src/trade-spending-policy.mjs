import {checkActualSpending} from './shared-spending-guard.mjs';
const resourceKey=x=>typeof x==='string'&&/^[a-z_][a-z0-9_]{0,99}$/.test(x);

export function actualTradeUpkeep(row,{maintenanceMonths=3}={}){
 if(!Number.isFinite(row?.expense)||row.expense<0||row.expense_known===false||!Number.isFinite(row.net)||row.net_known===false)throw Error('交易支出资源的实际维护或净收支未知');
 if(!Number.isFinite(maintenanceMonths)||maintenanceMonths<0||maintenanceMonths>12)throw Error('维护复查期无效');
 const deficitReserve=Math.max(0,-row.net)*maintenanceMonths;
 return {expenseCycle:row.expense,deficitReserve,reserved:Math.max(row.expense,deficitReserve),notAddedTwice:true};
}

export function tradeBudgetPreview(row,{commitments=0,floor=0}={}){
 try{
  const upkeep=actualTradeUpkeep(row);
  if(!Number.isFinite(row.stockpile)||row.stockpile<0||row.stockpile_known===false||![commitments,floor].every(n=>Number.isFinite(n)&&n>=0))throw Error('当前库存、共享承诺或战略底线未知');
  const protectedStock=commitments+floor+upkeep.reserved;
  return {known:true,advisoryOnly:true,requiresWholeQuote:true,availableAfterAllCommitments:Math.max(0,row.stockpile-protectedStock),protectedStock,commitments,floor,upkeep,reserveAtRisk:row.stockpile<protectedStock};
 }catch(error){return {known:false,advisoryOnly:true,requiresWholeQuote:true,reason:error.message};}
}

// Actual upkeep is a billing-cycle cushion, not a share of storage capacity.
// Net already includes upkeep and monthly trade. Use the larger of one actual
// expense cycle and the existing deficit horizon, rather than adding them twice.
export function checkQuotedTrade({params,market,quote,status,commitments={},floors={},task,maintenanceMonths=3}){
 if(!quote?.success||quote.price_basis!=='engine_transaction_total'||quote.resource!==params.resource||quote.action!==params.action||quote.units!==params.units||!resourceKey(market?.settlement_currency)||quote.settlement_currency!==market.settlement_currency||!Number.isFinite(quote.total)||quote.total<=0||quote.includes_fee!==true)throw Error('当前原生桥缺少可验证的实时整笔报价，拒绝交易');
 if(!['buy','sell'].includes(params.action)||params.resource===market.settlement_currency)throw Error('交易方向或目标资源无效');
 const entry=market.resources?.find(r=>r.key===params.resource),resource=status?.resources?.[params.resource],currency=status?.resources?.[market.settlement_currency];
 if(!entry||!resource||!currency||!Number.isInteger(params.units)||params.units<=0||!Number.isFinite(entry.batch_size)||entry.batch_size<=0||params.units%entry.batch_size!==0)throw Error('数量必须是当前资源batch_size的整数倍');
 const paid=params.action==='buy'?market.settlement_currency:params.resource;
 const received=params.action==='buy'?resource:currency,credit=params.action==='buy'?params.units:quote.total;
 if(!Number.isFinite(received.stockpile)||received.stockpile<0||received.stockpile_known===false||!Number.isFinite(received.max)||received.max<=0)throw Error('交易接收方库存或真实仓储上限未知');
 if(received.stockpile+credit>received.max)throw Error('交易会超过当前真实仓储上限');
 const upkeep=actualTradeUpkeep(status.resources[paid],{maintenanceMonths}),topUp=upkeep.reserved-upkeep.deficitReserve;
 const floor=floors[paid]??0;if(!Number.isFinite(floor)||floor<0)throw Error('交易战略底线未知');
 const cost=params.action==='buy'?{[paid]:quote.total}:{[paid]:params.units};
 const evidence=checkActualSpending({cost,status,commitments,floors:{...floors,[paid]:floor+topUp},task,maintenanceMonths});
 return {...evidence,basis:'engine_quote_and_actual_upkeep',cost,paidResource:paid,upkeep,strategicFloor:floor,storage:{receivedStockpile:received.stockpile,credit,max:received.max}};
}
