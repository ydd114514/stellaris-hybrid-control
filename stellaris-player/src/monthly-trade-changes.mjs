import {surveyGameDay} from './survey-idle-policy.mjs';
import {createHash} from 'node:crypto';
import {monthlyTradeAccounting} from './monthly-trade-accounting.mjs';
const validScope=s=>typeof s?.sessionId==='string'&&s.sessionId.length>0&&Number.isSafeInteger(s.pid)&&s.pid>0&&typeof s.creationTime==='string'&&s.creationTime.length>0&&surveyGameDay(s.gameDate)!==null;
const id=x=>Number.isInteger(x)&&x>=0&&x<=0x7fffffff;
const key=x=>typeof x==='string'&&/^[a-z_][a-z0-9_]{0,99}$/.test(x);
export function validateMonthlyChange(change){
 if(!change||!['set','cancel','replace'].includes(change.operation))throw Error('月度变更仅支持set/cancel/replace');
 const required=change.operation==='cancel'?['operation','orderId']:change.operation==='replace'?['operation','orderId','resource','action','amount','priceLimit']:['operation','resource','action','amount','priceLimit'];
 if(Object.keys(change).some(k=>!required.includes(k))||required.some(k=>!Object.hasOwn(change,k)))throw Error('月度变更参数缺失或含多余字段');
 if(change.operation!=='set'&&!id(change.orderId))throw Error('orderId需要真实非负int32 ID，0合法');
 if(change.operation!=='cancel'&&(!key(change.resource)||!['buy','sell'].includes(change.action)||!Number.isInteger(change.amount)||change.amount<=0||change.amount>0x7fffffff||!id(change.priceLimit)))throw Error('资源/action/amount/priceLimit无效；数量和限价必须是原生整数，不做截断');
 if(change.operation!=='cancel'&&change.priceLimit>0&&change.amount*change.priceLimit>0x7fffffff)throw Error('数量乘限价超出引擎int32比较范围，不能溢出或截断');
 return structuredClone(change);
}
const snapshot=(market,countryId)=>{
 const a=monthlyTradeAccounting({resources:{}},market,{countryId});return {known:a.ordersKnown,orders:a.observedOrders};
};
const canonical=orders=>orders.slice().sort((a,b)=>a.order_id-b.order_id);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const desired=c=>({resource:c.resource,action:c.action,amount:c.amount,price_limit:c.priceLimit});
const matches=(o,c)=>o.resource===c.resource&&o.action===c.action&&o.amount===c.amount&&o.price_limit===c.priceLimit;
export function previewMonthlyChange(market,input,{countryId,scope}={}){
 const change=validateMonthlyChange(input),s=snapshot(market,countryId);
 const result={readOnly:true,executable:false,change,observedCountryId:countryId,steps:[],settlementConfirmed:false,worldLineageVerified:false};
 if(!validScope(scope))return {...result,status:'blocked_unknown_session',reason:'缺少当前控制器、游戏进程或游戏日期绑定'};
 if(!s.known)return {...result,status:'blocked_unknown_orders',reason:'订单覆盖或归属未知，不能以空列表推断已有订单'};
 result.sourceFingerprint=createHash('sha256').update(JSON.stringify([countryId,scope.sessionId,scope.pid,scope.creationTime,scope.gameDate,canonical(s.orders)])).digest('hex');
 const old=change.operation==='set'?null:s.orders.find(o=>o.order_id===change.orderId);
 if(change.operation==='cancel')return {...result,status:old?'cancellation_preview':'already_absent',steps:old?[{method:'set_monthly_trade',params:{cancel:true,order_id:old.order_id},expectedOrder:old}]:[]};
 const sameResource=s.orders.filter(o=>o.resource===change.resource&&o.action===change.action);
 if(change.operation==='set'&&sameResource.length)return {...result,status:sameResource.length===1&&matches(sameResource[0],change)?'already_present':'existing_orders_require_review',existingOrders:sameResource,reason:'不假定设置会覆盖旧单，也不叠加一条重复订单'};
 if(change.operation==='replace'&&!old)return {...result,status:'blocked_missing_order',reason:'待调整的旧单不存在，不自动改成新增'};
 if(old&&matches(old,change))return {...result,status:'already_present'};
 const extras=sameResource.filter(o=>o.order_id!==old?.order_id);
 if(extras.length)return {...result,status:'existing_orders_require_review',existingOrders:extras};
 const create={method:'set_monthly_trade',params:{resource:change.resource,action:change.action,amount:change.amount,price_limit:change.priceLimit,cancel:false}};
 return {...result,status:old?'two_phase_replace_preview':'creation_preview',steps:[...(old?[{method:'set_monthly_trade',params:{cancel:true,order_id:old.order_id},expectedOrder:old}]:[]),create],
  note:'仅预览，不提交；先撤后建不是原子操作。资金、价格和维护影响尚需准入核验；不能因预览存在就获得持续支出权限。'};
}
// Verify only order registration/removal. Inventory changes or the passage of a
// month alone cannot prove which recurring trade actually settled or at what price.
export function reconcileMonthlyChange(before,after,input,{countryId,sourceFingerprint,beforeScope,afterScope,requestId,confirmedRemovals=[]}={}){
 const change=validateMonthlyChange(input),plan=previewMonthlyChange(before,change,{countryId,scope:beforeScope}),a=snapshot(before,countryId),b=snapshot(after,countryId);
 const unknown=reason=>({status:'unknown',reason,automaticRetryAllowed:false,settlementConfirmed:false,worldLineageVerified:false});
 if(!validScope(beforeScope)||!validScope(afterScope)||beforeScope.sessionId!==afterScope.sessionId||beforeScope.pid!==afterScope.pid||beforeScope.creationTime!==afterScope.creationTime||surveyGameDay(afterScope.gameDate)<surveyGameDay(beforeScope.gameDate))return unknown('会话、进程或时间发生变化，不接续旧变更');
 if(!a.known||!b.known)return unknown('变更前后列表覆盖或归属未知');
 if(!sourceFingerprint||sourceFingerprint!==plan.sourceFingerprint)return unknown('缺少或不匹配的变更前指纹');
 if(!['creation_preview','cancellation_preview','two_phase_replace_preview'].includes(plan.status))return unknown('前态不是可核对的明确变更预览');
 const oldIds=new Set(a.orders.map(o=>o.order_id)),removed=a.orders.filter(o=>!b.orders.some(n=>n.order_id===o.order_id)),added=b.orders.filter(o=>!oldIds.has(o.order_id));
 const survivors=a.orders.filter(o=>b.orders.some(n=>n.order_id===o.order_id));
 if(survivors.some(o=>!same(o,b.orders.find(n=>n.order_id===o.order_id))))return unknown('现存订单内容改变，不能认定预期变更完成');
 const expectedRemoved=change.operation==='set'?[]:[change.orderId];
 // Do not rewrite the original fingerprint or accept arbitrary parallel edits.
 // A cleanup witness must have observed this exact request already pending,
 // and must prove the exact other tuple's absence inside the same scope.
 const acknowledged=[];
 for(const proof of Array.isArray(confirmedRemovals)?confirmedRemovals:[]){
  if(typeof requestId!=='string'||!requestId.length)continue;
  const s=proof?.scope,o=proof?.order;
  if(proof?.kind!=='owned_cleanup_readback'||proof.countryId!==countryId||!validScope(s)||s.sessionId!==beforeScope.sessionId||s.pid!==beforeScope.pid||s.creationTime!==beforeScope.creationTime||surveyGameDay(s.gameDate)<surveyGameDay(beforeScope.gameDate)||surveyGameDay(s.gameDate)>surveyGameDay(afterScope.gameDate))continue;
  if(!Array.isArray(proof.pendingRequests)||!proof.pendingRequests.some(w=>w.sessionId===beforeScope.sessionId&&w.requestId===requestId&&w.sourceFingerprint===sourceFingerprint))continue;
  if(!o||expectedRemoved.includes(o.order_id)||!removed.some(r=>r.order_id===o.order_id&&r.resource===o.resource&&r.action===o.action&&r.amount===o.amount&&r.price_limit===o.price_limit))continue;
  if(!acknowledged.includes(o.order_id))acknowledged.push(o.order_id);
 }
 const expected=[...expectedRemoved,...acknowledged].sort((x,y)=>x-y),evidence=acknowledged.length?{acknowledgedCleanupIds:acknowledged.sort((x,y)=>x-y)}:{};
 if(!same(removed.map(o=>o.order_id).sort((x,y)=>x-y),expected))return unknown('撤销范围不匹配');
 if(change.operation==='cancel')return added.length?unknown('撤销时出现额外新增订单'):{status:'order_removed',...evidence,automaticRetryAllowed:false,settlementConfirmed:false,worldLineageVerified:false};
 if(change.operation==='replace'&&added.length===0)return {status:'old_order_removed_new_unconfirmed',...evidence,automaticRetryAllowed:false,settlementConfirmed:false,worldLineageVerified:false};
 if(added.length!==1||!matches(added[0],change))return unknown('新增订单数量或字段不匹配');
 return {status:change.operation==='replace'?'order_replaced':'order_registered',orderId:added[0].order_id,...evidence,automaticRetryAllowed:false,settlementConfirmed:false,worldLineageVerified:false};
}

export const monthlyChangeSchema={
 type:'object',properties:{operation:{enum:['set','cancel','replace']}},required:['operation'],
 anyOf:[
  {properties:{operation:{const:'cancel'},orderId:{type:'integer',minimum:0,maximum:2147483647}},required:['orderId'],additionalProperties:false},
  ...['set','replace'].map(operation=>({properties:{operation:{const:operation},...(operation==='replace'?{orderId:{type:'integer',minimum:0,maximum:2147483647}}:{}),resource:{type:'string',pattern:'^[a-z_][a-z0-9_]{0,99}$'},action:{enum:['buy','sell']},amount:{type:'integer',minimum:1,maximum:2147483647},priceLimit:{type:'integer',minimum:0,maximum:2147483647}},required:[...(operation==='replace'?['orderId']:[]),'resource','action','amount','priceLimit'],additionalProperties:false}))
 ]
};
