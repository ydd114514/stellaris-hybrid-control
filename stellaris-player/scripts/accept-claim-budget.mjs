// A single paused one-claim acceptance. No model, console, resource edits or time advance.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {NativeGame} from '../src/native-game.mjs';
import {ensureNativeGame} from '../src/native-bootstrap.mjs';
import {CLAIM_BUDGET_BRIDGE_VERSION} from '../src/bridge-capabilities.mjs';
const directory=resolve('.local/claim-budget-acceptance-'+Date.now());await mkdir(directory,{recursive:true});
const report={startedAt:new Date().toISOString(),maximumClaims:1,modelCalls:0,gameTimeAdvanced:false,manualLoads:0};
const game=new NativeGame({directory,minutes:2,requirePicture:false,presentOrders:false});
try{
 if(process.argv.includes('--load-candidate'))await ensureNativeGame({directory,claimBudget:true});
 await game.start({keepPaused:true});assert.equal(game.bridgeCapabilities.bridge_version,CLAIM_BUDGET_BRIDGE_VERSION);
 const before=await game.rpc('get_status');assert.equal(before.is_paused,true);report.before={date:before.date.formatted,influence:before.resources.influence};
 const targets=await game.inspect({topic:'targets'});let selected;
 for(const candidate of targets.candidates.filter(c=>c.systemOnlyConfirmed===true)){
  const q=await game.inspect({topic:'claim_quote',id:candidate.system_id});
  if(q.success===true&&q.legal===true&&q.player_claims===0&&q.cost?.influence>0&&q.cost.influence<=before.resources.influence.stockpile){selected={candidate,quote:q};break;}
 }
 assert.ok(selected,'没有已确认且有预算的新宣称目标；不制造或替换目标');report.selected=selected;
 const {system_id:systemId}=selected.candidate,q=selected.quote;
 // Native upper bound must reject before posting even though the normal claim is legal.
 report.capRejection=await game.rpc('claim_system',{system_id:systemId,max_influence_cost_fixed:q.influence_cost_fixed-1});
 assert.equal(report.capRejection.success,false);
 const still=await game.rpc('get_system',{system_id:systemId}),unchanged=await game.rpc('get_status');assert.equal(still.player_claims,0);assert.equal(unchanged.resources.influence.stockpile,before.resources.influence.stockpile);
 // Controller shared floors must also reject without sending a claim.
 game.gestalt.data.campaign={phase:'prepare',execution:{resourceFloors:{influence:before.resources.influence.stockpile}}};
 await game.observe();report.floorRejection=await game.apply({requestId:'claim-protected-floor',snapshotId:game.snapshotId,orders:[{command:'claim_system',arguments:{system_id:systemId}}]});assert.equal(report.floorRejection.orders[0].status,'deferred');assert.equal(report.floorRejection.orders[0].nativeWriteAttempted,false);
 delete game.gestalt.data.campaign;await game.gestalt.save();await game.observe();
 // A low priority explicit task must run instead of a harmless, higher-priority decoy.
 const decoy=await game.gestalt.add({goal:'保持待执行，不改变速度',orders:[{command:'set_speed',arguments:{speed:before.speed}}],priority:100},game.lastState);
 const task=await game.gestalt.add({goal:'验证一次有真实影响力预算的边境宣称',orders:[{command:'claim_system',arguments:{system_id:systemId}}],budget:q.cost,priority:1},game.lastState);
 report.result=await game.task({operation:'run',id:task.id});assert.equal(report.result.orders[0].command,'claim_system');assert.equal(report.result.orders[0].status,'posted');assert.equal(report.result.orders[0].verification.verified,true);
 assert.equal(game.gestalt.data.tasks.find(t=>t.id===decoy.id).status,'ready');await game.gestalt.cancel(decoy.id);
 const after=await game.rpc('get_status'),system=await game.rpc('get_system',{system_id:systemId});
 report.after={date:after.date.formatted,influence:after.resources.influence,claims:system.player_claims};assert.equal(after.is_paused,true);assert.equal(after.date.formatted,before.date.formatted);assert.equal(system.player_claims,1);
 report.influenceSpent=before.resources.influence.stockpile-after.resources.influence.stockpile;assert.ok(Math.abs(report.influenceSpent-q.cost.influence)<=0.03);
 report.admission=game.gestalt.data.actions.find(a=>a.taskId===task.id)?.spendingAdmission;assert.equal(report.admission.cost.influence,q.cost.influence);
 await game.stop();assert.equal(game.cleanup.pauseConfirmed,true);assert.equal(game.cleanup.bindingConfirmed,true);report.passed=true;
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{if(!game.stopped)try{await game.stop();}catch(error){report.stopError=error.stack;}report.cleanup=game.cleanup;report.finishedAt=new Date().toISOString();await writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({report:resolve(directory,'report.json'),passed:report.passed===true,error:report.error}));}
