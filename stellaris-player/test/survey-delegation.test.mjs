import test from 'node:test';
import assert from 'node:assert/strict';
import {SurveyDelegation} from '../src/survey-delegation.mjs';
import {NativeGame} from '../src/native-game.mjs';

const off=()=>({known:true,automation_enabled:false,order_chain_complete:true,orders:[]});
const on=()=>({known:true,automation_enabled:true,order_chain_complete:true,automation_order_count:1,orders:[{automation:true,settings_bits:2,action_option_count:0}]});
function fixture(){
 let state=off(),stopped=false;const data={},calls=[],saved=[];
 const controller=new SurveyDelegation({store:()=>data,save:async()=>saved.push(structuredClone(data)),isStopped:()=>stopped,sessionId:'test',rpc:async(m,p)=>{
  calls.push({m,p});if(m==='get_fleet_automation')return structuredClone(state);
  assert.equal(saved.at(-1).records[0].pending,true);
  if(p.execute)state=p.enabled?on():off();return {success:true,status:'pending_confirmation'};
 }});
 return {controller,data,calls,saved,setState:s=>state=s,stop:()=>stopped=true};
}
const move={command:'move_fleet',arguments:{fleet_id:0,system_id:1}};
const healthy=()=>({resources:Object.fromEntries(['energy','alloys','food','trade','unity'].map(k=>[k,{stockpile:1000,net:10}]))});
test('native owner blocks manual overwrite until actual disabled readback',async()=>{
 const f=fixture();assert.equal((await f.controller.change(0,true)).owner,'native');
 assert.throws(()=>f.controller.assertManual(move),/控制权/);
 assert.equal((await f.controller.change(0,false)).owner,'manual');
 assert.doesNotThrow(()=>f.controller.assertManual(move));
 const count=f.calls.filter(x=>x.p.execute===true).length;
 await f.controller.change(0,false);assert.equal(f.calls.filter(x=>x.p.execute===true).length,count);
});
test('accepted receipt without actual effects never grants native ownership or replays',async()=>{
 const f=fixture();f.controller.rpc=async(m,p)=>m==='get_fleet_automation'?off():{success:true};
 assert.equal((await f.controller.change(0,true)).owner,'unknown');
 await assert.rejects(f.controller.change(0,true),/尚未对账/);
 assert.throws(()=>f.controller.assertManual(move),/控制权/);
});
test('unknown configuration and manual orders are not silently replaced',async()=>{
 const f=fixture();f.setState({known:false});await assert.rejects(f.controller.change(0,true),/未知/);
 f.setState({...off(),orders:[{token:4}]});await assert.rejects(f.controller.change(0,true),/现有订单/);
 assert.equal(f.calls.filter(x=>x.m==='set_survey_automation').length,0);
});
test('stop arriving during preflight suppresses actual write',async()=>{
 const f=fixture();f.controller.rpc=async(m,p)=>{
  f.calls.push({m,p});if(m==='get_fleet_automation')return off();
  f.stop();return {success:true};
 };
 await assert.rejects(f.controller.change(0,true),/停止/);
 assert.equal(f.calls.some(x=>x.p.execute===true),false);
});
test('late successful readback after stop cannot restore control',async()=>{
 const f=fixture();let reads=0;
 f.controller.rpc=async(m,p)=>{if(m==='get_fleet_automation'){if(++reads>1){f.stop();return on();}return off();}return {success:true};};
 await assert.rejects(f.controller.change(0,true),/停止/);
 assert.equal(f.data.records[0].owner,'unknown');
});
test('dynamic options or unwanted tasks do not satisfy survey-only delegation',async()=>{
 const f=fixture();let reads=0;
 f.controller.rpc=async(m)=>m==='get_fleet_automation'?(++reads===1?off():{...on(),orders:[{automation:true,settings_bits:3,action_option_count:1}]}):{success:true};
 assert.equal((await f.controller.change(0,true)).owner,'unknown');
});
test('records from another session never grant manual access',()=>{
 const f=fixture();f.data.records={0:{sessionId:'old',owner:'manual'}};
 assert.throws(()=>f.controller.assertManual(move),/控制权/);
});
test('stopping reclaims native automation and confirms actual disabled state',async()=>{
 const f=fixture();await f.controller.change(0,true);f.stop();f.controller.close();
 const results=await f.controller.cleanup();assert.equal(results[0].confirmed,true);
 assert.equal(f.data.records[0].owner,'manual');
 await assert.rejects(f.controller.change(0,true),/停止/);
 const count=f.calls.filter(x=>x.p.execute===true).length;
 await f.controller.cleanup();assert.equal(f.calls.filter(x=>x.p.execute===true).length,count);
});
test('failed revoke readback retains unknown authority',async()=>{
 const f=fixture();await f.controller.change(0,true);f.controller.close();
 f.controller.rpc=async(m)=>m==='get_fleet_automation'?on():{success:true};
 assert.equal((await f.controller.cleanup())[0].confirmed,false);
 assert.equal(f.data.records[0].owner,'unknown');assert.throws(()=>f.controller.assertManual(move),/控制权/);
});
test('real controller gates pilot, invalidates snapshot and blocks direct orders while delegated',async()=>{
 const game=new NativeGame({hybridSurvey:true,requirePicture:false});
 let state=off(),revision=1;
 game.guard=async()=>healthy();game.gestalt.save=async()=>{};game.log=async()=>{};
 game.observe=async()=>({snapshotId:game.snapshotId='snapshot-'+(++revision)});
 game.snapshotId='snapshot-1';game.snapshotAt=Date.now();game.lastState={player:{capital_system_id:0}};
 game.rpc=async(m,p)=>m==='get_active_events'?[]:m==='get_wars'?{warGoalsWindow:false}:m==='find_systems'?{systems:[{id:10,intel:1}]}:m==='find_path'?{fleet_id:p.fleet_id,from_system_id:0,to_system_id:p.to_system_id,reachable:true,systems:[{id:10}]}:m==='ping'?{features:['native_survey_automation_candidate']}:
  m==='get_fleet_automation'?state:(p.execute?(state=p.enabled?on():off()):null,{success:true});
 const first=await game.surveyControl({operation:'delegate',fleetId:0,snapshotId:'snapshot-1'});
 assert.equal(first.control.owner,'native');
 await assert.rejects(game.apply({requestId:'late',snapshotId:'snapshot-1',orders:[move]}),/控制权/);
 await assert.rejects(game.surveyControl({operation:'reclaim',fleetId:0,snapshotId:'snapshot-1'}),/过期/);
 assert.equal((await game.surveyControl({operation:'reclaim',fleetId:0,snapshotId:game.snapshotId})).control.owner,'manual');
 const disabledGame=new NativeGame();await assert.rejects(disabledGame.surveyControl({operation:'delegate',fleetId:0}),/尚未启用/);
});
test('explicit restart recovery only reclaims current state and never replays enable',async()=>{
 const f=fixture();f.data.records={0:{fleetId:0,sessionId:'old',owner:'native',desired:true,pending:true}};
 f.setState(on());const result=await f.controller.recover(0);
 assert.equal(result.owner,'manual');assert.equal(result.sessionId,'test');
 assert.equal(f.calls.some(x=>x.p.execute===true&&x.p.enabled===true),false);
});
test('one empty read cannot clear an unknown enable in the same session',async()=>{
 const f=fixture();f.controller.rpc=async(m)=>m==='get_fleet_automation'?off():{success:true};
 await f.controller.change(0,true);
 await assert.rejects(f.controller.recover(0),/在途保护/);
});
test('cleanup preserves an unknown enable across empty reads and across sessions',async()=>{
 const f=fixture();f.data.records={0:{fleetId:0,sessionId:'test',owner:'unknown',desired:true,pending:true,writeAttempted:true}};
 const result=await f.controller.cleanup();assert.equal(result[0].confirmed,false);
 assert.equal(f.data.records[0].enableUnconfirmed,true);assert.equal(f.data.records[0].desired,false);
 assert.equal((await f.controller.reconcile(0)).owner,'unknown');
 f.data.records[0].sessionId='old';await assert.rejects(f.controller.recover(0),/在途保护/);
 assert.equal(f.calls.some(c=>c.m==='set_survey_automation'),false);
 f.setState(on());assert.equal((await f.controller.recover(0)).owner,'manual');
});
test('repeated close does not turn already-confirmed ownership into an unconfirmed enable',async()=>{
 const f=fixture();await f.controller.change(0,true);f.controller.close();f.controller.close();f.setState(off());
 assert.equal((await f.controller.cleanup())[0].confirmed,true);assert.equal(f.data.records[0].owner,'manual');
});
test('monitor trusts fresh actual survey state and stops trusting configuration drift',async()=>{
 const f=fixture();await f.controller.change(0,true);
 f.setState({...on(),orders:[...on().orders,{automation:false,token:123}]});
 assert.equal((await f.controller.monitor()).trusted,true);
 f.setState({...on(),orders:[{automation:true,settings_bits:3,action_option_count:0}]});
 const result=await f.controller.monitor();assert.equal(result.trusted,false);
 assert.ok(result.reasons.includes('survey_state_unknown'));
 assert.throws(()=>f.controller.assertManual(move),/控制权/);
});
test('enabled but idle automation does not justify relaxed model waiting',async()=>{
 const f=fixture();await f.controller.change(0,true);
 assert.equal((await f.controller.monitor()).trusted,false);
 assert.equal(f.data.records[0].owner,'native');
});
test('persistent native standby wakes strategic review instead of counting as useful work',async()=>{
 const f=fixture();let clock=100;f.controller.now=()=>clock;
 await f.controller.change(0,true);await f.controller.monitor({gameDate:'2200.01.01'});clock+=14999;
 assert.equal((await f.controller.monitor({gameDate:'2200.02.02'})).reasons.includes('survey_no_work'),false);
 clock++;assert.equal((await f.controller.monitor({gameDate:'2200.02.02'})).reasons.includes('survey_no_work'),true);
 f.setState({...on(),orders:[...on().orders,{automation:false,token:11957}]});await f.controller.monitor({gameDate:'2200.02.03'});
 assert.equal(f.data.records[0].idleGameDay,undefined);
 f.setState(on());clock+=30000;
 assert.equal((await f.controller.monitor({gameDate:'2200.02.04'})).reasons.includes('survey_no_work'),false);
});
test('watch keeps the same resource protection running while its tool call holds the serial queue',async()=>{
 const g=new NativeGame({hybridSurvey:true}),calls=[];
 g.lastState={wars:[],alerts:[]};let checks=0;
 g.guard=async()=>({is_paused:false,...healthy(),...(checks++?{resources:{...healthy().resources,energy:{stockpile:0,net:-10}}}:{})});
 g.ensurePicture=async()=>{};g.finishPresentation=async()=>{};g.log=async()=>{};g.checkpoint=async()=>{};g.observe=async()=>g.lastState;
 g.surveyDelegation.monitor=async()=>({trusted:true,reasons:[]});
 g.surveyDelegation.view=()=>({records:{0:{sessionId:g.sessionId,owner:'native'}}});
 let reclaimed=false;g.surveyDelegation.cleanup=async()=>{reclaimed=true;return [{confirmed:true}];};
 g.rpc=async(m,p)=>{calls.push({m,p});return m==='get_active_events'?[]:m==='get_wars'?{wars:[]}:m==='get_alerts'?[]:{success:true};};
 const result=await g.watch(0.001);
 assert.ok(result.wakeReasons.includes('survey_resource_risk'));assert.equal(reclaimed,true);
 assert.equal(calls.filter(c=>c.m==='set_paused'&&c.p.paused===true).length,1);
});
test('an external pause is never undone by a subsequent watch request',async()=>{
 const g=new NativeGame({hybridSurvey:true,now:()=>Date.now()+1000}),calls=[];
 g.expectedPaused=false;g.observe=async()=>({paused:true});
 g.rpc=async(m,p)=>{calls.push({m,p});return {in_game:true,is_paused:true,date:{formatted:'2437.01.01'}};};
 const result=await g.watch(0);
 assert.match(result.needsAttention,/不会自动恢复人工暂停/);
 assert.equal(calls.some(c=>c.m==='set_paused'),false);
});
test('controller declines delegation when normal engine candidates are empty',async()=>{
 const game=new NativeGame({hybridSurvey:true});game.guard=async()=>({});game.snapshotId='now';game.snapshotAt=Date.now();
 game.lastState={player:{capital_system_id:0}};
 const calls=[];game.rpc=async(m,p)=>{calls.push(m);return m==='ping'?{features:['native_survey_automation_candidate']}:m==='find_path'?{fleet_id:1,from_system_id:0,to_system_id:0}:{systems:[]};};
 await assert.rejects(game.surveyControl({operation:'delegate',fleetId:1,snapshotId:'now'}),/没有合法调查目标/);
 assert.equal(calls.includes('set_survey_automation'),false);
});
test('a pending central choice blocks new delegation before any automation write',async()=>{
 const game=new NativeGame({hybridSurvey:true}),calls=[];game.guard=async()=>healthy();game.snapshotId='now';game.snapshotAt=Date.now();
 game.lastState={player:{capital_system_id:0}};
 game.rpc=async(m,p)=>{calls.push(m);return m==='ping'?{features:['native_survey_automation_candidate']}:m==='find_systems'?{systems:[{id:0,intel:1}]}:m==='find_path'?{fleet_id:1,from_system_id:0,to_system_id:0,reachable:true,systems:[{id:0}]}:m==='get_active_events'?[{window_id:0}]:m==='get_wars'?{warGoalsWindow:false}:{};};
 await assert.rejects(game.surveyControl({operation:'delegate',fleetId:1,snapshotId:'now'}),/中央事件/);
 assert.equal(calls.includes('set_survey_automation'),false);
});
test('monitor never adopts old-session control automatically',async()=>{
 const f=fixture();f.data.records={0:{fleetId:0,sessionId:'old',owner:'native',desired:true}};
 const result=await f.controller.monitor();assert.equal(result.trusted,false);
 assert.ok(result.reasons.includes('survey_recovery_required'));assert.equal(f.calls.length,0);
});
test('disabled mode can inspect and recover old automation, but never enable it',async()=>{
 const game=new NativeGame({hybridSurvey:false}),calls=[];let state=on();
 game.gestalt.data.surveyControl={revision:1,records:{0:{fleetId:0,sessionId:'old',owner:'native',desired:true}}};
 game.snapshotId='now';game.snapshotAt=Date.now();game.guard=async()=>healthy();game.gestalt.save=async()=>{};game.log=async()=>{};game.observe=async()=>({snapshotId:'after'});
 game.rpc=async(m,p)=>{calls.push({m,p});if(m==='ping')return {features:['native_survey_automation_candidate']};if(m==='get_fleet_automation')return state;if(p.execute)state=off();return {success:true};};
 assert.equal((await game.surveyControl({operation:'inspect',fleetId:0})).automation_enabled,true);
 await assert.rejects(game.surveyControl({operation:'delegate',fleetId:0,snapshotId:'now'}),/只允许查询或收权/);
 await assert.rejects(game.surveyControl({operation:'reclaim',fleetId:0,snapshotId:'now'}),/旧会话/);
 const result=await game.surveyControl({operation:'recover',fleetId:0,snapshotId:'now'});
 assert.equal(result.control.owner,'manual');assert.doesNotThrow(()=>game.surveyDelegation.assertManual(move));
 assert.ok(calls.filter(c=>c.m==='set_survey_automation').every(c=>c.p.enabled===false));
});
test('slow model can leave confirmed survey running while central events still pause',async()=>{
 const game=new NativeGame({hybridSurvey:true});const calls=[];
 game.guard=async()=>({is_paused:false,date:{formatted:'2200.01.01'}});
 game.lastState={wars:[],alerts:[]};game.log=async()=>{};game.checkpoint=async()=>{};
 let events=[];game.rpc=async(m,p)=>{calls.push({m,p});return m==='get_active_events'?events:m==='get_wars'?{wars:[]}:m==='get_alerts'?[]:{success:true};};
 game.surveyDelegation.monitor=async()=>({trusted:true,reasons:[]});
 await game.monitorDecision(12000);assert.equal(calls.some(x=>x.m==='set_paused'),false);
 events=[{window_id:0}];await game.monitorDecision(13000);
 assert.ok(game.decisionPause.reasons.includes('central_event'));
 assert.equal(calls.filter(x=>x.m==='set_paused').length,1);
});
test('an engine-paused central event still reclaims automation before a model can resolve it',async()=>{
 const g=new NativeGame({hybridSurvey:true}),calls=[];
 g.guard=async()=>({is_paused:true,date:{formatted:'2200.01.01'}});g.lastState={};g.log=async()=>{};g.checkpoint=async()=>{};g.gestalt.save=async()=>{};
 g.gestalt.data.surveyControl={revision:1,records:{0:{fleetId:0,revision:1,sessionId:g.sessionId,owner:'native',desired:true,pending:false}}};let state=on();
 g.rpc=async(m,p)=>{calls.push({m,p});if(m==='get_active_events')return [{window_id:0}];if(m==='get_wars')return {warGoalsWindow:false};if(m==='get_fleet_automation')return state;if(m==='set_survey_automation'){state=off();return {success:true};}throw Error(m);};
 await g.monitorDecision(1000);assert.equal(g.surveyDelegation.view().records[0].owner,'manual');assert.equal(g.decisionPause.pauseAlreadyPresent,true);
 await g.monitorDecision(2000);assert.equal(calls.filter(c=>c.m==='set_survey_automation').length,1);
 assert.equal(calls.some(c=>c.m==='set_paused'&&c.p.paused===false),false);
});
test('paused-event revoke failures remain unknown without an automatic retry loop',async()=>{
 const g=new NativeGame({hybridSurvey:true});let attempts=0;
 g.guard=async()=>({is_paused:true});g.lastState={};g.log=async()=>{};g.checkpoint=async()=>{};
 g.surveyDelegation.view=()=>({records:{0:{fleetId:0,revision:1,sessionId:g.sessionId,owner:'unknown'}}});
 g.surveyDelegation.cleanup=async()=>{attempts++;throw Error('timeout');};g.rpc=async m=>m==='get_active_events'?[{window_id:0}]:{warGoalsWindow:false};
 await g.monitorDecision();await g.monitorDecision();assert.equal(attempts,1);assert.match(g.decisionPause.surveyCleanupError,/timeout/);
});
test('live survey observations are published while a long watch is still running',async()=>{
 let clock=10000,checkpoints=0;const g=new NativeGame({hybridSurvey:true,now:()=>clock});
 g.guard=async()=>({is_paused:false,...healthy()});g.lastState={wars:[],alerts:[]};g.checkpoint=async()=>checkpoints++;
 g.rpc=async m=>m==='get_active_events'||m==='get_alerts'?[]:{wars:[]};g.surveyDelegation.monitor=async()=>({trusted:true,reasons:[]});
 g.surveyDelegation.view=()=>({records:{0:{sessionId:g.sessionId,owner:'native',observedAt:clock}}});
 await g.monitorDecision();clock+=1000;await g.monitorDecision();assert.equal(checkpoints,1);assert.equal(g.lastState.surveyControl.records[0].observedAt,11000);
 clock+=4000;await g.monitorDecision();assert.equal(checkpoints,2);
});
test('a rejected preflight can be explicitly reclaimed without inventing an unknown write',async()=>{
 const f=fixture();f.controller.rpc=async(m)=>m==='get_fleet_automation'?off():{success:false,error:'没有科学官'};
 await assert.rejects(f.controller.change(0,true),/科学官/);
 assert.equal(f.data.records[0].writeAttempted,false);
 assert.equal((await f.controller.recover(0)).owner,'manual');
});
test('only the verified engine running bit may accompany survey-only settings',async()=>{
 const f=fixture();let reads=0;
 f.controller.rpc=async(m)=>m==='get_fleet_automation'?(++reads===1?off():{...on(),orders:[{automation:true,settings_bits:0x402,action_option_count:0}]}):{success:true};
 assert.equal((await f.controller.change(0,true)).owner,'native');
 f.controller.rpc=async()=>({...on(),orders:[{automation:true,settings_bits:0x802,action_option_count:0}]});
 assert.equal((await f.controller.monitor()).trusted,false);
});
test('resource shortfall pauses first and then actually reclaims delegated work',async()=>{
 const g=new NativeGame({hybridSurvey:true}),calls=[];let automation={...on(),orders:[...on().orders,{automation:false,token:123}]};
 const status={...healthy(),is_paused:false,date:{formatted:'2200.01.01'}};status.resources.energy.net=-2000;
 g.guard=async()=>status;g.lastState={wars:[],alerts:[]};g.log=async()=>{};g.checkpoint=async()=>{};g.gestalt.save=async()=>{};
 g.gestalt.data.surveyControl={revision:1,records:{0:{fleetId:0,owner:'native',desired:true,pending:false,sessionId:g.sessionId}}};
 g.rpc=async(m,p)=>{calls.push({m,p});
  if(m==='get_fleet_automation')return automation;
  if(m==='set_survey_automation'){automation=off();return {success:true};}
  return m==='get_active_events'?[]:m==='get_wars'?{wars:[]}:m==='get_alerts'?[]:{success:true};
 };
 await g.monitorDecision(12000);
 assert.ok(g.decisionPause.reasons.includes('survey_resource_risk'));
 assert.equal(g.surveyDelegation.record(0).owner,'manual');
 assert.ok(calls.findIndex(x=>x.m==='set_paused')<calls.findIndex(x=>x.m==='set_survey_automation'));
 assert.equal(calls.some(x=>x.m==='set_survey_automation'&&x.p.enabled===true),false);
});
test('active campaign floors are protected but completed campaign floors retire',()=>{
 const g=new NativeGame();g.gestalt.data.campaign={phase:'combat',execution:{resourceFloors:{alloys:2000}}};
 assert.equal(g.delegationBudgetOptions().floors.alloys,2000);
 g.gestalt.data.campaign.phase='completed';assert.deepEqual(g.delegationBudgetOptions().floors,{});
});
