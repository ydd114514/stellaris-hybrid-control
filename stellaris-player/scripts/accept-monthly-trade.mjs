// One combined, bounded native acceptance. No GUI automation or automatic save
// loading; run only after the user has loaded a disposable, paused single-player save.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {ensureNativeGame} from '../src/native-bootstrap.mjs';
import {NativeGame} from '../src/native-game.mjs';
const directory=resolve('.local/monthly-acceptance-'+Date.now());
await mkdir(directory,{recursive:true});
const report={startedAt:new Date().toISOString(),directory,steps:[],settlementConfirmed:false};
const action=process.argv.includes('--sell')?'sell':'buy';report.action=action;
let game;
try{
 await ensureNativeGame({monthlyTrade:true,directory,upgradePaths:process.argv.includes('--upgrade-paths')?true:undefined});
 game=new NativeGame({directory,minutes:5,requirePicture:false,presentOrders:false});
 await game.start({keepPaused:true});
 const first=await game.monthlySnapshot();
 assert.equal(first.market.monthly_trades_complete,true,'monthly coverage unknown');
 const resource=['food','minerals','consumer_goods'].find(key=>first.market.resources?.some(r=>r.key===key)&&!first.market.monthly_trades.some(o=>o.resource===key&&o.action===action));
 assert.ok(resource,'need one tradeable resource without existing buy orders');
 const units=first.market.resources.find(r=>r.key===resource).batch_size;
 const quote=await game.rpc('get_market_quote',{resource,action,units});
 report.quote=quote;
 assert.equal(quote.success,true);assert.equal(quote.price_basis,'engine_transaction_total');
 const priceLimit=action==='sell'?0:Math.max(1,Math.ceil(quote.total/units*2)+1);
 const change={operation:'set',resource,action,amount:1,priceLimit};
 const execute=async(requestId,c)=>{
  await game.observe();const result=await game.monthlyTrade({operation:'execute',requestId,snapshotId:game.snapshotId,change:c});
  report.steps.push({requestId,change:c,result});console.log(JSON.stringify({requestId,status:result.status,orderId:result.orderId}));return result;
 };
 const set=await execute('accept-set',change);assert.equal(set.status,'order_registered');
 const repeat=await game.monthlyTrade({operation:'execute',requestId:'accept-set',snapshotId:game.snapshotId,change});assert.equal(repeat.orderId,set.orderId);
 const adjusted=await execute('accept-adjust',{...change,operation:'replace',orderId:set.orderId,amount:2});assert.equal(adjusted.status,'order_replaced');
 if(process.argv.includes('--advance-month')){
  const initial=(await game.rpc('get_status')).date.formatted;
  report.monthBefore=await game.monthlySnapshot();
  await game.rpc('set_speed',{speed:4});await game.rpc('set_paused',{paused:false});
  const until=Date.now()+90000;let date=initial;
  while(Date.now()<until&&date.slice(0,7)===initial.slice(0,7)){await delay(500);const status=await game.guard();date=status.date.formatted;if(status.is_paused===true)throw Error('月结运行被暂停，保留实际结果，不自动关闭事件');}
  await game.rpc('set_paused',{paused:true});report.monthAfter=await game.monthlySnapshot();
  assert.notEqual(report.monthAfter.scope.gameDate.slice(0,7),initial.slice(0,7),'month crossing not observed');
  report.monthBoundaryObserved=true;
  // These are observations, not proof that inventory deltas equal this order's
  // settlement: production, fees and maintenance may affect the same balances.
 }
 const cancel=await execute('accept-cancel',{operation:'cancel',orderId:adjusted.orderId});assert.equal(cancel.status,'order_removed');
 const again=await execute('accept-stop-owned',change);assert.equal(again.status,'order_registered');
 await game.stop();report.cleanup=game.cleanup;assert.equal(game.cleanup.pauseConfirmed,true);assert.equal(game.cleanup.monthlyTrade.confirmed,true);
 report.registrationAdjustmentCancellationPassed=true;
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{
 if(game&&!game.stopped)await game.stop();
 report.cleanup??=game?.cleanup;report.finishedAt=new Date().toISOString();
 await writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({report:resolve(directory,'report.json'),passed:report.registrationAdjustmentCancellationPassed===true,error:report.error}));
}
