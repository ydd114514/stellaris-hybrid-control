// Prepared only. Do not run until the user resumes the unified acceptance.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';import {resolve} from 'node:path';
import {NativeGame} from '../src/native-game.mjs';import {ensureNativeGame} from '../src/native-bootstrap.mjs';
const directory=resolve('.local/colony-upgrades-acceptance-'+Date.now());await mkdir(directory,{recursive:true});
const report={startedAt:new Date().toISOString(),validationScope:'one_explicitly_selected_legal_upgrade',desktopControlled:false};let game;
try{
 await ensureNativeGame({directory,upgradePaths:true});game=new NativeGame({directory,minutes:5,requirePicture:false,presentOrders:false,colonyUpgradePilot:true,localWaitPilot:true});await game.start({keepPaused:true});
 if(process.argv.includes('--fixture-preparation')){
  report.fixturePreparation={artificialTechnologyFixture:true,survey:[],research:[]};
  for(const ship of game.lastState.civilian.science_ships||[]){
   const current=await game.rpc('get_fleet_automation',{fleet_id:ship.fleet_id});assert.equal(current.known,true);
   if(current.automation_enabled){await game.observe();report.fixturePreparation.survey.push(await game.surveyControl({operation:'recover',fleetId:ship.fleet_id,snapshotId:game.snapshotId}));}
  }
  await game.observe();
  for(const slot of ['physics','society','engineering']){
   const current=game.lastState.research[slot];
   if(current?.current?.is_researching){report.fixturePreparation.research.push({slot,preservedCurrent:current.current});continue;}
   const candidate=[...(current?.candidates||[])].filter(c=>Number.isFinite(c.cost)).sort((a,b)=>b.cost-a.cost)[0];
   assert.ok(candidate,'需要当前合法科研候选以安排测试期间的科研');
   const result=await game.apply({requestId:'fixture-research-'+slot,snapshotId:game.snapshotId,orders:[{command:'select_research',arguments:{slot,tech_key:candidate.key}}],explanation:'独立升级验收副本：选择当前合法的较长科研，减少短施工期间的科研完成警报'});
   assert.equal(result.orders[0].status,'posted');report.fixturePreparation.research.push({slot,selected:candidate,result});await game.observe();
  }
 }
 const owned=(game.lastState.colonies||[]).flatMap(s=>s.colonies_summary||[]).map(p=>p.planet_id);
 const selected=process.argv.slice(2).find(a=>!a.startsWith('--'));
 const planetId=selected===undefined?owned[0]:Number(selected);assert.ok(Number.isInteger(planetId)&&owned.includes(planetId),'需要当前真实己方殖民地ID，不沿用旧档编号');
 const before=await game.colonySnapshot(planetId,{upgrades:true});report.before=before;
 assert.equal(before.native.enabled,false);assert.equal(before.native.queue.items.length,0);
 assert.equal(before.upgrades.success,true,before.upgrades.error||'升级候选读取失败，保持暂停');
 assert.ok(Array.isArray(before.upgrades.candidates),'升级候选覆盖未知，保持暂停');
 const candidate=before.upgrades.candidates.filter(c=>c.can_upgrade&&Object.keys(c.cost||{}).length).sort((a,b)=>(a.build_days??Infinity)-(b.build_days??Infinity))[0];
 assert.ok(candidate,'No legal upgrade available; keep paused and record this prerequisite instead of guessing a target');
 const policy={planetId,goal:'验收单星球已批准升级的预算、队列与完工',allowedUpgradeKeys:[candidate.upgrade_key],maxBuilds:1,budget:candidate.cost,reviewDays:30};report.policy=policy;
 await game.colonyUpgradeControl({operation:'delegate',snapshotId:game.snapshotId,policy});
 await game.colonyUpgradeControl({operation:'pause',planetId,snapshotId:game.snapshotId});await game.colonyUpgradeControl({operation:'advance',snapshotId:game.snapshotId});assert.equal(game.colonyUpgradeRoutine.view().records[0].actions.length,0);
 await game.colonyUpgradeControl({operation:'resume',planetId,snapshotId:game.snapshotId});report.submission=await game.colonyUpgradeControl({operation:'advance',snapshotId:game.snapshotId});
 assert.ok(['queued','completed'].includes(report.submission.control.records[0].actions[0].status));
 report.afterSubmission=await game.colonySnapshot(planetId,{upgrades:true});
 const queued=game.colonyUpgradeRoutine.view().records[0].actions[0].status==='queued';
 if(queued){report.localQueueProof=await game.confirmedLocalWork(report.afterSubmission.status);assert.equal(report.localQueueProof.trusted,true);}
 assert.equal((await game.rpc('set_speed',{speed:4})).success,true);
 const until=Date.now()+120000;
 while(Date.now()<until&&game.colonyUpgradeRoutine.view().records[0].status!=='completed'){
  const result=await game.watch(60);(report.waits??=[]).push({policy:result.waitPolicy,wakeReasons:result.wakeReasons});
  if(result.waitPolicy?.localWorkConfirmed)assert.equal(result.waitPolicy.effectiveSeconds,60);
  if(game.externalPauseObserved||game.lastState.pendingEvents?.length||game.lastState.warGoalsWindow||game.lastState.paused)throw Error('Central event, safety handback or external pause interrupted acceptance; no automatic dismissal or resume');
 }
 await game.rpc('set_paused',{paused:true});report.after=await game.colonySnapshot(planetId,{upgrades:true});report.control=game.colonyUpgradeRoutine.view();assert.equal(report.control.records[0].status,'completed');assert.equal(report.control.records[0].actions.length,1);
 await game.stop();report.cleanup=game.cleanup;assert.equal(report.cleanup.pauseConfirmed,true);report.passed=true;
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{if(game&&!game.stopped)await game.stop();report.cleanup??=game?.cleanup;report.finishedAt=new Date().toISOString();await writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({report:resolve(directory,'report.json'),passed:report.passed===true,error:report.error}));}
