import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {NativeGame} from '../src/native-game.mjs';
import {ensureNativeGame} from '../src/native-bootstrap.mjs';
import {MONTHLY_QUOTE_BRIDGE} from '../src/monthly-trade-execution.mjs';
const directory=resolve('.local/monthly-boundaries-'+Date.now());await mkdir(directory,{recursive:true});
const report={startedAt:new Date().toISOString(),steps:[],resourceMemoryWrites:0,desktopControlled:false,forcedBankruptcy:false};let game;
try{
 await ensureNativeGame({directory,monthlyQuotes:true});game=new NativeGame({directory,minutes:5,requirePicture:false,presentOrders:false});await game.start({keepPaused:true});
 const ping=await game.rpc('ping');assert.equal(ping.bridge_version,MONTHLY_QUOTE_BRIDGE);assert.ok(ping.features.includes('engine_monthly_trade_quotes'));report.bridge=ping;
 const initial=await game.monthlySnapshot();report.initial=initial;
 const buyResource=initial.market.resources.find(r=>r.key==='food')?'food':'consumer_goods',sellResource='minerals';
 const quote=async(resource,action)=>{const q=await game.rpc('get_monthly_trade_quote',{resource,action,units:1});assert.equal(q.success,true);assert.equal(q.settlement_rounding,'ceil_to_whole_currency');assert.equal(q.includes_fee,true);assert.equal(q.units,1);return q;};
 report.buyQuote=await quote(buyResource,'buy');report.sellQuote=await quote(sellResource,'sell');assert.ok(report.buyQuote.total>1,'need positive conditional buy limit below the current rounded quote');
 const invalid=await game.rpc('set_monthly_trade',{resource:sellResource,action:'sell',amount:50000,price_limit:50000,cancel:false});
 assert.equal(invalid.success,false);assert.match(invalid.message??invalid.error,/int32/);report.productOverflowRejected=invalid;
 const initialIds=initial.market.monthly_trades.map(o=>o.order_id);assert.deepEqual((await game.monthlySnapshot()).market.monthly_trades.map(o=>o.order_id),initialIds);
 await assert.rejects(game.monthlyTrade({operation:'execute',requestId:'insufficient-stock',snapshotId:game.snapshotId,change:{operation:'set',resource:sellResource,action:'sell',amount:Math.floor(initial.status.resources[sellResource].stockpile)+1,priceLimit:0}}),/支出不足/);
 await assert.rejects(game.monthlyTrade({operation:'execute',requestId:'insufficient-cash',snapshotId:game.snapshotId,change:{operation:'set',resource:buyResource,action:'buy',amount:1,priceLimit:Math.floor(initial.status.resources.trade.stockpile)+1}}),/支出不足/);
 report.adapterShortagesRejected=true;
 const execute=async(requestId,change)=>{
  await game.observe();const r=await game.monthlyTrade({operation:'execute',requestId,snapshotId:game.snapshotId,change});report.steps.push({requestId,change,result:r});return r;
 };
 const crossMonth=async()=>{
  const before=await game.monthlySnapshot(),month=before.scope.gameDate.slice(0,7),until=Date.now()+90000;
  await game.rpc('set_speed',{speed:4});await game.rpc('set_paused',{paused:false});let date=before.scope.gameDate;
  while(Date.now()<until&&date.slice(0,7)===month){await delay(100);const s=await game.guard();date=s.date.formatted;if(s.is_paused===true)throw Error('月结试验遇到人工/事件暂停，不自动恢复');}
  await game.rpc('set_paused',{paused:true});const after=await game.monthlySnapshot();assert.notEqual(after.scope.gameDate.slice(0,7),month,'month not crossed');return {before,after};
 };
 const blockedBuy=await execute('blocked-buy',{operation:'set',resource:buyResource,action:'buy',amount:1,priceLimit:1});assert.equal(blockedBuy.status,'order_registered');assert.equal(blockedBuy.quote.priceConditionMet,false);
 const blockedSell=await execute('blocked-sell',{operation:'set',resource:sellResource,action:'sell',amount:1,priceLimit:2147483647});assert.equal(blockedSell.status,'order_registered');assert.equal(blockedSell.quote.priceConditionMet,false);
 report.blockedMonth=await crossMonth();
 await execute('remove-blocked-buy',{operation:'cancel',orderId:blockedBuy.orderId});await execute('remove-blocked-sell',{operation:'cancel',orderId:blockedSell.orderId});
 report.activeBuyQuote=await quote(buyResource,'buy');report.activeSellQuote=await quote(sellResource,'sell');
 const activeBuy=await execute('active-buy',{operation:'set',resource:buyResource,action:'buy',amount:1,priceLimit:report.activeBuyQuote.total*2+1});assert.equal(activeBuy.status,'order_registered');assert.equal(activeBuy.quote.priceConditionMet,true);
 const activeSell=await execute('active-sell',{operation:'set',resource:sellResource,action:'sell',amount:1,priceLimit:0});assert.equal(activeSell.status,'order_registered');assert.equal(activeSell.quote.priceConditionMet,true);
 report.activeMonth=await crossMonth();
 await execute('remove-active-buy',{operation:'cancel',orderId:activeBuy.orderId});await execute('remove-active-sell',{operation:'cancel',orderId:activeSell.orderId});
 const f=(s,resource,key)=>s.status.resources[resource][key];
 report.flowEvidence={blockedBuyIncomeDelta:f(report.blockedMonth.after,buyResource,'income')-f(report.blockedMonth.before,buyResource,'income'),blockedSellExpenseDelta:f(report.blockedMonth.after,sellResource,'expense')-f(report.blockedMonth.before,sellResource,'expense'),activeBuyIncomeDelta:f(report.activeMonth.after,buyResource,'income')-f(report.activeMonth.before,buyResource,'income'),activeSellExpenseDelta:f(report.activeMonth.after,sellResource,'expense')-f(report.activeMonth.before,sellResource,'expense'),note:'Resource income/expense deltas are corroborating observations; no independent per-order settlement ledger is available.'};
 assert.ok(Math.abs(report.flowEvidence.blockedBuyIncomeDelta)<0.02,'blocked buy flow changed; check concurrent economy changes');
 assert.ok(Math.abs(report.flowEvidence.blockedSellExpenseDelta)<0.02,'blocked sale flow changed; check concurrent economy changes');
 assert.ok(Math.abs(report.flowEvidence.activeBuyIncomeDelta-1)<0.02,'active buy not isolated in resource income');
 assert.ok(Math.abs(report.flowEvidence.activeSellExpenseDelta-1)<0.02,'active sale not isolated in resource expense');
 const planetId=3,current=await game.colonySnapshot(planetId),candidate=current.districts.buildable.find(d=>d.key==='district_city');assert.ok(candidate);
 await game.observe();await game.colonyControl({operation:'delegate',snapshotId:game.snapshotId,policy:{planetId,goal:'核对暂停恢复保持授权预算，不派发额外建设',districtKey:'district_city',housingTarget:Math.min(1000,current.planet.kpi.housing),maxBuilds:2,budget:candidate.cost,reviewDays:30}});
 await game.colonyControl({operation:'pause',planetId,snapshotId:game.snapshotId});assert.equal(game.colonyRoutine.view().records.at(-1).status,'paused');
 await game.colonyControl({operation:'advance',snapshotId:game.snapshotId});assert.equal(game.colonyRoutine.view().records.at(-1).actions.length,0);
 await game.colonyControl({operation:'resume',planetId,snapshotId:game.snapshotId});assert.deepEqual(game.colonyRoutine.view().records.at(-1).remainingBudget,candidate.cost);
 await game.colonyControl({operation:'pause',planetId,snapshotId:game.snapshotId});await game.stop();report.cleanup=game.cleanup;
 assert.equal(game.cleanup.colonyControl.records.at(-1).status,'stopped');assert.equal(game.cleanup.monthlyTrade.confirmed,true);assert.equal(game.cleanup.pauseConfirmed,true);report.passed=true;
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{if(game&&!game.stopped)await game.stop();report.cleanup??=game?.cleanup;report.finishedAt=new Date().toISOString();await writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({report:resolve(directory,'report.json'),passed:report.passed===true,error:report.error}));}
