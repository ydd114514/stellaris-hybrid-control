import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {NativeGame} from '../src/native-game.mjs';
import {ensureNativeGame} from '../src/native-bootstrap.mjs';
const directory=resolve('.local/monthly-risk-acceptance-'+Date.now());await mkdir(directory,{recursive:true});
const report={startedAt:new Date().toISOString(),resourceMemoryWrites:0,forcedBankruptcy:false,gameTimeAdvanced:false,modelRequests:0};let game;
try{
 await ensureNativeGame({directory});game=new NativeGame({directory,minutes:2,requirePicture:false,presentOrders:false});await game.start({keepPaused:true});
 const before=await game.monthlySnapshot();report.before=before;
 const change={operation:'set',resource:'food',action:'buy',amount:1,priceLimit:4};
 report.set=await game.monthlyTrade({operation:'execute',requestId:'risk-owned',snapshotId:game.snapshotId,change});assert.equal(report.set.status,'order_registered');
 report.freeAction=await game.apply({requestId:'free-action-with-reserves',snapshotId:game.snapshotId,orders:[{command:'set_speed',arguments:{speed:4}}]});assert.equal(report.freeAction.orders[0].status,'posted');
 const policy=game.delegationBudgetOptions.bind(game);
 report.testPolicy={floorResource:'trade',floor:before.status.resources.trade.stockpile+1,reason:'Controller-only reserve threshold to exercise the real pause/cancel path without changing resources or advancing time'};
 game.delegationBudgetOptions=()=>({...policy(),floors:{trade:report.testPolicy.floor}});
 report.handback=await game.watch(0);assert.deepEqual(report.handback.wakeReasons,['monthly_trade_resource_risk']);
 game.delegationBudgetOptions=policy;
 report.after=await game.monthlySnapshot();assert.equal(report.after.status.is_paused,true);assert.equal(report.after.market.monthly_trades.some(o=>o.order_id===report.set.orderId),false);assert.equal(report.after.scope.gameDate,before.scope.gameDate);
 assert.equal(report.after.status.resources.trade.stockpile,before.status.resources.trade.stockpile);assert.equal(report.after.status.resources.food.stockpile,before.status.resources.food.stockpile);
 await game.stop();report.cleanup=game.cleanup;assert.equal(game.cleanup.pauseConfirmed,true);report.passed=true;
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{if(game&&!game.stopped)await game.stop();report.cleanup??=game?.cleanup;report.finishedAt=new Date().toISOString();await writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({report:resolve(directory,'report.json'),passed:report.passed===true,error:report.error}));}
