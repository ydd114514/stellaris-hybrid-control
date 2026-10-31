import {surveyGameDay} from './survey-idle-policy.mjs';
const fields=['expiresOn','maxStockpile','minStockpile'];
const quantity=x=>Number.isFinite(x)&&x>=0&&x<=1e12;

export function validateMonthlyLifecyclePolicy(input,change){
 if(input===undefined)return null;
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length===0||Object.keys(input).some(k=>!fields.includes(k)))throw Error('月度订单条件需要有效期限或库存边界，不能含额外字段');
 if(!change||!['set','replace'].includes(change.operation))throw Error('持续条件需要对应的set/replace变更，撤销不接受新条件');
 if(input.expiresOn!==undefined&&surveyGameDay(input.expiresOn)===null)throw Error('expiresOn需要有效群星日期');
 if(input.maxStockpile!==undefined&&(change.action!=='buy'||!quantity(input.maxStockpile)))throw Error('maxStockpile仅用于买入且必须是非负库存上界');
 if(input.minStockpile!==undefined&&(change.action!=='sell'||!quantity(input.minStockpile)))throw Error('minStockpile仅用于卖出且必须是非负库存下界');
 return structuredClone(input);
}

// These are controller review conditions, not native atomic inventory caps.
// No future production or income is treated as current inventory, and the
// already inclusive engine net is never adjusted again by order quantities.
export function monthlyLifecycleDecision(status,record){
 if(!record.policy)return null;
 let policy;try{policy=validateMonthlyLifecyclePolicy(record.policy,record.change);}catch(error){return {kind:'unknown',reason:'invalid_policy',detail:error.message};}
 const current=surveyGameDay(status?.date?.formatted),bound=surveyGameDay(record.after?.scope?.gameDate??record.before?.scope?.gameDate);
 if(current===null||bound===null||current<bound)return {kind:'unknown',reason:'unknown_or_rolled_back_date'};
 if(policy.expiresOn!==undefined&&current>=surveyGameDay(policy.expiresOn))return {kind:'complete',reason:'expired',expiresOn:policy.expiresOn};
 const {action,resource,amount}=record.change,row=status?.resources?.[resource];
 if(policy.maxStockpile!==undefined||policy.minStockpile!==undefined){
  if(row?.stockpile_known!==true||!Number.isFinite(row.stockpile)||row.stockpile<0)return {kind:'unknown',reason:'unknown_target_inventory',resource};
  if(action==='buy'&&policy.maxStockpile!==undefined&&(row.stockpile>=policy.maxStockpile||row.stockpile+amount>policy.maxStockpile))return {kind:'complete',reason:'buy_inventory_boundary',resource,stockpile:row.stockpile,boundary:policy.maxStockpile};
  if(action==='sell'&&policy.minStockpile!==undefined&&(row.stockpile<=policy.minStockpile||row.stockpile-amount<policy.minStockpile))return {kind:'complete',reason:'sell_inventory_boundary',resource,stockpile:row.stockpile,boundary:policy.minStockpile};
 }
 return {kind:'continue'};
}

export function assertMonthlyLifecycleAdmission(snapshot,change,policy){
 if(!policy)return;
 const decision=monthlyLifecycleDecision(snapshot.status,{change,policy,before:{scope:snapshot.scope}});
 if(decision?.kind!=='continue')throw Error(`月度订单条件当前不允许新增：${decision?.reason??'unknown'}`);
}

export function monthlyLifecycleActions(status,records,{sessionId}={}){
 const completed=[],unknown=[];
 for(const record of records.filter(r=>r.sessionId===sessionId&&!r.released&&r.policy)){
  const d=monthlyLifecycleDecision(status,record);if(!d||d.kind==='continue')continue;
  const item={requestId:record.requestId,orderId:record.ownedOrder?.order_id,...d};
  if(d.kind==='complete'&&record.ownedOrder&&record.ownership?.known!==false&&['order_registered','order_replaced'].includes(record.status)&&record.cleanupIntent?.status!=='issued')completed.push(item);
  else unknown.push({...item,kind:'unknown',reason:d.kind==='complete'?'unconfirmed_order_ownership':d.reason});
 }
 return {completed,unknown};
}

export const monthlyLifecycleSchema={type:'object',properties:{expiresOn:{type:'string',pattern:'^[0-9]{4,7}\\.(0[1-9]|1[0-2])\\.(0[1-9]|[12][0-9]|30)$'},maxStockpile:{type:'number',minimum:0,maximum:1e12},minStockpile:{type:'number',minimum:0,maximum:1e12}},anyOf:[{required:['expiresOn']},{required:['maxStockpile']},{required:['minStockpile']}],additionalProperties:false};
