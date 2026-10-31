import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDeepSeekBalance,createApiBalanceMonitor} from '../src/api-balance.mjs';
const body={is_available:true,balance_infos:[{currency:'CNY',total_balance:'12.3456',granted_balance:'2',topped_up_balance:'10.3456'}]};
test('official total balance is displayed without estimating tokens or adding the granted balance twice',()=>{
  assert.match(parseDeepSeekBalance(body).display,/12\.35/);
  for(const input of [{balance_infos:[]},{balance_infos:[{currency:'CNY',total_balance:'no'}]},{balance_infos:[{currency:'FAKE',total_balance:'10'}]}])assert.throws(()=>parseDeepSeekBalance(input));
  assert.match(parseDeepSeekBalance({balance_infos:[{currency:'USD',total_balance:'0.00'}]}).display,/0\.00/);
});
test('one shared official GET request keeps credentials and raw errors out of the public snapshot',async()=>{
  let calls=0,fail=false;
  const monitor=createApiBalanceMonitor({getKey:async()=>'offline-placeholder-key',now:()=>100,fetcher:async(url,init)=>{
    calls++;assert.equal(url,'https://api.deepseek.com/user/balance');assert.equal(init.method,'GET');assert.equal(init.redirect,'error');assert.equal(init.headers.Authorization,'Bearer offline-placeholder-key');
    if(fail)throw new Error('offline-placeholder-key internal error');return new Response(JSON.stringify(body));
  }});
  await Promise.all([monitor.refresh(),monitor.refresh()]);assert.equal(calls,1);assert.equal(monitor.getSnapshot().status,'ready');
  fail=true;await monitor.refresh();assert.equal(monitor.getSnapshot().status,'stale');assert.match(monitor.getSnapshot().display,/12\.35/);
  assert.doesNotMatch(JSON.stringify(monitor.getSnapshot()),/placeholder|internal/);monitor.stop();await monitor.refresh();assert.equal(calls,2);
});
test('isolated mode never loads a real key or calls any endpoint, and errors never become fake zero balances',async()=>{
  let calls=0;const disabled=createApiBalanceMonitor({enabled:false,getKey:()=>{calls++;throw new Error();}});
  await disabled.refresh();assert.equal(calls,0);assert.equal(disabled.getSnapshot().display,'—');
  const missing=createApiBalanceMonitor({getKey:async()=>undefined});await missing.refresh();assert.equal(missing.getSnapshot().display,'暂不可用');
});
