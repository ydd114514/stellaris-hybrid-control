import {readFile,writeFile} from 'node:fs/promises';import {join,resolve} from 'node:path';
import {NativePipe} from '../src/native-pipe.mjs';import {inspectNativeProcess} from '../src/native-process.mjs';import {analyzeControlEvidence} from '../src/control-evidence.mjs';
const directory=resolve(process.argv[2]),native=join(directory,'native');
const checkpoint=JSON.parse(await readFile(join(native,'latest-session.json'),'utf8'));
// This retrospective collector has a specific before-state. Never reuse that
// observation to certify another run, world or an efficiency benchmark.
if(checkpoint.sessionId!=='62025b6c-20bb-4d9e-9529-ddd7b0cf48e2')throw Error('此取证脚本仅对应已记录的2026-10-30十分钟试点');
const run=JSON.parse(await readFile(join(directory,'report.json'),'utf8'));
const rows=(await readFile(join(native,`session-${checkpoint.sessionId}.jsonl`),'utf8')).trim().split('\n').map(JSON.parse);
const baseline=JSON.parse(await readFile('.local/hybrid-control/civilian-stance-1793322050362/result.json','utf8')).after;
const moves=rows.filter(x=>x.type==='intent').flatMap(x=>x.orders||[]).filter(x=>x.command==='move_fleet').map(x=>x.arguments.system_id);
const identity=await inspectNativeProcess({op:'identity'});
if(identity.pid!==checkpoint.binding.pid||identity.creationTime!==checkpoint.binding.creationTime)throw Error('游戏进程绑定已改变');
const pipe=new NativePipe(),proof={sessionId:checkpoint.sessionId,directory,identity,worldLineageVerified:false,model:{requests:run.model.forwardedRequests,completed:run.model.completed,failed:run.model.failed,usage:run.model.usage},elapsedMs:run.ended-run.started,stopReason:run.stopReason,controlEvidence:analyzeControlEvidence(rows),manualMovementTargets:moves,baseline,systems:[]};
try{
 proof.status=await pipe.request('get_status');proof.world=await pipe.request('get_galaxy_overview');
 if(proof.status.is_paused!==true||proof.world.player.country_id!==0||proof.world.player.capital_system_id!==1)throw Error('当前测试世界或暂停状态不符');
 for(const system_id of new Set([baseline.id,...moves]))proof.systems.push(await pipe.request('get_system',{system_id}));
 proof.automation=await pipe.request('get_fleet_automation',{fleet_id:1});
 const target=proof.systems.find(x=>x.id===baseline.id);
 proof.completedBaselineSystem=baseline.surveyed===false&&target?.surveyed===true;
 proof.passed=proof.stopReason==='pilot_deadline'&&proof.elapsedMs>=600000&&proof.completedBaselineSystem&&proof.automation.known===true&&proof.automation.automation_enabled===false&&checkpoint.stopped===true;
 proof.limitations=['Ten-minute single-controller technical acceptance only; no matched-save efficiency comparison, long-run acceptance, spending automation or installed-app delivery.','Pause/runtime sampling and model usage are separate evidence; do not sum started audit rows as additional requests.'];
}finally{pipe.close();await writeFile(join(directory,'outcome-proof.json'),JSON.stringify(proof,null,2));}
console.log(JSON.stringify({directory,passed:proof.passed,date:proof.status?.date?.formatted,paused:proof.status?.is_paused,elapsedMs:proof.elapsedMs,model:proof.model,completedBaselineSystem:proof.completedBaselineSystem,systems:proof.systems.map(s=>({id:s.id,name:s.name,surveyed:s.surveyed,knownBodies:s.planets?.length,surveyedBodies:s.planets?.filter(x=>x.surveyed).length})),automationOff:proof.automation?.automation_enabled===false,controlEvidence:proof.controlEvidence},null,2));
