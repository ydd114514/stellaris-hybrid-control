const resourceKey=x=>typeof x==='string'&&/^[a-z_][a-z0-9_]{0,99}$/.test(x);
// Read-only accounting. Engine net already includes existing monthly trades.
// Never add their quantities or anticipated sale proceeds to spendable money.
export function monthlyTradeAccounting(status,market,{countryId,commitments={},floors={},months=3}={}){
 if(!Number.isInteger(months)||months<1||months>24)throw Error('预测周期需要1..24个月');
 const source=market?.monthly_trades;
 const valid=Array.isArray(source)&&source.length<=4096&&source.every(x=>Number.isInteger(x?.order_id)&&x.order_id>=0&&x.order_id<=0x7fffffff&&resourceKey(x.resource)&&['buy','sell'].includes(x.action)&&Number.isInteger(x.amount)&&x.amount>0&&x.amount<=0x7fffffff&&Number.isInteger(x.max_unit_price)&&x.max_unit_price>=0&&x.max_unit_price<=0x7fffffff)&&new Set(source.map(x=>x.order_id)).size===source.length;
 const countryKnown=Number.isInteger(countryId)&&countryId>=0&&countryId<0xffffffff&&market?.monthly_trade_country_id===countryId;
 const ordersKnown=valid&&countryKnown&&market?.monthly_trades_complete===true&&market?.active_monthly_trades_count===source.length;
 const observedOrders=valid?source.map(x=>({order_id:x.order_id,resource:x.resource,action:x.action,amount:x.amount,price_limit:x.max_unit_price})):[];
 const settlement=resourceKey(market?.settlement_currency)?market.settlement_currency:null;
 const keys=new Set([...Object.keys(status?.resources||{}),...Object.keys(commitments),...Object.keys(floors),...observedOrders.map(x=>x.resource)]);
 if(settlement)keys.add(settlement);
 const projections=[];
 for(const resource of keys){
  const row=status?.resources?.[resource],reserved=commitments[resource]??0,floor=floors[resource]??0;
  const known=resourceKey(resource)&&row?.stockpile_known===true&&row.net_known===true&&row.net_basis==='engine_total_including_monthly_trade'&&Number.isFinite(row.stockpile)&&row.stockpile>=0&&Number.isFinite(row.net)&&Number.isFinite(reserved)&&reserved>=0&&Number.isFinite(floor)&&floor>=0;
  projections.push(known?{resource,known:true,stockpile:row.stockpile,observedNet:row.net,reserved,floor,
   spendableNow:Math.max(0,row.stockpile-reserved-floor),
   projectedStockpile:row.stockpile+row.net*months,
   reserveStressBalance:row.stockpile+Math.min(0,row.net)*months-reserved-floor,
   reserveAtRisk:row.stockpile+Math.min(0,row.net)*months-reserved-floor<0}:
   {resource,known:false,reason:'库存/总净收支来源或预留底线未知，不能按0对账'});
 }
 return {version:1,readOnly:true,advisoryOnly:true,gameDate:status?.date?.formatted??null,ordersKnown,observedOrders,months,
  budgetKnown:ordersKnown&&settlement!==null&&projections.length>0&&projections.every(x=>x.known),projections,
  settlementCurrency:settlement,
  recurringWritesEnabled:false,
  notes:['总净收支已包含现有月度贸易，订单数量不再次叠加到net。','spendableNow只扣当前预留和底线，未来卖出收入不计为已到账资金。','预测不是成交保证；价格条件、缺钱/缺货、维护和新订单可改变下月结果。','同资源多条订单分别保留，不能假定重复设置会覆盖；调整/撤销仍需逐条核对真实order_id和跨月结果。',...(!ordersKnown?['月度列表覆盖或玩家归属未确认，空列表不代表没有订单；禁止据此认定新增持续支出可承受。']:[])]};
}
