// One manual restart/load covers corrected native candidates, quoted monthly
// compatibility, one legal upgrade, local waiting and final stop. No desktop API.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {NativePipe} from '../src/native-pipe.mjs';
import {ensureNativeGame} from '../src/native-bootstrap.mjs';
import {assertBridgeCapabilities} from '../src/bridge-capabilities.mjs';
import {inspectNativeProcess} from '../src/native-process.mjs';
const directory=resolve('.local/upgrade-bridge-unified-'+Date.now());await mkdir(directory,{recursive:true});
const report={startedAt:new Date().toISOString(),automaticLoads:0,desktopControlled:false,realModelCalls:0,steps:[]};
const run=async(name,args)=>{
 const chunks=[];const code=await new Promise((done,fail)=>{
  const child=spawn(process.execPath,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});
  child.on('error',fail);child.stdout.on('data',c=>chunks.push(c));child.stderr.on('data',c=>chunks.push(c));child.on('close',done);
 });
 const log=Buffer.concat(chunks).toString('utf8');await writeFile(resolve(directory,name+'.log'),log);
 const last=log.trim().split('\n').at(-1);let evidence;try{evidence=JSON.parse(last);}catch{}
 const row={name,code,passed:code===0&&evidence?.passed===true,evidence};report.steps.push(row);console.log(JSON.stringify(row));
 assert.equal(row.passed,true,name+' failed; preserve report, do not replay');
};
try{
 await ensureNativeGame({upgradePaths:true,directory});
 const fixtureIdentity=process.argv.includes('--fixture-preparation')?await inspectNativeProcess({op:'identity'}):null;
 const pipe=new NativePipe();let planetId;
 try{
  const ping=await pipe.request('ping');assertBridgeCapabilities(ping,{upgradePaths:true});report.bridge=ping;
  report.before=await pipe.request('get_status');assert.equal(report.before.is_paused,true,'用户需保持暂停');
  if(process.argv.includes('--fixture-preparation')){
   const world=await pipe.request('get_galaxy_overview'),identity=fixtureIdentity,chunks=[];
   const code=await new Promise((done,fail)=>{
    const child=spawn('C:/Program Files/Python315/python.exe',['scripts/probe-learned-upgrade-tech.py',String(identity.pid),String(world.player.country_id)],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    child.on('error',fail);child.stdout.on('data',c=>chunks.push(c));child.stderr.on('data',c=>chunks.push(c));child.on('close',done);
   });assert.equal(code,0,'只读实际科技核验失败');report.fixtureTechnology=JSON.parse(Buffer.concat(chunks).toString('utf8').trim());
   const current=await pipe.request('get_status'),again=await pipe.request('get_galaxy_overview');
   assert.equal(current.is_paused,true);assert.equal(current.date.formatted,report.before.date.formatted);assert.equal(again.player.country_id,world.player.country_id);assert.equal(again.player.capital_system_id,world.player.capital_system_id);
   assert.ok(report.fixtureTechnology.upgradeTechnology.some(t=>t.key==='tech_colonial_centralization'&&t.level>=1),'当前玩家实际已学科技中没有殖民集中；尚未发升级命令，先核对实际载入副本');
  }
  assert.deepEqual(await pipe.request('get_active_events'),[],'有中央事件，先保留现场');
  const wars=await pipe.request('get_wars');assert.equal(wars.warGoalsWindow,false);
  report.candidates=[];
  for(const sector of report.before.outliner?.sectors_summary?.sectors||[]){
   for(const colony of sector.colonies_summary||[]){
    const current=await pipe.request('get_building_upgrade_candidates',{planet_id:colony.planet_id});
    assert.equal(current.success,true,current.error||'升级候选覆盖未知');
    const automation=await pipe.request('get_colony_automation',{planet_id:colony.planet_id});
    report.candidates.push({planetId:colony.planet_id,current,automation});
    if(planetId===undefined&&automation.known===true&&automation.enabled===false&&automation.queue?.known===true&&automation.queue.items.length===0&&current.candidates.some(c=>c.can_upgrade===true&&Object.keys(c.cost||{}).length))planetId=colony.planet_id;
   }
  }
 }finally{pipe.close();}
 if(!process.argv.includes('--upgrade-only'))await run('monthly-registration-adjustment-cancellation',['scripts/accept-monthly-trade.mjs','--upgrade-paths']);
 else report.reusedMonthlyEvidence='.local/monthly-acceptance-1793412141353/report.json';
 if(planetId===undefined){report.blocker='候选读取已成功，但当前档没有队列为空且引擎允许的升级。未派单，不要求重复换档。';report.upgradeDeferred=true;}
 else await run('upgrade-and-confirmed-wait',['scripts/accept-colony-upgrades.mjs',String(planetId),...(process.argv.includes('--fixture-preparation')?['--fixture-preparation']:[])]);
 const finalPipe=new NativePipe();try{report.after=await finalPipe.request('get_status');assert.equal(report.after.is_paused,true);}finally{finalPipe.close();}
 report.passed=!report.upgradeDeferred;
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{
 report.finishedAt=new Date().toISOString();await writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({report:resolve(directory,'report.json'),passed:report.passed===true,blocker:report.blocker,error:report.error}));
}
