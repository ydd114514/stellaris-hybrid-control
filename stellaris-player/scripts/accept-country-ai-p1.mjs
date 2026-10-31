// Unified, bounded P1 pilot. No presentation calls, desktop control or routine selection.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {NativeGame} from '../src/native-game.mjs';
import {NativePipe} from '../src/native-pipe.mjs';
import {assertBridgeCapabilities} from '../src/bridge-capabilities.mjs';
import {rpcEvidenceCategory} from '../src/control-evidence.mjs';
import {confirmedCountryAIHandoff} from '../src/country-ai-handoff.mjs';

const directory=resolve('.local/country-ai-p1-acceptance-'+Date.now());
await mkdir(directory,{recursive:true});
const report={startedAt:new Date().toISOString(),passed:false,coreGoalComplete:false,
 scope:'bounded_research_and_planet_construction_country_ai_pilot',windows:[],writes:[],
 strategicIntent:'接管协议试验：优先推进航道与能源科技，其次选择当前合法的较低成本科技；候选顺序在托管前固定。此项不证明模型战略质量。',
 limitations:['两个日常领域的试点不等于全领域帝国经营交付。','失去心跳验收不等于进程强杀、读档或所有崩溃路径验收。']};
if(!process.argv.includes('--execute-native-pilot')){
 const probe=new NativePipe();
 try{
  report.ping=await probe.request('ping');assertBridgeCapabilities(report.ping,{nativeCountryAI:true});
  report.preflight=await probe.request('get_country_ai_state');
  report.research=await probe.request('get_research_state');
  report.readOnlyPreflight=true;
 }catch(error){report.error=error.stack;process.exitCode=1;}
 finally{probe.close();await writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2));}
 console.log(JSON.stringify({report:resolve(directory,'report.json'),readOnlyPreflight:report.readOnlyPreflight??false,error:report.error}));
 process.exit(process.exitCode||0);
}
const game=new NativeGame({directory:resolve('.local/native-bridge'),nativeCountryAI:true,
 minutes:5,requirePicture:false,presentOrders:false});
const rpc=game.rpc.bind(game);
game.rpc=async(method,params={},internal={})=>{
 if(rpcEvidenceCategory(method,params)!=='read'){
  const row={at:new Date().toISOString(),method,params,nativeOwned:!!game.nativeCountryAIFence};report.writes.push(row);
  assert.ok(!row.nativeOwned||rpcEvidenceCategory(method,params)!=='work','禁止托管期间脚本逐条派日常订单');
 }
 return rpc(method,params,internal);
};
async function snapshot(){
 const research=await game.rpc('get_research_state');
 const control=await game.rpc('get_country_ai_state');
 const colonies=[];
 for(const sector of game.lastState?.colonies||[])for(const colony of sector.colonies_summary||[]){
  colonies.push(await game.rpc('get_colony_automation',{planet_id:colony.planet_id}));
 }
 return {research,control,colonies};
}
async function emptySlot(area){
 const before=await game.rpc('get_research_state');
 if(!before[area]?.current?.is_researching)return {area,changed:false,before};
 const result=await game.rpc('cancel_research',{area});assert.equal(result.success,true);
 for(let i=0;i<30;i++){const after=await game.rpc('get_research_state');
  if(after[area]?.current?.is_researching===false)return {area,changed:true,before,after};
  await delay(50);
 }
 throw Error('正常取消科研没有回读为空；不启动试点');
}
function researchWitnesses(window,events,now){
 return events.filter(e=>e.stage==='native_execute_returned'&&e.domain==='research'&&e.technology_key)
  .filter(e=>Object.keys(now.research).some(area=>now.research[area]?.current?.key===e.technology_key&&
   window.before.research[area]?.current?.key!==e.technology_key))
  .map(e=>({type:'research',trackingId:e.tracking_id,decisionSequence:e.decision_sequence,key:e.technology_key}));
}
function constructionWitnesses(window,events,now){
 const oldItems=new Set(window.before.colonies.flatMap(c=>c.queue?.items||[]).map(i=>i.item_id));
 return events.filter(e=>e.stage==='native_execute_returned'&&e.domain==='planet_construction')
  .flatMap(e=>now.colonies.filter(c=>c.queue?.known&&c.queue.queue_id===e.queue_id)
   .flatMap(c=>(c.queue.items||[]).filter(i=>!oldItems.has(i.item_id))
    .map(i=>({type:'planet_construction',trackingId:e.tracking_id,decisionSequence:e.decision_sequence,
     queueId:e.queue_id,itemId:i.item_id,definition:e.definition_key}))));
}
async function runWindow(name,operation,seconds){
 const window={name,before:await snapshot(),events:[],witnesses:[]};report.windows.push(window);
 window.delegation=await game.countryAIControl({operation,maxGameDays:720,maxWallSeconds:seconds+10});
 const until=Date.now()+seconds*1000;let cursor=0;
 while(Date.now()<until&&game.countryAI.active){
  await game.watch(2);
  const source=await game.rpc('country_ai_observation',{action:'status',after_sequence:cursor});
  for(const event of source.events){assert.equal(event.event_sequence,cursor+1,'来源事件出现未读取缺口');cursor=event.event_sequence;}
  cursor=source.last_event_sequence;window.events.push(...source.events);window.observation=source;
  const now=await snapshot();window.after=now;
  const witnesses=[...researchWitnesses(window,window.events,now),...constructionWitnesses(window,window.events,now)];
  window.witnesses=[...new Map(witnesses.map(w=>[w.type+':'+w.trackingId+':'+(w.itemId??''),w])).values()];
  await writeFile(resolve(directory,'progress.json'),JSON.stringify(report,null,2));
  if(window.witnesses.length&&window.events.some(e=>e.stage==='native_command_resolved'))break;
  if(game.decisionPause||source.tracking_faults>0||game.countryAI.view().coverageFaults>0||game.countryAI.last?.phase!=='running')break;
  if(game.nativeStrategicReviewDue)await game.countryAIControl({operation:'continue'});
 }
 window.takeover=await game.countryAIControl({operation:'takeover'});
 window.finalObservation=await game.rpc('country_ai_observation',{action:'status'});
 assert.equal(window.finalObservation.commands_drained,true);
 assert.equal(window.takeover.control.owner,'human');
 assert.ok(window.witnesses.length,'没有新原生执行与实际工作回读，不算自主经营通过');
 window.after=await snapshot();
 return window;
}
try{
 report.start=await game.start({keepPaused:true});report.before=await snapshot();
 report.strategicCandidates=[...report.before.research.physics.candidates].sort((a,b)=>{
  const rank=k=>k==='tech_hyper_drive_2'?0:k==='tech_power_plant_2'?1:2;
  return rank(a.key)-rank(b.key)||a.cost-b.cost||a.key.localeCompare(b.key);
 }).map(c=>c.key);
 assert.ok(report.strategicCandidates.length>=2,'没有足够合法科研候选完成关键切换试验');
 report.fixturePhysics=await emptySlot('physics');
 const first=await runWindow('native_before_key_intervention','delegate',65);
 const research=await game.rpc('get_research_state');
 const key=report.strategicCandidates.find(k=>research.physics.candidates.some(c=>c.key===k)&&research.physics.current.key!==k);
 assert.ok(key,'预声明战略科技当前没有合法可切换候选；不随意另选');
 report.intervention={key,before:research,result:await game.rpc('select_research',{area:'physics',tech_key:key})};
 assert.equal(report.intervention.result.success,true);
 for(let i=0;i<30;i++){report.intervention.after=await game.rpc('get_research_state');
  if(report.intervention.after.physics.current.key===key)break;await delay(50);}
 assert.equal(report.intervention.after.physics.current.key,key);
 // Create one ordinary empty slot while human-owned; never choose its next technology.
 report.fixtureSociety=await emptySlot('society');
 const second=await runWindow('native_after_return','resume',65);
 assert.equal(second.after.research.physics.current.key,key,'交还后保留关键干预');
 report.nativeWorkAcrossReturn=first.witnesses.length>0&&second.witnesses.length>0;
 report.nativeRoutineWorkWrites=report.writes.filter(w=>w.nativeOwned&&rpcEvidenceCategory(w.method,w.params)==='work').length;
 assert.equal(report.nativeRoutineWorkWrites,0);
 // Silent-host watchdog: intentionally no lease renewal or game API during this interval.
 report.expiryStart=await game.countryAIControl({operation:'resume',maxWallSeconds:40});
 await delay(17000);
 report.expiry=await game.rpc('country_ai_lease',{action:'status'});
 assert.equal(report.expiry.phase,'stopped');assert.equal(report.expiry.stop_reason,'lease_expired');
 assert.equal(report.expiry.last_native_state.paused,true);
 assert.equal(report.expiry.last_native_state.global_flags.human_ai,false);
 assert.equal(report.expiry.last_native_state.global_flags.force_human_ai,false);
 assert.equal(report.expiry.observation.commands_drained,true);
 report.passed=true;
 report.verifiedDomains=[...new Set(report.windows.flatMap(w=>w.witnesses.map(x=>x.type)))];
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{
 try{
  await game.stop();report.cleanup=game.cleanup;
  assert.equal(game.cleanup?.bindingConfirmed,true);assert.equal(game.cleanup?.pauseConfirmed,true);
  assert.equal(confirmedCountryAIHandoff(game.cleanup?.countryAI),true,'最终国家 AI 交接未确认');
 }catch(error){report.stopError=error.stack;report.passed=false;process.exitCode=1;}
 report.finishedAt=new Date().toISOString();
 await writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({report:resolve(directory,'report.json'),passed:report.passed,coreGoalComplete:false,error:report.error}));
}
