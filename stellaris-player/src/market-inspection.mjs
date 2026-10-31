const key=value=>typeof value==='string'&&/^[a-z_][a-z0-9_]{0,99}$/.test(value);
export function validateMarketInspectionScope({topic,resource,action,units}={}){
 const focused=resource!==undefined||action!==undefined||units!==undefined;
 if(focused&&topic!=='market')throw Error('resource/action/units查询参数仅用于market');
 if(resource!==undefined&&!key(resource))throw Error('市场resource必须是当前资源key');
 if(action!==undefined&&(!['buy','sell'].includes(action)||resource===undefined))throw Error('市场action需要resource，且只能buy或sell');
 if(units!==undefined&&(!Number.isSafeInteger(units)||units<1||units>5000||resource===undefined||action===undefined))throw Error('市场units需要resource/action，且为1..5000整数');
 return {resource,action,units};
}

// Only inspect previews are narrowed. Execution always obtains its own quote;
// monthly accounting consumes the original full market before this projection.
export async function quoteMarketInspection(market,scope,rpc){
 const rows=Array.isArray(market.resources)?market.resources:[];
 const selected=scope.resource===undefined?rows:rows.filter(row=>row.key===scope.resource);
 if(scope.resource!==undefined&&selected.length!==1)throw Error('本次市场没有唯一的目标资源候选，不能猜资源key');
 const quoted=[];
 for(const row of selected){
  const units=scope.units??row.batch_size,actions=scope.action?[scope.action]:['buy','sell'];
  const result={...row,price_basis:'resource_definition_base_estimate',quote_coverage:[],price_basis_by_action:{buy:'resource_definition_base_estimate',sell:'resource_definition_base_estimate'}};
  if(!key(market.settlement_currency)){result.quote_error='结算币未确认，未查询整笔报价';quoted.push(result);continue;}
  if(!Number.isSafeInteger(row.batch_size)||row.batch_size<1||!Number.isSafeInteger(units)||units<1||units>5000||units%row.batch_size!==0){
   if(scope.resource!==undefined)throw Error('市场units须为当前引擎batch_size的整数倍，且不超过5000');
   result.quote_error='本批数量或引擎批量未知，未查询报价';quoted.push(result);continue;
  }
  for(const action of actions){
   try{
    const q=await rpc('get_market_quote',{resource:row.key,action,units});
    if(q?.success!==true||q.price_basis!=='engine_transaction_total'||q.includes_fee!==true||q.resource!==row.key||q.action!==action||q.units!==units||q.settlement_currency!==market.settlement_currency||!Number.isFinite(q.total)||q.total<=0)throw Error('整笔报价身份、金额、结算币或含费来源未确认');
    result[`${action}_total`]=q.total;result[`${action}_price_per_unit`]=q.total/units;
    result.quote_units=units;result.quote_coverage.push(action);result.price_basis_by_action[action]='engine_transaction_total';
   }catch(error){result.quote_error=error.message;}
  }
  if(result.quote_coverage.length===actions.length)result.price_basis='engine_transaction_total';
  quoted.push(result);
 }
 return {resources:quoted,quoteScope:{resource:scope.resource??null,action:scope.action??'both',units:scope.units??'one_native_batch',advisoryOnly:true,executionRequiresFreshWholeQuote:true,monthlyAccountingScope:'original_full_market'}};
}
