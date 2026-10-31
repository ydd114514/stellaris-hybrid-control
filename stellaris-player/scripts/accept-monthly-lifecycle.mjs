// Prepared only. Do not run during the user's implementation-only rest stage.
// One future unified session; no desktop control, loading, resource edits or replay.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {NativeGame} from '../src/native-game.mjs';
import {ensureNativeGame} from '../src/native-bootstrap.mjs';
import {surveyGameDay} from '../src/survey-idle-policy.mjs';
const directory=resolve('.local/monthly-lifecycle-acceptance-'+Date.now());
const report={startedAt:new Date().toISOString(),modelRequests:0,resourceMemoryWrites:0,automaticSaveLoads:0};
let game;
const nextMonth=(date,offset)=>{
 const [y,m]=date.split('.').map(Number),n=y*12+m-1+offset;
 return `${String(Math.floor(n/12)).padStart(4,'0')}.${String(n%12+1).padStart(2,'0')}.01`;
};
const tuple=o=>JSON.stringify([o.order_id,o.resource,o.action,o.amount,o.max_unit_price??o.price_limit]);
try{
 await mkdir(directory,{recursive:true});await ensureNativeGame({directory});
 game=new NativeGame({directory,minutes:3,requirePicture:false,presentOrders:false,monthlyLifecyclePilot:true});
 await game.start({keepPaused:true});report.before=await game.monthlySnapshot();
 const initial=report.before.market.monthly_trades,expiresOn=nextMonth(report.before.scope.gameDate,1);
 const resources=['food','minerals'].filter(k=>report.before.market.resources?.some(r=>r.key===k)&&!initial.some(o=>o.resource===k&&o.action==='buy'));
 assert.equal(resources.length,2,'需要food/minerals两个未占用的买入槽；不覆盖手工订单');
 report.expiring=await game.monthlyTrade({operation:'execute',requestId:'expiry-one',snapshotId:game.snapshotId,change:{operation:'set',resource:resources[0],action:'buy',amount:1,priceLimit:4},policy:{expiresOn}});
 assert.equal(report.expiring.status,'order_registered');
 await game.observe();
 report.retained=await game.monthlyTrade({operation:'execute',requestId:'retain-one',snapshotId:game.snapshotId,change:{operation:'set',resource:resources[1],action:'buy',amount:1,priceLimit:4},policy:{expiresOn:nextMonth(expiresOn,1)}});
 assert.equal(report.retained.status,'order_registered');
 assert.equal((await game.rpc('set_speed',{speed:4})).success,true);
 assert.equal((await game.rpc('set_paused',{paused:false})).success,true);
 const deadline=Date.now()+90000;
 while(Date.now()<deadline){
  const status=await game.guard();
  const modals=await game.rpc('get_active_events'),wars=await game.rpc('get_wars');
  assert.equal(Array.isArray(modals)&&modals.length>0||!!wars.warGoalsWindow,false,'中央事件出现，中止本次组合验收并保留暂停');
  assert.equal(status.is_paused,false,'外部暂停，不能擅自恢复');
  assert.equal(await game.monitorMonthlyTrade(status),false,'条件或共享预算未知，应暂停诊断而非继续测试');
  if(game.gestalt.data.monthlyTrades.find(r=>r.requestId==='expiry-one')?.released){report.reviewStatus=status;break;}
  await delay(150);
 }
 const completed=game.gestalt.data.monthlyTrades.find(r=>r.requestId==='expiry-one');
 assert.equal(completed?.termination?.reason,'policy_complete');assert.equal(completed.termination.confirmed,true);
 assert.ok(surveyGameDay(report.reviewStatus.date.formatted)>=surveyGameDay(expiresOn));
 assert.equal((await game.rpc('set_paused',{paused:true})).success,true);
 report.after=await game.monthlySnapshot();
 assert.equal(report.after.market.monthly_trades.some(o=>o.order_id===report.expiring.orderId),false);
 assert.equal(report.after.market.monthly_trades.some(o=>o.order_id===report.retained.orderId),true);
 for(const old of initial)assert.ok(report.after.market.monthly_trades.some(o=>tuple(o)===tuple(old)),'原有手工订单必须保持');
 await game.stop();report.cleanup=game.cleanup;assert.equal(game.cleanup.pauseConfirmed,true);assert.equal(game.cleanup.monthlyTrade.confirmed,true);
 report.passed=true;
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{
 if(game&&!game.stopped)try{await game.stop();}catch(error){report.stopError=error.stack;}
 report.cleanup??=game?.cleanup;report.finishedAt=new Date().toISOString();
 await mkdir(directory,{recursive:true});await writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({report:resolve(directory,'report.json'),passed:report.passed===true,error:report.error}));
}
