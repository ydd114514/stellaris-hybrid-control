import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate as immediate} from 'node:timers/promises';
import {ActionPresentation,presentationPlan,urgentAlert} from '../src/action-presentation.mjs';

const order=(command,args={})=>({command,arguments:args});
function clock() {
  let at=0;const waits=[];
  const presentation=new ActionPresentation({now:()=>at,wait:async(ms,signal)=>{assert.ok(ms>0&&ms<=500);assert.equal(signal.aborted,false);waits.push(ms);at+=ms;}});
  return {presentation,waits,now:()=>at,advance:ms=>{at+=ms;}};
}

test('presentation plans use only supported real panels and keep camera-only actions honest',()=>{
  const panelCases={select_research:'research',reinforce_fleet:'fleets',build_ship:'fleets',merge_fleets:'fleets',market_trade:'market',adopt_tradition:'traditions',adopt_ascension_perk:'traditions',diplomacy:'contacts',respond_diplomacy:'contacts',assign_scientist:'leaders',hire_leader:'leaders',set_council_agenda:'government',launch_council_agenda:'government'};
  for(const [command,panel]of Object.entries(panelCases))assert.deepEqual({...presentationPlan(order(command)),fleetId:undefined,planetId:undefined},{panel,fleetId:undefined,planetId:undefined,kind:'panel',urgent:false});
  for(const command of ['build_district','build_building','upgrade_building','set_district_zone','set_job_priority'])assert.deepEqual(presentationPlan(order(command,{planet_id:0})),{panel:'game',fleetId:undefined,planetId:0,kind:'camera',urgent:false});
  assert.equal(presentationPlan(order('move_fleet',{fleet_id:0,system_id:5})).fleetId,0);
  assert.equal(presentationPlan(order('merge_fleets',{fleet_ids:[0,7]})).fleetId,0);
  assert.equal(presentationPlan(order('unmapped')).kind,'none');
});

test('modal decisions are not delayed or replaced by ordinary panel cleanup',()=>{
  for(const command of ['resolve_event','open_alert','open_notification','open_war_goals','set_defender_war_goal','close_war_goals','set_speed'])assert.deepEqual(presentationPlan(order(command)),{skip:true});
  assert.equal(urgentAlert({type:'alert_enemy_fleet'}),true);assert.equal(urgentAlert({type:'alert_pirate_activity'}),true);assert.equal(urgentAlert({type:'alert_capped_resources'}),false);
  assert.equal(presentationPlan(order('move_fleet',{fleet_id:3}),{wars:[{war_id:1}]}).urgent,true);
  assert.equal(presentationPlan(order('follow_fleet',{fleet_id:3}),{alerts:[{type:'alert_hostile_fleet'}]}).urgent,true);
  assert.equal(presentationPlan(order('build_district',{planet_id:3}),{wars:[{war_id:1}]}).urgent,false);
});

test('normal actions enforce a two-second preview and ten-second total even if metadata asks for zero time',async()=>{
  const f=clock();f.presentation.begin({panel:'research',kind:'panel',previewMs:0,durationMs:0});
  assert.equal(f.presentation.active.previewMs,2000);assert.equal(f.presentation.active.durationMs,10000);
  assert.deepEqual(await f.presentation.preview(),{interrupted:false});assert.equal(f.now(),2000);
  // This point represents the earliest allowed real game mutation.
  const executedAt=f.now();assert.equal(executedAt,2000);
  assert.deepEqual(await f.presentation.hold(),{interrupted:false});assert.equal(f.now(),10000);assert.equal(f.waits.reduce((a,b)=>a+b,0),10000);
});

test('the default production waiter does not silently skip pacing and is abortable',async()=>{
  const p=new ActionPresentation();p.begin({panel:'research',kind:'panel'});
  assert.equal(p.active.previewMs,2000);assert.equal(p.active.durationMs,10000);
  let finished=false;const work=p.preview().then(result=>{finished=true;return result;});await immediate();assert.equal(finished,false);
  p.cancel('用户停止');assert.deepEqual(await work,{interrupted:true,reason:'用户停止'});
});

test('actual mutation and read-back time counts toward ten seconds instead of adding another full hold',async()=>{
  const f=clock();f.presentation.begin({panel:'fleets',kind:'panel'});await f.presentation.preview();
  f.advance(3500);const before=f.waits.reduce((a,b)=>a+b,0);await f.presentation.hold();
  assert.equal(f.now(),10000);assert.equal(f.waits.reduce((a,b)=>a+b,0)-before,4500);
  f.presentation.end();f.presentation.begin({panel:'research',kind:'panel'});await f.presentation.preview();f.advance(11000);
  const count=f.waits.length;await f.presentation.hold();assert.equal(f.waits.length,count);assert.equal(f.now(),23000);
});

test('each action resets preview and hold even when the panel and target remain identical',async()=>{
  const f=clock(),metadata={panel:'fleets',fleetId:3,kind:'panel'};const execution=[];
  for(let n=0;n<2;n++){f.presentation.begin(metadata);await f.presentation.preview();execution.push(f.now());await f.presentation.hold();f.presentation.end();}
  assert.deepEqual(execution,[2000,12000]);assert.equal(f.now(),20000);assert.equal(f.presentation.active,undefined);
});

test('camera-only scenes also remain visible while urgent defensive movement bypasses the showcase delay',async()=>{
  const f=clock();f.presentation.begin(presentationPlan(order('build_district',{planet_id:3})));await f.presentation.preview();await f.presentation.hold();assert.equal(f.now(),10000);
  const waits=f.waits.length;f.presentation.begin(presentationPlan(order('move_fleet',{fleet_id:3}),{wars:[{war_id:1}]}));
  assert.equal(f.presentation.active.previewMs,0);assert.equal(f.presentation.active.durationMs,0);await f.presentation.preview();await f.presentation.hold();assert.equal(f.waits.length,waits);
});

test('a new central event interrupts preview before mutation and interrupts the later hold without hiding it',async()=>{
  const f=clock();f.presentation.begin({panel:'government',kind:'panel'});
  const preview=await f.presentation.preview(async()=>f.now()>=500?'中央事件待处理':undefined);assert.deepEqual(preview,{interrupted:true,reason:'中央事件待处理'});assert.equal(f.now(),500);
  f.presentation.end();f.presentation.begin({panel:'research',kind:'panel'});await f.presentation.preview();
  const hold=await f.presentation.hold(async()=>f.now()>=3500?'战争目标窗口待处理':undefined);assert.deepEqual(hold,{interrupted:true,reason:'战争目标窗口待处理'});assert.equal(f.now(),3500);
});

test('deadline checks consume real time but do not postpone a completed presentation for another interval',async()=>{
  const f=clock();f.presentation.begin({kind:'panel'});await f.presentation.preview();f.advance(8000);
  const before=f.waits.length;const result=await f.presentation.hold(async()=>{f.advance(200);});
  assert.deepEqual(result,{interrupted:false});assert.equal(f.waits.length,before);assert.equal(f.now(),10200);
});

test('cancellation during an awaited guard cannot later return an un-interrupted preview',async()=>{
  const f=clock();f.presentation.begin({panel:'research'});let release;
  const checking=new Promise(resolve=>{release=resolve;});const work=f.presentation.preview(()=>checking);
  f.presentation.cancel('控制器停止');release();assert.deepEqual(await work,{interrupted:true,reason:'控制器停止'});assert.deepEqual(f.waits,[]);
});

test('switching scenes invalidates a late previous guard result and gives the new action its own clock',async()=>{
  const f=clock();f.presentation.begin({panel:'research'});let release;
  const old=f.presentation.preview(()=>new Promise(resolve=>{release=resolve;}));
  f.advance(1000);f.presentation.begin({panel:'market'});release();assert.deepEqual(await old,{interrupted:true,reason:'展示已切换'});
  await f.presentation.preview();assert.equal(f.now(),3000);await f.presentation.hold();assert.equal(f.now(),11000);
});

test('late completion of an injected waiter cannot undo cancellation and non-cancellation errors remain visible',async()=>{
  let release;const p=new ActionPresentation({now:()=>0,wait:()=>new Promise(resolve=>{release=resolve;})});p.begin({panel:'research'});
  const work=p.preview();await immediate();p.cancel('停止');release();assert.deepEqual(await work,{interrupted:true,reason:'停止'});
  const broken=new ActionPresentation({now:()=>0,wait:async()=>{throw Error('test clock failed');}});broken.begin({panel:'research'});await assert.rejects(broken.preview(),/test clock failed/);
});

test('ending the current scene invalidates pending work and empty holds never create a fabricated scene',async()=>{
  const f=clock();assert.deepEqual(await f.presentation.preview(),{interrupted:false});assert.deepEqual(await f.presentation.hold(),{interrupted:false});assert.equal(f.presentation.active,undefined);
  f.presentation.begin({panel:'fleets'});let release;const work=f.presentation.preview(()=>new Promise(resolve=>{release=resolve;}));
  const previous=f.presentation.end();assert.equal(previous.panel,'fleets');release();assert.deepEqual(await work,{interrupted:true,reason:'展示已结束'});assert.equal(f.presentation.active,undefined);
});
