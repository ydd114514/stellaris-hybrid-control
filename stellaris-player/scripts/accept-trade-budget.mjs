// One paused native transaction, no model, reload, time advance or resource edits.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {NativeGame} from '../src/native-game.mjs';
import {checkQuotedTrade} from '../src/trade-spending-policy.mjs';
import {ensureNativeGame} from '../src/native-bootstrap.mjs';
const directory=resolve('.local/trade-budget-acceptance-'+Date.now());
await mkdir(directory,{recursive:true});
const report={startedAt:new Date().toISOString(),manualLoads:0,modelCalls:0,gameTimeAdvanced:false,maximumTransactions:1};
const game=new NativeGame({directory,minutes:2,requirePicture:false,presentOrders:false});
try{
 if(process.argv.includes('--load-candidate'))await ensureNativeGame({directory,tradeBudget:true});
 await game.start({keepPaused:true});
 report.before=await game.rpc('get_status');assert.equal(report.before.is_paused,true);
 const market=await game.rpc('get_market');
 // Pick one existing surplus only. Never fabricate inventory or clear orders.
 let selected;
 for(const key of ['food','minerals','consumer_goods']){
  const row=report.before.resources?.[key],entry=market.resources?.find(r=>r.key===key);
  if(!row||!Number.isSafeInteger(entry?.batch_size)||entry.batch_size<=0||entry.batch_size>100||!(row.net>0))continue;
  const params={resource:key,action:'sell',units:entry.batch_size};
  const quote=await game.rpc('get_market_quote',params);
  try{
   const evidence=checkQuotedTrade({params,market,quote,status:report.before,...game.delegationBudgetOptions()});
   const legacyFloor=Math.max(500,row.max*.2,Math.max(0,-row.net)*12);
   const candidate={params,quote,evidence,legacyFloor,crossesLegacyFloor:row.stockpile-params.units<legacyFloor};
   if(!selected||candidate.crossesLegacyFloor)selected=candidate;
   if(candidate.crossesLegacyFloor)break;
  }catch{/* No safe candidate means no mutation. */}
 }
 assert.ok(selected,'当前没有安全的单批盈余候选，不修改资源制造测试条件');report.selected=selected;
 await game.observe();
 report.result=await game.apply({requestId:'accept-actual-upkeep-sale',snapshotId:game.snapshotId,orders:[{command:'market_trade',arguments:selected.params}]});
 assert.equal(report.result.orders[0].status,'posted');assert.equal(report.result.orders[0].verification.verified,true);
 report.after=await game.rpc('get_status');assert.equal(report.after.date.formatted,report.before.date.formatted);assert.equal(report.after.is_paused,true);
 const action=game.gestalt.data.actions.find(a=>a.spendingAdmission?.basis==='engine_quote_and_actual_upkeep');
 assert.ok(action);report.admission=action.spendingAdmission;
 await game.stop();report.cleanup=game.cleanup;assert.equal(report.cleanup.pauseConfirmed,true);assert.equal(report.cleanup.bindingConfirmed,true);
 report.passed=true;
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{
 if(!game.stopped)try{await game.stop();}catch(error){report.stopError=error.stack;}
 report.cleanup??=game.cleanup;report.finishedAt=new Date().toISOString();
 await writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({report:resolve(directory,'report.json'),passed:report.passed===true,error:report.error,crossesLegacyFloor:report.selected?.crossesLegacyFloor}));
}
