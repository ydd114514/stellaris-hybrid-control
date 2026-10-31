// Official account balance, never an estimate derived from token usage.
// https://api-docs.deepseek.com/zh-cn/api/get-user-balance/
const endpoint='https://api.deepseek.com/user/balance';
export function parseDeepSeekBalance(value){
  if(!value||!Array.isArray(value.balance_infos))throw new Error('余额响应无效');
  const seen=new Set(),balances=[];
  for(const row of value.balance_infos){
    if(!['CNY','USD'].includes(row?.currency)||seen.has(row.currency)||typeof row.total_balance!=='string'||!/^[-]?\d+(?:\.\d{1,12})?$/.test(row.total_balance))throw new Error('余额响应无效');
    const amount=Number(row.total_balance);
    if(!Number.isFinite(amount)||Math.abs(amount)>1e12)throw new Error('余额响应无效');
    seen.add(row.currency);balances.push({currency:row.currency,amount});
  }
  if(!balances.length)throw new Error('余额响应无效');
  balances.sort((a,b)=>a.currency==='CNY'?-1:b.currency==='CNY'?1:0);
  return {balances,display:balances.map(x=>new Intl.NumberFormat('zh-CN',{style:'currency',currency:x.currency,minimumFractionDigits:2,maximumFractionDigits:2}).format(x.amount)).join(' / ')};
}

export function createApiBalanceMonitor({getKey,fetcher=fetch,onUpdate=()=>{},enabled=true,now=Date.now}={}){
  let snapshot={status:enabled?'loading':'disabled',display:'—',updatedAt:null},inFlight,disposed=false,controller;
  const publish=next=>{if(disposed)return;snapshot=next;onUpdate({...snapshot});};
  async function perform(){
    controller=new AbortController();const timer=setTimeout(()=>controller.abort(),5000);
    try{
      const key=await getKey();if(disposed)return snapshot;
      if(!key)throw new Error('未配置余额查询凭据');
      const response=await fetcher(endpoint,{method:'GET',headers:{Authorization:`Bearer ${key}`,Accept:'application/json'},redirect:'error',signal:controller.signal});
      if(!response.ok)throw new Error('余额查询失败');
      const reader=response.body.getReader(),chunks=[];let size=0;
      try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>32768)throw new Error('余额响应过大');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
      const balance=parseDeepSeekBalance(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      publish({status:'ready',display:balance.display,updatedAt:now()});
    }catch{
      // Never surface response bodies, headers, credentials or provider errors.
      publish(snapshot.updatedAt?{...snapshot,status:'stale'}:{status:'unavailable',display:'暂不可用',updatedAt:null});
    }finally{clearTimeout(timer);controller=undefined;}
    return {...snapshot};
  }
  return {getSnapshot:()=>({...snapshot}),refresh(){if(!enabled||disposed)return Promise.resolve({...snapshot});if(inFlight)return inFlight;inFlight=perform().finally(()=>{inFlight=undefined;});return inFlight;},stop(){disposed=true;controller?.abort();}};
}
