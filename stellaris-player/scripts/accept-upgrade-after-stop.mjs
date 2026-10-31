// Follow the exact already-submitted upgrade after a verified stop. No takeover
// of the old delegation, no new construction, no save loading or resource edits.
import assert from 'node:assert/strict';import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';import {NativeGame} from '../src/native-game.mjs';
import {ensureNativeGame} from '../src/native-bootstrap.mjs';import {verifyBuildingUpgrade,captureUpgradeBaseline,captureUpgradeQueueWitness} from '../src/building-upgrades.mjs';
const source=process.argv[2];assert.ok(source,'需要原升级实测报告');
const original=JSON.parse(await readFile(source,'utf8'));
const old=original.cleanup?.colonyUpgrades?.records?.find(r=>r.status==='stopped');
assert.ok(old&&original.cleanup.pauseConfirmed&&original.cleanup.bindingConfirmed);
const action=old.actions.find(a=>a.status==='queued');assert.ok(action);
const baseline=captureUpgradeBaseline(original.before.planet,action.arguments,original.before.native);
const queueWitness=captureUpgradeQueueWitness(baseline,action.arguments,original.afterSubmission.planet,original.afterSubmission.native);
assert.ok(baseline&&queueWitness,'需要原提交前完整基线及实际唯一队列见证');
const directory=resolve('.local/upgrade-after-stop-'+Date.now());await mkdir(directory,{recursive:true});
const report={startedAt:new Date().toISOString(),source,scope:'observe_exact_original_upgrade_after_explicit_stop',artificialTechnologyFixture:true,newConstructionOrders:0,oldDelegationResumed:false,decisions:[]};let game;
async function reviewResearch(){
 await game.observe();
 assert.equal(game.lastState.pendingEvents.length,0);assert.equal(!!game.lastState.warGoalsWindow,false);
 for(const slot of ['physics','society','engineering']){
  const state=game.lastState.research[slot];if(state.current?.is_researching)continue;
  const selected=[...(state.candidates||[])].filter(c=>Number.isFinite(c.cost)).sort((a,b)=>b.cost-a.cost)[0];assert.ok(selected,'当前科研候选未知');
  const result=await game.apply({requestId:'research-'+slot+'-'+report.decisions.length,snapshotId:game.snapshotId,orders:[{command:'select_research',arguments:{slot,tech_key:selected.key}}],explanation:'验收副本中的正常战略选择：继续当前可用的较长科研，保留已排升级施工'});
  assert.ok(['posted','already_researching'].includes(result.orders[0].status));report.decisions.push({slot,selected,result});await game.observe();
 }
}
try{
 await ensureNativeGame({directory});game=new NativeGame({directory,minutes:2,requirePicture:false,presentOrders:false});await game.start({keepPaused:true});
 report.before=await game.colonySnapshot(old.planetId,{upgrades:true});
 assert.equal(report.before.native.colony_id,old.colonyId);assert.equal(report.before.native.enabled,false);
 const inspect=async()=>{const current=await game.colonySnapshot(old.planetId,{upgrades:true});const proof=verifyBuildingUpgrade(current.planet,action.arguments,{},{baseline,queueWitness,native:current.native});return {current,proof};};
 let observation=await inspect();
 if(!observation.proof.completed){
  assert.ok(observation.current.native.queue.items.some(q=>q.item_id===action.queueItemId),'原升级队列已消失且未证实完成，禁止重发');
  await reviewResearch();assert.equal((await game.rpc('set_speed',{speed:4})).success,true);
  const end=Date.now()+60000;
  while(Date.now()<end&&!observation.proof.completed){
   const result=await game.watch(2);
   if(game.externalPauseObserved||game.lastState.pendingEvents.length||game.lastState.warGoalsWindow)throw Error('中央事件或外部暂停，保留现场');
   observation=await inspect();
   if(observation.proof.completed)break;
   if(game.lastState.paused){
    const reasons=game.decisionPause?.reasons||result.wakeReasons||[];
    const allowed=new Set(['alert_physics_research','alert_society_research','alert_engineering_research']);
    const alerts=game.lastState.alerts||[];
    if(reasons.length!==1||reasons[0]!=='new_alert'||alerts.some(a=>!allowed.has(a.type)))throw Error('新接管原因需要进一步战略决定，不自动恢复');
    await reviewResearch();
   }
  }
 }
 assert.equal(observation.proof.completed,true,'原升级尚未完成');
 await game.rpc('set_paused',{paused:true});report.after=await game.colonySnapshot(old.planetId,{upgrades:true});
 report.proof=verifyBuildingUpgrade(report.after.planet,action.arguments,{},{baseline,queueWitness,native:report.after.native});assert.equal(report.proof.completed,true);report.baseline=baseline;report.queueWitness=queueWitness;
 assert.equal(report.after.native.queue.items.length,0);assert.equal(report.after.native.enabled,false);
 await game.stop();report.cleanup=game.cleanup;assert.equal(report.cleanup.pauseConfirmed,true);
 report.passed=true;
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{if(game&&!game.stopped)await game.stop();report.cleanup??=game?.cleanup;report.finishedAt=new Date().toISOString();await writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({report:resolve(directory,'report.json'),passed:report.passed===true,error:report.error}));}
