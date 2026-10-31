import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {NativeGame} from '../src/native-game.mjs';
import {ensureNativeGame} from '../src/native-bootstrap.mjs';
const directory=resolve('.local/colony-routine-acceptance-'+Date.now());
await mkdir(directory,{recursive:true});
const report={startedAt:new Date().toISOString(),directory,mode:'local_housing_scheduler',nativeAutomationEnabled:false,queuedWorkCancelled:false};
const stockPolicies=process.argv.includes('--stock-policies');
let game;
try{
 await ensureNativeGame({directory,upgradePaths:process.argv.includes('--upgrade-paths')?true:undefined});
 game=new NativeGame({directory,minutes:3,requirePicture:false,presentOrders:false,localWaitPilot:true,monthlyLifecyclePilot:stockPolicies});await game.start({keepPaused:true});
 if(process.argv.includes('--reclaim-survey')){
  report.surveyPreparation=[];
  for(const ship of game.lastState.civilian.science_ships||[]){
   const before=await game.rpc('get_fleet_automation',{fleet_id:ship.fleet_id});
   assert.equal(before.known,true);
   if(before.automation_enabled){
    await game.observe();const recovered=await game.surveyControl({operation:'recover',fleetId:ship.fleet_id,snapshotId:game.snapshotId});
    report.surveyPreparation.push({fleetId:ship.fleet_id,before,recovered});
    assert.equal((await game.rpc('get_fleet_automation',{fleet_id:ship.fleet_id})).automation_enabled,false);
   }
  }
 }
 const owned=(game.lastState.colonies||[]).flatMap(s=>s.colonies_summary||[]).map(p=>p.planet_id);
 const selected=process.argv.slice(2).find(a=>!a.startsWith('--'));
 const planetId=selected===undefined?owned[0]:Number(selected);assert.ok(Number.isInteger(planetId)&&owned.includes(planetId),'需要当前真实己方殖民地ID，不猜旧档编号');
 const before=await game.colonySnapshot(planetId);report.before=before;
 assert.equal(before.native.enabled,false);assert.equal(before.native.queue.items.length,0);
 const candidate=before.districts.buildable.find(c=>['district_city','district_hive','district_nexus'].includes(c.key)&&c.can_build===true);assert.ok(candidate?.can_build);
 const policy={planetId,goal:'测试档补充一档住房缓冲并验证本地托管',districtKey:candidate.key,housingTarget:before.planet.kpi.housing+1,maxBuilds:1,budget:candidate.cost,reviewDays:30};
 report.policy=policy;
 if(stockPolicies){
  const monthly=await game.monthlySnapshot();report.monthlyBefore=monthly;
  for(const resource of ['food','minerals'])assert.equal(monthly.market.monthly_trades.some(o=>o.resource===resource),false,'不覆盖既有月度订单');
  const food=monthly.status.resources.food,minerals=monthly.status.resources.minerals;
  assert.equal(food.stockpile_known,true);assert.equal(minerals.stockpile_known,true);assert.ok(food.net>0&&minerals.stockpile>candidate.cost.minerals+2);
  report.buyBoundary=await game.monthlyTrade({operation:'execute',requestId:'food-inventory-upper',snapshotId:game.snapshotId,change:{operation:'set',resource:'food',action:'buy',amount:1,priceLimit:4},policy:{maxStockpile:food.stockpile+2}});
  assert.equal(report.buyBoundary.status,'order_registered');await game.observe();
  report.sellBoundary=await game.monthlyTrade({operation:'execute',requestId:'mineral-inventory-lower',snapshotId:game.snapshotId,change:{operation:'set',resource:'minerals',action:'sell',amount:1,priceLimit:0},policy:{minStockpile:minerals.stockpile-2}});
  assert.equal(report.sellBoundary.status,'order_registered');await game.observe();
 }
 await game.colonyControl({operation:'delegate',policy,snapshotId:game.snapshotId});
 report.submission=await game.colonyControl({operation:'advance',snapshotId:game.snapshotId});
 assert.equal(report.submission.control.records[0].actions[0].status,'queued');
 if(stockPolicies){
  assert.equal(await game.monitorMonthlyTrade(await game.guard()),false);
  report.sellBoundaryAfterBuild=structuredClone(game.gestalt.data.monthlyTrades.find(r=>r.requestId==='mineral-inventory-lower'));
  assert.equal(report.sellBoundaryAfterBuild.termination?.reason,'policy_complete');assert.equal(report.sellBoundaryAfterBuild.released,true);
  assert.notEqual(game.gestalt.data.monthlyTrades.find(r=>r.requestId==='food-inventory-upper').released,true);
 }
 report.afterSubmission=await game.colonySnapshot(planetId);
 report.localQueueProof=await game.confirmedLocalWork(report.afterSubmission.status);
 assert.equal(report.localQueueProof.trusted,true,'真实自有施工队列需要满足本地等待条件');
 await game.colonyControl({operation:'advance',snapshotId:game.snapshotId});
 assert.equal(game.colonyRoutine.view().records[0].actions.length,1);
 assert.equal((await game.rpc('set_speed',{speed:4})).success,true);
 const limit=Date.now()+90000;
 while(Date.now()<limit&&game.colonyRoutine.view().records[0].status!=='completed'){
  const waiting=await game.watch(60);
  (report.waits??=[]).push({waitPolicy:waiting.waitPolicy,wakeReasons:waiting.wakeReasons});
  if(waiting.waitPolicy?.localWorkConfirmed)assert.ok(waiting.waitPolicy.effectiveSeconds>20&&waiting.waitPolicy.effectiveSeconds<=60);
  else assert.equal(game.colonyRoutine.view().records[0].status,'completed','失去施工等待资格时必须交回，不能继续普通空转');
  const status=await game.guard();
  if(game.externalPauseObserved||game.lastState.pendingEvents?.length||game.lastState.warGoalsWindow||game.lastState.paused&&game.colonyRoutine.view().records[0].status!=='completed')throw Error('运行遇到人工暂停、中央事件或需要接管的内部暂停，不自动恢复');
  if(!status.in_game)throw Error('游戏会话结束');
 }
 await game.rpc('set_paused',{paused:true});
 report.afterCompletion=await game.colonySnapshot(planetId);
 report.control=game.colonyRoutine.view();assert.equal(report.control.records[0].status,'completed');
 assert.equal(report.control.records[0].actions.length,1);
 const oldCount=before.districts.current.find(c=>c.key===policy.districtKey)?.built??candidate.built;assert.ok(Number.isInteger(oldCount),'原区划数量未知');
 assert.equal(report.afterCompletion.districts.current.find(c=>c.key===policy.districtKey)?.built,oldCount+1);
 assert.equal(report.afterCompletion.native.enabled,false);
 if(stockPolicies){
  assert.equal(await game.monitorMonthlyTrade(await game.guard()),false);
  report.buyBoundaryAfterRun=structuredClone(game.gestalt.data.monthlyTrades.find(r=>r.requestId==='food-inventory-upper'));
  assert.equal(report.buyBoundaryAfterRun.termination?.reason,'policy_complete');assert.equal(report.buyBoundaryAfterRun.released,true);
  report.monthlyAfter=await game.monthlySnapshot();assert.equal(report.monthlyAfter.market.monthly_trades.length,report.monthlyBefore.market.monthly_trades.length);
 }
 await game.observe();
 await game.colonyControl({operation:'delegate',snapshotId:game.snapshotId,policy:{...policy,goal:'验证收回后不再派发住房建设',housingTarget:Math.min(1000,report.afterCompletion.planet.kpi.housing)}});
 report.reclaimed=await game.colonyControl({operation:'reclaim',planetId,snapshotId:game.snapshotId});
 assert.equal(report.reclaimed.control.records.at(-1).status,'reclaimed');
 assert.equal(report.reclaimed.control.records.at(-1).actions.length,0);
 await game.stop();report.cleanup=game.cleanup;assert.equal(game.cleanup.pauseConfirmed,true);
 report.passed=true;
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{
 if(game&&!game.stopped)await game.stop();
 report.cleanup??=game?.cleanup;report.finishedAt=new Date().toISOString();
 await writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({report:resolve(directory,'report.json'),passed:report.passed===true,error:report.error}));
}
