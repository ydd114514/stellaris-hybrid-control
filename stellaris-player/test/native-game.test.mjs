import {COUNTRY_AI_ECONOMY_CANDIDATE_VERSION,COUNTRY_AI_ECONOMY_FEATURES} from '../src/native-country-ai-economic-policy.mjs';
import {COUNTRY_AI_P1_FEATURES} from '../src/native-country-ai.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, mkdir, writeFile, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, dirname, basename, resolve} from 'node:path';
import {NativeGame, validateOrder} from '../src/native-game.mjs';

test('hybrid manual survey returns a fresh explicit delegate call without writing or auto-enabling',async t=>{
 let enabled=false;
 const resources=Object.fromEntries(['energy','alloys','food','trade','unity'].map(k=>[k,{stockpile:1000,net:10}]));
 const {game,calls}=await fixture(t,{
  get_status:()=>({in_game:true,is_paused:true,date:{formatted:'2200.01.01'},resources}),
  get_wars:()=>({wars:[],warGoalsWindow:false}),
  get_fleet_automation:p=>({fleet_id:p.fleet_id,known:true,automation_enabled:enabled,order_chain_complete:true,automation_order_count:enabled?1:0,orders:enabled?[{automation:true,settings_bits:2,action_option_count:0}]:[]}),
  set_survey_automation:p=>{if(p.execute)enabled=p.enabled;return {success:true};},
  find_path:p=>({fleet_id:p.fleet_id,from_system_id:0,to_system_id:p.to_system_id,reachable:true,systems:[0,p.to_system_id]}),
  find_systems:()=>({systems:[{id:1,intel:3}]})
 },{hybridSurvey:true});
 const r=await game.apply({requestId:'prefer-native',snapshotId:game.snapshotId,orders:[{command:'survey',arguments:{fleet_id:1,system_id:1}}]});
 assert.equal(r.orders[0].status,'deferred');assert.equal(r.orders[0].nativeWriteAttempted,false);assert.equal(game.gestalt.data.actions.length,0);
 const next=r.orders[0].candidateFeedback.nextCall;
 assert.equal(next.arguments.snapshotId,r.state.snapshotId);assert.equal(calls.some(c=>c.method==='survey'||c.method==='set_survey_automation'),false);
 const delegated=await game.surveyControl(next.arguments);assert.equal(delegated.control.owner,'native');assert.equal(enabled,true);
 await assert.rejects(game.apply({requestId:'cannot-override-native',snapshotId:game.snapshotId,manualSurveyReason:'精确调查殖民地',orders:[{command:'survey',arguments:{fleet_id:1,system_id:1}}]}),/控制权尚未交回/);
});

test('strategic manual survey reason is explicit metadata and cannot change the tracked order identity',async t=>{
 const {game,calls}=await fixture(t,{
  get_fleet_automation:p=>({fleet_id:p.fleet_id,known:true,automation_enabled:false,order_chain_complete:true,orders:[]}),
  get_system:()=>({surveyed:false,fleets:[]})
 },{hybridSurvey:true});
 const orders=[{command:'survey',arguments:{fleet_id:1,system_id:0}}];
 const posted=await game.apply({requestId:'strategic-manual',snapshotId:game.snapshotId,manualSurveyReason:'精确调查当前战略目标',orders});
 assert.equal(posted.orders[0].status,'posted');assert.equal(calls.filter(c=>c.method==='survey').length,1);
 assert.deepEqual(calls.find(c=>c.method==='survey').params,{fleet_id:1,system_id:0});
 await assert.rejects(game.apply({requestId:'strategic-manual',snapshotId:game.snapshotId,manualSurveyReason:'更改理由不改变原订单',orders}),/同一 requestId/);
 const duplicate=await game.apply({requestId:'new-reason-same-order',snapshotId:game.snapshotId,manualSurveyReason:'另一个理由仍是同一目标',orders});
 assert.equal(duplicate.orders[0].status,'pending_confirmation');assert.equal(calls.filter(c=>c.method==='survey').length,1);
 const n=calls.length;await assert.rejects(game.apply({requestId:'bad-reason',snapshotId:game.snapshotId,manualSurveyReason:' ',orders}),/manualSurveyReason/);assert.equal(calls.length,n);
});

test('session metadata records effective productive features and survey-only suppression',async t=>{
 for(const surveyPilot of [false,true]){
  const {game}=await fixture(t,{}, {colonyUpgradePilot:true,monthlyLifecyclePilot:true,localWaitPilot:true,surveyPilot});
  const rows=(await readFile(game.journal,'utf8')).trim().split('\n').map(JSON.parse),meta=rows.find(r=>r.type==='session_meta');
  assert.deepEqual(meta.featureFlags,{colonyUpgrade:!surveyPilot,monthlyLifecycle:!surveyPilot,localWait:!surveyPilot});
  assert.equal(meta.watchMaximumSeconds,surveyPilot?20:60);
 }
});
test('runtime heartbeat persists actual pause/date without refreshing the decision snapshot',async t=>{
 let paused=true,date='2200.01.01';const {game}=await fixture(t,{get_status:()=>({in_game:true,is_paused:paused,date:{formatted:date},outliner:{sectors_summary:{capital_system:'太阳'}}})});
 const oldId=game.lastState.snapshotId;paused=false;date='2200.02.01';
 await game.rpc('set_paused',{paused:false});assert.equal(game.runtimeStatus.paused,null);
 await game.rpc('get_status');await game.checkpoint();
 const cp=JSON.parse(await readFile(join(game.directory,'latest-session.json')));
 assert.equal(cp.runtimeStatus.paused,false);assert.equal(cp.runtimeStatus.date,date);assert.equal(cp.state.paused,true);assert.equal(cp.state.date,'2200.01.01');assert.equal(cp.state.snapshotId,oldId);
});
test('baseline watch publishes live execution before returning without refreshing decision facts',async t=>{
 let paused=true,date='2200.01.01';
 const {game,advance}=await fixture(t,{
  get_status:()=>({in_game:true,is_paused:paused,date:{formatted:date},outliner:{sectors_summary:{capital_system:'太阳'}}}),
  set_paused:args=>{paused=args.paused;return {success:true};}
 });
 const oldId=game.lastState.snapshotId,oldObservedAt=game.snapshotAt;
 date='2200.02.01';advance(16000);
 let checked=false;const observe=game.observe.bind(game);
 game.observe=async()=>{
  const cp=JSON.parse(await readFile(join(game.directory,'latest-session.json')));
  assert.equal(cp.runtimeStatus.date,date);assert.equal(cp.runtimeStatus.paused,false);
  assert.equal(cp.runtimeStatus.observedAt,game.now());
  assert.equal(cp.state.date,'2200.01.01');assert.equal(cp.state.snapshotId,oldId);
  assert.equal(cp.observedAt,oldObservedAt);checked=true;return observe();
 };
 try{await game.watch(0.025);}finally{game.observe=observe;}
 assert.equal(checked,true);
});

test('owned civilian stance reaches the native legality gate while unknown fleets remain blocked',async t=>{
 const {game,calls}=await fixture(t,{set_fleet_stance:()=>({success:true})});
 const result=await game.apply({requestId:'civilian-evasive',snapshotId:game.snapshotId,orders:[{command:'set_fleet_stance',arguments:{fleet_id:1,stance:'evasive'}}]});
 assert.equal(result.orders[0].status,'posted');assert.equal(calls.filter(x=>x.method==='set_fleet_stance').length,1);
 const blocked=await game.apply({requestId:'unknown-evasive',snapshotId:game.snapshotId,orders:[{command:'set_fleet_stance',arguments:{fleet_id:99,stance:'evasive'}}]});
 assert.equal(blocked.orders[0].status,'rejected');assert.equal(calls.filter(x=>x.method==='set_fleet_stance').length,1);
});
test('civilian stance rejected by the engine is reported without inventing support',async t=>{
 const {game,calls}=await fixture(t,{set_fleet_stance:()=>({success:false,error:'fleet has no stances'})});
 const result=await game.apply({requestId:'unsupported-civilian',snapshotId:game.snapshotId,orders:[{command:'set_fleet_stance',arguments:{fleet_id:1,stance:'evasive'}}]});
 assert.equal(result.orders[0].status,'rejected');assert.match(result.orders[0].response.error,/no stances/);assert.equal(calls.filter(x=>x.method==='set_fleet_stance').length,1);
});

test('army preparation uses actual owned recruitment candidates and tracks training then embarkation',async t=>{
 let garrison=[],transport=[];
 const {game,advance,calls}=await fixture(t,{
  get_status:()=>({in_game:true,date:{formatted:'2200.01.01'},outliner:{sectors_summary:{capital_system:'太阳',sectors:[{colonies_summary:[{planet_id:0}]}]}}}),
  get_planet_armies:()=>({success:true,planet_id:0,recruitable_armies:[{key:'assault_army'}],stationed_armies:garrison,construction_queue:[]}),
  get_armies:()=>({garrison_armies:garrison,transport_armies:transport}),
  recruit_planet_army:()=>{garrison=[{army_id:0,planet_id:0,type_key:'assault_army',is_defense:false}];return {success:true};},
  embark_all_armies:()=>{transport=garrison;garrison=[];return {success:true};}
 });
 const train=await game.apply({requestId:'train',snapshotId:game.snapshotId,orders:[{command:'recruit_planet_army',arguments:{planet_id:0,army_key:'assault_army'}}]});assert.equal(train.orders[0].status,'posted');
 advance(6000);await game.observe();assert.equal(game.orderTracker.view().find(r=>r.command==='recruit_planet_army').status,'completed');
 const embark=await game.apply({requestId:'embark',snapshotId:game.snapshotId,orders:[{command:'embark_all_armies',arguments:{planet_id:0}}]});assert.equal(embark.orders[0].status,'posted');
 advance(6000);await game.observe();assert.equal(game.orderTracker.view().find(r=>r.command==='embark_all_armies').status,'completed');
 assert.equal(calls.filter(c=>c.method==='recruit_planet_army').length,1);
});

test('M2 existing NativeGame entry executes a whole first war through real apply with native stubs',async t=>{
 let wars=[],occupied=false,owned=false;
 const {game,calls}=await fixture(t,{
  get_government:()=>({authority:'auth_democratic'}),
  get_status:()=>({in_game:true,is_paused:false,date:{formatted:'2200.01.01'},outliner:{sectors_summary:{capital_system:'太阳'}},resources:{energy:{stockpile:1000,net:10},alloys:{stockpile:1000,net:10}}}),
  get_fleet_tactics:()=>({fleets:[{fleet_id:0,total_ships:5,system_id:0}]}),
  get_war_fleets:()=>({success:true,fleets:[{fleet_id:0,ship_class:'shipclass_military',total_ships:5},{fleet_id:1,ship_class:'shipclass_transport',embarked_armies:3}]}),
  get_system:p=>({id:p.system_id,player_claims:1,owner_id:p.system_id===0?0:2,planets:[{id:0,colony_id:0,owner_id:2}],fleets:[{id:0,own:true},{id:1,own:true}]}),
  find_path:()=>({reachable:true}),
  get_attack_options:()=>({options:[{goal_key:'wg_conquest',legal:true}]}),
  get_landing_options:()=>({success:true,legal:true}),
  get_peace_options:()=>({options:[{outcome:'demand_surrender',legal:true}]}),
  get_invasion_state:p=>({success:true,planet_id:p.planet_id,owned_by_player:owned,occupied_by_player:occupied,owner_id:owned?0:2,controller_id:occupied||owned?0:2}),
  get_wars:()=>({wars}),
  declare_war:()=>{wars=[{war_id:0,player_side:'attacker',primary_attacker_id:0,primary_defender_id:2,attacker_goal:{key:'wg_conquest'}}];return {success:true};},
  land_armies:()=>{occupied=true;return {success:true};},
  offer_peace:()=>{wars=[];owned=true;return {success:true};}
 });
 await game.campaign({operation:'select',target:2,reason:'取得殖民地与通道',reviewDate:'2201.01.01'});
 await game.campaign({operation:'start',fleetId:0,transportId:1,rallySystem:0,targetSystem:9,planets:[0],goalKey:'wg_conquest',finishDate:'2202.01.01'});
 // The normal wait entry keeps executing the saved campaign without asking the
 // model to issue another stage command after every trip or phase transition.
 for(let i=0;i<10&&game.gestalt.data.campaign.phase!=='completed';i++)await game.watch(0.01);
 assert.equal(game.gestalt.data.campaign.phase,'completed');
 assert.equal(game.gestalt.data.campaign.result.success,true);
 for(const cmd of ['declare_war','land_armies','offer_peace'])assert.equal(calls.filter(c=>c.method===cmd).length,1);
 assert.ok(game.lastState.gestalt.campaign.history.some(h=>h.phase==='recover'));
});

test('native war candidates reject stale declarations and illegal landings before any write',async t=>{
 const {game,calls}=await fixture(t,{get_attack_options:()=>({options:[{goal_key:'wg_conquest',legal:false}]}),get_landing_options:()=>({success:true,legal:false,reason:'没有搭载陆军'})});
 for(const order of [{command:'declare_war',arguments:{country_id:0,goal_key:'wg_conquest'}},{command:'land_armies',arguments:{fleet_id:0,planet_id:0}}]){
  const r=await game.apply({requestId:'invalid-'+order.command,snapshotId:game.snapshotId,orders:[order]});assert.equal(r.orders[0].status,'rejected');
 }
 assert.equal(calls.filter(c=>['declare_war','land_armies'].includes(c.method)).length,0);
 assert.throws(()=>validateOrder({command:'offer_peace',arguments:{war_id:0,outcome:'force_victory'}}));
});

test('combat revision uses verified reserve actors, preserves war identity and old unknown outbox writes',async t=>{
 const {game}=await fixture(t,{get_wars:()=>({wars:[{war_id:0,primary_attacker_id:0,primary_defender_id:2}]}),get_fleet_tactics:()=>({fleets:[{fleet_id:2,total_ships:5,system_id:0}]}),get_war_fleets:()=>({success:true,fleets:[{fleet_id:2,ship_class:'shipclass_military'},{fleet_id:3,ship_class:'shipclass_transport',embarked_armies:4}]})});
 const oldOrder={command:'land_armies',arguments:{fleet_id:1,planet_id:9}};
 const pending=await game.gestalt.prepare(oldOrder,game.lastState);await game.gestalt.receipt(pending,'unknown');
 game.gestalt.data.campaign={enabled:true,phase:'combat',target:2,warId:0,participants:{attacker:0,defender:2},history:[],execution:{fleetId:0,transportId:1,minShips:2,planets:[9],targetSystem:8,finishDate:'2201.01.01'},actions:{'land-9':{status:'unknown',order:oldOrder},declare:{status:'posted'}},baseline:{ships:3}};
 await game.campaign({operation:'revise',fleetId:2,transportId:3,finishDate:'2202.01.01',reason:'接替受损的前线部队'});
 const c=game.gestalt.data.campaign;
 assert.equal(c.warId,0);assert.equal(c.target,2);assert.equal(c.execution.fleetId,2);assert.equal(c.execution.transportId,3);assert.equal(c.actions['land-9'],undefined);assert.equal(c.revisions[0].actions['land-9'].status,'unknown');assert.equal(pending.status,'unknown');assert.equal(c.baseline.ships,5);
 await assert.rejects(game.campaign({operation:'revise',target:7,reason:'换敌人'}),/不能替换/);
});

test('a deficit permits affordable replacement only with actual shipyard design costs and naval headroom',async t=>{
 const {game,calls}=await fixture(t,{
  get_status:()=>({in_game:true,date:{formatted:'2200.01.01'},outliner:{sectors_summary:{capital_system:'太阳'}},stats:{naval_capacity:{used:25,capacity:100}},resources:{alloys:{stockpile:1000,net:-10,expense:20}}}),
  get_military_fleets:()=>({fleets:[{fleet_id:0}]}),
  get_fleets:()=>({fleets:[{fleet_id:0,command_limit:50,template_size:30,designs:[{design_id:0,actual_count:5,target_quota:6,naval_size:5}]}]}),
  get_fleet_tactics:()=>({fleets:[{fleet_id:0,actual_naval_size:25,command_limit:50}]}),
  get_buildable_ships:()=>({buildable:[{design_id:0,naval_size:5,cost:{alloys:100}}],queue:[]})
 });
 const r=await game.apply({requestId:'restore-losses',snapshotId:game.snapshotId,orders:[{command:'reinforce_fleet',arguments:{fleet_id:0}}]});
 assert.equal(r.orders[0].status,'posted');assert.equal(calls.filter(c=>c.method==='reinforce_fleet').length,1);assert.ok(calls.some(c=>c.method==='get_buildable_ships'));
});

test('persistent tasks are dispatched through the existing apply and observation path',async t=>{
  const {game,calls}=await fixture(t);
  await game.task({operation:'add',task:{goal:'调整速度',orders:[{command:'set_speed',arguments:{speed:1}}]}});
  const result=await game.task({operation:'run'});
  assert.equal(result.orders[0].status,'posted');
  assert.ok(calls.some(c=>c.method==='set_speed'));
  assert.equal(result.state.gestalt.tasks.length,1);
  game.cancelPresentation();
  await assert.rejects(game.task({operation:'run'}));
});

test('write-ahead intent is durable before the native mutation',async t=>{
  let game;
  ({game}=await fixture(t,{set_speed:async()=>{
    const files=await import('node:fs/promises').then(fs=>fs.readdir(game.directory));
    const file=files.find(f=>/^gestalt-.*\.json$/.test(f));
    const saved=JSON.parse(await readFile(join(game.directory,file),'utf8'));
    assert.equal(saved.actions.at(-1).status,'issued');return {success:true};
  }}));
  const result=await game.apply({requestId:'durable-speed',snapshotId:game.snapshotId,orders:[{command:'set_speed',arguments:{speed:1}}]});
  assert.equal(result.orders[0].status,'posted');
});

test('native orders preserve valid zero IDs and reject missing, invented and malformed parameters', () => {
  assert.equal(validateOrder({command: 'build_district', arguments: {planet_id: 0, district_key: 'district_city'}}).arguments.planet_id, 0);
  for (const order of [
    {command: 'run_console', arguments: {command: 'cash'}},
    {command: 'build_district', arguments: {district_key: 'district_city'}},
    {command: 'survey', arguments: {fleet_id: 1, system_id: 0, force: true}},
    {command: 'survey', arguments: {fleet_id: true, system_id: 0}},
    {command: 'select_research', arguments: {slot: 'invalid', tech_key: 'tech_x'}},
  ]) assert.throws(() => validateOrder(order));
});

test('capital upgrades use owned live candidates and preserve queued versus completed tracking',async t=>{
  let upgraded=false,posted=false;
  const {game,calls,advance}=await fixture(t,{
    get_status:()=>({in_game:true,date:{formatted:'2324.01.01'},outliner:{sectors_summary:{capital_system:'太阳',sectors:[{colonies_summary:[{planet_id:0,colony_id:0}]}]}}}),
    get_building_upgrade_candidates:()=>({success:true,planet_id:0,colony_id:0,queue_id:0,candidates:[{building_id:0,zone_id:0,current_key:'building_capital',upgrade_key:'building_major_capital',can_upgrade:true}]}),
    get_planet_details:()=>({planet_id:0,districts:[{zones:[{buildings:[{id:0,key:upgraded?'building_major_capital':'building_capital',status:'built'}]}]}],construction_queue:posted&&!upgraded?[{item_id:9,building_id:0,type:'building_upgrade',key:'building_major_capital',progress_percent:0}]:[]}),
    upgrade_building:params=>{assert.deepEqual(params,{planet_id:0,building_id:0,upgrade_to_key:'building_major_capital'});posted=true;return {success:true,building_id:0,queue_id:0,queue_item_id:9,upgrade_to_key:'building_major_capital'};}
  });
  const list=await game.inspect({topic:'upgrades',id:0});assert.equal(list.candidates[0].can_upgrade,true);
  const r=await game.apply({requestId:'upgrade-zero',snapshotId:game.snapshotId,orders:[{command:'upgrade_building',arguments:{planet_id:0,building_id:0,upgrade_key:'building_major_capital'}}]});
  assert.equal(r.orders[0].status,'posted');assert.equal(r.orders[0].verification.completed,false);assert.equal(r.state.orderTracking.counts.queued,1);
  upgraded=true;advance(6000);const state=await game.observe();assert.equal(state.orderTracking.counts.completed,1);assert.equal(calls.filter(x=>x.method==='upgrade_building').length,1);
  const ledger=JSON.parse(await readFile(resolve(game.directory,`orders-${game.sessionId}.json`),'utf8'));assert.equal(ledger.records[0].status,'completed');
});
test('foreign or unlisted capital upgrades never reach the native mutation',async t=>{
 const {game,calls}=await fixture(t,{get_status:()=>({in_game:true,date:{formatted:'2324.01.01'},outliner:{sectors_summary:{capital_system:'太阳',sectors:[{colonies_summary:[{planet_id:0}]}]}}}),get_building_upgrade_candidates:()=>({success:true,planet_id:0,colony_id:0,queue_id:0,candidates:[]})});
 for(const planet_id of [0,548]){const r=await game.apply({requestId:'not-upgrade-'+planet_id,snapshotId:game.snapshotId,orders:[{command:'upgrade_building',arguments:{planet_id,building_id:0,upgrade_key:'invented_capital'}}]});assert.equal(r.orders[0].status,'rejected');}
 assert.equal(calls.filter(x=>x.method==='upgrade_building').length,0);
});

test('building commands accept actual large zone IDs and refuse guessed zone sequence numbers before posting',async t=>{
  const zoneId=33554590;
  const {game,calls}=await fixture(t,{
    get_status:()=>({in_game:true,is_paused:true,date:{formatted:'2200.01.01'},
      outliner:{sectors_summary:{capital_system:'太阳',sectors:[{colonies_summary:[{planet_id:0}]}]}}}),
    get_buildable_buildings:()=>({success:true,planet_id:0,zones:[{zone_id:zoneId,district:'district_city',buildings:0,max_buildings:3,buildable:[{key:'building_factory_1'}]}]})});
  const order={command:'build_building',arguments:{planet_id:0,building_key:'building_factory_1',district_type:'district_city',slot_index:zoneId}};
  assert.equal(validateOrder(order).arguments.slot_index,zoneId);
  const accepted=await game.apply({requestId:'full-zone',snapshotId:game.snapshotId,orders:[order]});assert.equal(accepted.orders[0].status,'posted');
  const rejected=await game.apply({requestId:'guessed-zone',snapshotId:game.snapshotId,orders:[{...order,arguments:{...order.arguments,slot_index:1}}]});assert.equal(rejected.orders[0].status,'rejected');assert.match(rejected.orders[0].error,/完整 zone_id/);assert.equal(calls.filter(x=>x.method==='build_building').length,1);assert.equal(calls.find(x=>x.method==='build_building').params.slot_index,zoneId);
});

test('full or incompatible building zones never receive a build command',async t=>{
  const {game,calls}=await fixture(t,{get_buildable_buildings:()=>({success:true,zones:[{zone_id:0,district:'district_city',buildings:3,max_buildings:3,buildable:[{key:'building_factory_1'}]},{zone_id:1,district:'district_city',buildings:0,max_buildings:3,buildable:[]}]})});
  for(const slot of [0,1]){const result=await game.apply({requestId:`full-${slot}`,snapshotId:game.snapshotId,orders:[{command:'build_building',arguments:{planet_id:0,building_key:'building_factory_1',district_type:'district_city',slot_index:slot}}]});assert.equal(result.orders[0].status,'rejected');}
  assert.equal(calls.filter(x=>x.method==='build_building').length,0);
});

test('deficit economy blocks routine outposts but never blocks repairs, and healthy recovery permits contiguous expansion',async t=>{
  let healthy=false;
  const {game,calls,advance}=await fixture(t,{
    get_status:()=>({in_game:true,date:{formatted:'2200.01.01'},outliner:{sectors_summary:{capital_system:'太阳'}},resources:{energy:{stockpile:1000,net:10},minerals:{stockpile:500,net:20},alloys:{stockpile:1000,net:20},influence:{stockpile:200,net:3},food:{stockpile:20,net:healthy?2:-2}},stats:{empire_size:600}}),
    find_systems:p=>({purpose:p.purpose,systems:[{id:5,can_build:true,surveyed:true,borders_own_space:true}]}),find_path:()=>({reachable:true,from_system_id:0})
  });
  assert.equal(game.lastState.strategy.mode,'stabilize');
  const outpost={command:'build_outpost',arguments:{fleet_id:1,system_id:5}};
  const failed=await game.apply({requestId:'deficit-outpost',snapshotId:game.snapshotId,orders:[outpost,{command:'build_district',arguments:{planet_id:0,district_key:'district_farming'}}]});assert.equal(failed.orders[0].status,'rejected');assert.equal(failed.orders[1].status,'posted');assert.equal(calls.filter(x=>x.method==='build_outpost').length,0);
  healthy=true;advance(61000);await game.observe();const accepted=await game.apply({requestId:'recovered-outpost',snapshotId:game.snapshotId,orders:[outpost]});assert.equal(accepted.orders[0].status,'posted');assert.equal(calls.filter(x=>x.method==='build_outpost').length,1);
});

test('red or unknown habitability and exhausted influence do not permit expansion in an otherwise healthy economy',async t=>{
  let influence=200,habitability=35;
  const {game,calls,advance}=await fixture(t,{
    get_status:()=>({in_game:true,date:{formatted:'2200.01.01'},outliner:{sectors_summary:{capital_system:'太阳'}},resources:{energy:{stockpile:1000,net:10},minerals:{stockpile:1000,net:10},alloys:{stockpile:1000,net:10},influence:{stockpile:influence,net:3}},stats:{}}),
    get_planet_details:()=>({system_id:5}),
    find_systems:p=>({purpose:p.purpose,planets:[{planet_id:0,system_owned:true,can_colonize:true,habitability_percent:habitability}],systems:[{id:5,can_build:true,surveyed:true,borders_own_space:true}]}),find_path:()=>({reachable:true,from_system_id:0})
  });
  const colonize={command:'colonize',arguments:{fleet_id:1,planet_id:0}};
  const red=await game.apply({requestId:'red-planet',snapshotId:game.snapshotId,orders:[colonize]});assert.equal(red.orders[0].status,'rejected');
  habitability=undefined;advance(61000);await game.observe();const unknown=await game.apply({requestId:'unknown-planet',snapshotId:game.snapshotId,orders:[colonize]});assert.equal(unknown.orders[0].status,'rejected');assert.equal(calls.filter(x=>x.method==='colonize').length,0);
  influence=10;const outpost=await game.apply({requestId:'empty-influence',snapshotId:game.snapshotId,orders:[{command:'build_outpost',arguments:{fleet_id:1,system_id:5}}]});assert.match(outpost.orders[0].error,/影响力/);assert.equal(calls.filter(x=>x.method==='build_outpost').length,0);
});

test('pending first-contact HUD stage is surfaced as a real central choice before planning', async t => {
  let opened=false;
  const {game,calls}=await fixture(t,{
    get_alerts:()=>[{alert_id:38,type:'alert_first_contact_stage_done'}],
    get_active_events:()=>opened?[{window_id:0xFFFF0003,title:'接触事件',kind:'first_contact_choice',first_contact_id:7}]:[],
    open_alert:()=>{opened=true;return {success:true};}
  });
  assert.equal(game.lastState.pendingEvents[0].kind,'first_contact_choice');
  assert.equal(game.lastState.pendingEvents[0].first_contact_id,7);
  assert.ok(calls.some(x=>x.method==='open_alert'&&x.params.alert_id===38));
});

test('closing a first-contact panel is not verified as completing its decision', async t => {
  let pending=true;
  const {game}=await fixture(t,{get_alerts:()=>pending?[{alert_id:38,type:'alert_first_contact_stage_done'}]:[],get_active_events:()=>[]});
  const order={command:'resolve_event',arguments:{window_id:0xFFFF0003,option_index:0}};
  assert.equal((await game.verifyOrder(order,order.arguments,{phase:'first_contact_information_closed'})).verified,false);
  assert.equal((await game.verifyOrder(order,order.arguments,{phase:'first_contact_choice_posted'})).verified,false);
  pending=false;
  assert.equal((await game.verifyOrder(order,order.arguments,{phase:'first_contact_choice_posted'})).verified,true);
});

test('observing a dismissed first-contact information panel does not reopen the same HUD alert',async t=>{
 let opened=0,visible=false;
 const {game}=await fixture(t,{get_alerts:()=>[{alert_id:38,type:'alert_first_contact_stage_done',description:'阶段1'}],get_active_events:()=>visible?[{window_id:0xFFFF0003,kind:'first_contact_information'}]:[],open_alert:()=>{opened++;visible=true;return {success:true};}});
 assert.equal(opened,1);visible=false;
 await game.observe();await game.observe();assert.equal(opened,1);assert.deepEqual(game.lastState.pendingEvents,[]);
});

async function fixture(t, override = {},timing={}) {
  const directory = await mkdtemp(join(tmpdir(), 'cyberfish-native-'));
  let now = Date.now() + 1000;
  const calls = [];
  const pipe = {async request(method, params) {
    calls.push({method, params,presentationAt:presentationTime});
    if (override[method]) return override[method](params);
    if(method==='ping')return {bridge_version:timing.colonyUpgradePilot&&!timing.surveyPilot?'cyberfish-0.6.11-upgrade-paths-r1':timing.hybridSurvey?'cyberfish-0.6.7-survey-pilot-r1':'cyberfish-0.6.6-gestalt-war-r1',features:['building_upgrade_candidates','building_upgrade_queue_identity','ship_design_naval_size','zone_building_membership','owned_shipyard_queues','engine_market_transaction_quotes','normal_war_actions',...(timing.hybridSurvey?['native_survey_automation_candidate']:[]),...(timing.colonyUpgradePilot&&!timing.surveyPilot?['native_survey_automation_candidate','monthly_trade_read_coverage_candidate','engine_monthly_trade_quotes','building_upgrade_string_paths']:[])]};
    if (method === 'get_status') return {in_game: true, date: {formatted: '2200.01.01'}, outliner: {sectors_summary: {capital_system: '太阳'}}};
    if(method==='get_active_events'||method==='get_alerts')return [];
    if(method==='get_wars')return {wars:[],warGoalsWindow:false};
    if (method === 'get_galaxy_overview') return {player: {country_id: 0, capital_system_id: 0}};
    if (method === 'get_civilian_fleets') return {science_ships: [{fleet_id: 1}]};
    if (method === 'get_research_state') return {};
    if (method === 'get_buildable_ships') return {queue:[],buildable:[]};
    if(method==='get_shipyards')return {success:true,coverage_complete:true,coverage_scope:'owned_system_starbase_shipyards',shipyards:[{system_id:0,starbase_id:0,queue_id:0,owner_id:0,has_shipyard:true,queue_complete:true,naval_costs_complete:true,...(override.get_buildable_ships?await override.get_buildable_ships({system_id:0}):{queue:[],buildable:[]})}]};
    if (method === 'get_picture_state') return {rendering: true, visible: true, frames: 1};
    if (method === 'focus_fleet') return {success: true, camera_target_id: params.fleet_id};
    if(method==='focus_planet')return {success:true,camera_target_id:params.planet_id};
    return {success: true};
  }, close() {}};
  const processReader = async request => ['identity','bound_identity'].includes(request.op) ? {pid: 42, creationTime: 'fixed'} : {fleets: request.fleetIds.map(fleetId => ({fleetId, shipIds: [1241]}))};
  let presentationTime=0;
  const game = new NativeGame({nativeCountryAI:timing.nativeCountryAI===true,nativeCountryAIEconomyCandidate:timing.nativeCountryAIEconomyCandidate===true,maximumGameSpeed:timing.maximumGameSpeed??5,pipe, directory, stopFile:join(directory,'STOP'),guidanceFile:join(directory,'game-guidance.json'),now: () => now, processReader,hybridSurvey:timing.hybridSurvey===true,surveyPilot:timing.surveyPilot===true,colonyUpgradePilot:timing.colonyUpgradePilot===true,monthlyLifecyclePilot:timing.monthlyLifecyclePilot===true,localWaitPilot:timing.localWaitPilot===true,presentationClock:()=>presentationTime,presentationWait:async ms=>{presentationTime+=ms;await timing.onWait?.(presentationTime,game);}});
  await game.start(); t.after(async () => {
    await game.stop();
    assert.equal(dirname(directory), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('cyberfish-native-'));
    await rm(directory, {recursive: true, force: true});
  });
  return {game, calls, advance: ms => now += ms};
}

test('an idempotent repeated request submits exactly once; a changed payload is refused', async t => {
  const {game, calls} = await fixture(t);
  const request = {requestId: 'one', snapshotId: game.snapshotId, orders: [{command: 'build_district', arguments: {planet_id: 0, district_key: 'district_city'}}]};
  await game.apply(request); await game.apply(request);
  assert.equal(calls.filter(x => x.method === 'build_district').length, 1);
  await assert.rejects(game.apply({...request, orders: [{command: 'set_speed', arguments: {speed: 2}}]}), /内容不能改变/);
});

test('strategy advice reaches observations once per ID, without submitting a game command',async t=>{
  const {game,calls,advance}=await fixture(t);
  // Use an isolated child directory so the test never writes a shared temp advisory file.
  game.directory=join(game.directory,'bridge');await mkdir(game.directory,{recursive:true});
  const isolated=resolve(game.directory,'../commentary');await mkdir(isolated,{recursive:true});
  await writeFile(join(isolated,'strategy-directive.json'),JSON.stringify({version:1,source:'cyberfish-ai-hub',id:'d1',at:game.now(),gameSessionId:game.sessionId,text:'先补科研',orders:[{command:'build_ship'}]}));
  calls.length=0;const state=await game.observe();assert.equal(state.operationalGoal.text,'先补科研');assert.ok(!state.operationalGoal.orders);assert.ok(!state.operationalGoal.id);assert.ok(!state.strategistAdvice);
  await game.observe();const rows=(await readFile(game.journal,'utf8')).trim().split('\n').map(JSON.parse);assert.equal(rows.filter(x=>x.type==='strategy_advice_read').length,1);
  assert.ok(calls.every(x=>x.method.startsWith('get_')));game.ends+=600001;advance(600001);assert.ok(!(await game.observe()).operationalGoal);
});

test('expired observations never submit commands', async t => {
  const {game, calls, advance} = await fixture(t); advance(61000);
  await assert.rejects(game.apply({requestId: 'old', snapshotId: game.snapshotId, orders: [{command: 'set_speed', arguments: {speed: 2}}]}), /过期/);
  assert.equal(calls.filter(x => x.method === 'set_speed').length, 0);
});

test('checkpoint freshness follows a real observation so live commentary can distinguish history',async t=>{
  const {game,advance}=await fixture(t);let saved=JSON.parse(await readFile(resolve(game.directory,'latest-session.json'),'utf8'));assert.equal(saved.observedAt,game.snapshotAt);
  const before=saved.observedAt;advance(1500);await game.observe();saved=JSON.parse(await readFile(resolve(game.directory,'latest-session.json'),'utf8'));assert.ok(saved.observedAt>before);assert.equal(saved.observedAt,game.snapshotAt);
});

test('a slow model pauses game time locally and requires fresh state before an order',async t=>{
  let paused=false;
  const {game,calls}=await fixture(t,{get_status:()=>({in_game:true,is_paused:paused,date:{formatted:'2200.01.01'},outliner:{sectors_summary:{capital_system:'太阳'}}}),set_paused:p=>{paused=p.paused;return {success:true};}});
  calls.length=0;await game.monitorDecision(9000);assert.equal(paused,true);assert.ok(game.needsDecisionRefresh);
  const request={requestId:'after-slow',snapshotId:game.snapshotId,orders:[{command:'set_speed',arguments:{speed:2}}]};
  await assert.rejects(game.apply(request),/先 observe/);assert.ok(!calls.some(x=>x.method==='set_speed'));
  const state=await game.observe();assert.deepEqual(state.decisionAttention.reasons,['model_response_slow']);assert.equal(game.needsDecisionRefresh,false);
});
test('a new alert pauses immediately, without waiting for the slow-model timeout',async t=>{
  let alerts=[],paused=false;
  const {game,calls}=await fixture(t,{get_alerts:()=>alerts,set_paused:p=>{paused=p.paused;return {success:true};}});
  calls.length=0;await game.monitorDecision(1000);assert.ok(!calls.some(x=>x.method==='set_paused'));
  alerts=[{type:'hostile_fleet_detected'}];await game.monitorDecision(1200);assert.equal(paused,true);assert.deepEqual(game.decisionPause.reasons,['new_alert']);
  const before=calls.filter(x=>x.method==='set_paused').length;await game.watch(0);assert.equal(calls.filter(x=>x.method==='set_paused').length,before);assert.equal(game.needsDecisionRefresh,false);
});

test('the local monitor pauses and closes an expired session while the model is still thinking',async t=>{
  const {game,calls,advance}=await fixture(t);calls.length=0;advance(600001);await game.monitorDecision(9000);
  assert.equal(game.stopped,true);assert.ok(calls.some(x=>x.method==='set_paused'&&x.params.paused===true));await assert.rejects(game.observe(),/停止/);
});

test('research areas are explicit; scientific leadership resolves the ship, not the fleet handle', async t => {
  const {game, calls} = await fixture(t,{get_research_state:()=>({engineering:{current:null,candidates:[{key:'tech_mining_1'}]}})});
  await game.apply({requestId: 'mapped', snapshotId: game.snapshotId, orders: [
    {command: 'select_research', arguments: {slot: 'engineering', tech_key: 'tech_mining_1'}},
    {command: 'assign_scientist', arguments: {leader_id: 0, fleet_id: 1}}
  ]});
  assert.deepEqual(calls.find(x => x.method === 'select_research').params, {area: 'engineering', tech_key: 'tech_mining_1'});
  assert.deepEqual(calls.find(x => x.method === 'assign_leader').params, {leader_id: 0, assignment_type: 2, target_id: 1241});
});

test('unknown execution result prevents all later mutations and is never replayed', async t => {
  const {game, calls} = await fixture(t, {build_district() {throw new Error('transport timeout');}});
  const request = {requestId: 'uncertain', snapshotId: game.snapshotId, orders: [{command: 'build_district', arguments: {planet_id: 0, district_key: 'district_city'}}]};
  const result = await game.apply(request);
  assert.equal(result.orders[0].status, 'unknown');
  assert.equal(result.orders[0].tracking.submissionConfirmed,false);
  assert.equal(game.lastState.orderTracking.counts.submitted,1);
  await game.apply(request);
  await assert.rejects(game.apply({...request, requestId: 'again', snapshotId: game.snapshotId}), /未知/);
  assert.equal(calls.filter(x => x.method === 'build_district').length, 1);
  await game.stop();
  const ledger=JSON.parse(await readFile(resolve(game.directory,`orders-${game.sessionId}.json`),'utf8'));
  assert.equal(ledger.records[0].status,'expired_unknown');
  assert.equal(game.lastState.orderTracking.counts.expired_unknown,1);
});

test('missing planet ID is rejected before querying a default entity', async t => {
  const {game, calls} = await fixture(t);
  await assert.rejects(game.inspect({topic: 'buildings'}), /需要 id/);
  assert.equal(calls.filter(x => x.method === 'get_buildable_buildings').length, 0);
});

test('expired unknown async orders remain blocked even with a new request ID',async t=>{
 const {game,calls}=await fixture(t);
 const order={command:'build_district',arguments:{planet_id:0,district_key:'district_city'}};
 await game.apply({requestId:'expire-first',snapshotId:game.snapshotId,orders:[order]});
 game.orderTracker.maxPolls=0;await game.observe();
 const retry=await game.apply({requestId:'expire-retry',snapshotId:game.snapshotId,orders:[order]});
 assert.equal(retry.orders[0].status,'unconfirmed_not_replayed');
 assert.equal(calls.filter(x=>x.method==='build_district').length,1);
});

test('a diagnostic write failure never prevents stop from pausing, closing and unlocking',async t=>{
 const {game,calls}=await fixture(t);
 await game.apply({requestId:'stop-pending',snapshotId:game.snapshotId,orders:[{command:'build_district',arguments:{planet_id:0,district_key:'district_city'}}]});
 let closed=false;game.pipe.close=()=>{closed=true;};game.log=async()=>{throw Error('disk full');};
 await game.stop();assert.equal(closed,true);assert.equal(game.lastState.orderTracking.counts.expired_unknown,1);
 assert.ok(calls.some(x=>x.method==='set_paused'&&x.params.paused));
 await assert.rejects(readFile(game.lockPath),{code:'ENOENT'});
});

test('a second writer cannot acquire a live controller lock', async t => {
  const {game} = await fixture(t);
  const second = new NativeGame({directory: game.directory,stopFile:join(game.directory,'STOP'),guidanceFile:join(game.directory,'game-guidance.json')});
  await assert.rejects(second.start(), /已有控制器/);
});

test('a refreshed recruitment pool is rejected without any hire attempt or write freeze', async t => {
  const {game, calls} = await fixture(t, {get_leaders() {return {pool_candidates: [{id: 8}]};}});
  const result = await game.apply({requestId: 'stale-hire', snapshotId: game.snapshotId, orders: [{command: 'hire_leader', arguments: {candidate_id: 7}}]});
  assert.equal(result.orders[0].status, 'rejected'); assert.equal(game.uncertain, false);
  assert.equal(calls.filter(row => row.method === 'hire_leader').length, 0);
});

test('unknown writes can recover from fresh reads without replaying the old intent', async t => {
  const {game, calls} = await fixture(t, {
    build_district() {throw new Error('transport timeout');},
    get_status() {return {in_game: true, is_paused: true, date: {formatted: '2200.01.01'}, outliner: {sectors_summary: {capital_system: '太阳'}}};}
  });
  const order = {command: 'build_district', arguments: {planet_id: 0, district_key: 'district_city'}};
  await game.apply({requestId: 'lost', snapshotId: game.snapshotId, orders: [order]});
  const recovered = await game.watch(0);
  assert.equal(recovered.recovery.replayed, false); assert.equal(game.uncertain, false);
  await game.apply({requestId: 'new-id-same-intent', snapshotId: game.snapshotId, orders: [order]});
  assert.equal(calls.filter(row => row.method === 'build_district').length, 1);
  await game.apply({requestId: 'other-task', snapshotId: game.snapshotId, orders: [{command: 'set_speed', arguments: {speed: 2}}]});
  assert.equal(calls.filter(row => row.method === 'set_speed').length, 1);
});

test('hidden or minimized game picture pauses before any gameplay mutation', async t => {
  let visible=true;
  const {game,calls}=await fixture(t,{get_picture_state(){return {rendering:true,visible,minimized:!visible};}});
  visible=false;
  await assert.rejects(game.apply({requestId:'hidden',snapshotId:game.snapshotId,orders:[{command:'build_ship',arguments:{system_id:0,design_id:3}}]}),/画面不可见/);
  assert.equal(calls.filter(x=>x.method==='build_ship').length,0);
  assert.ok(calls.some(x=>x.method==='set_paused' && x.params.paused===true));
});

test('a rejected independent order does not discard later legal work in the batch', async t => {
  const {game,calls}=await fixture(t,{survey(){return {success:false,error:'No route'};}});
  const result=await game.apply({requestId:'continue-independent',snapshotId:game.snapshotId,orders:[{command:'survey',arguments:{fleet_id:1,system_id:9}},{command:'build_district',arguments:{planet_id:0,district_key:'district_city'}}]});
  assert.equal(result.orders[0].status,'rejected');assert.equal(result.orders[1].status,'posted');
  assert.equal(calls.filter(x=>x.method==='build_district').length,1);
});

test('verified transaction totals restore trading and override misleading cheap base prices',async t=>{
 let food=500,cash=1000,total=200,writes=0;
 const {game}=await fixture(t,{
  get_market:()=>({settlement_currency:'trade',resources:[{key:'food',batch_size:100,buy_price_per_unit:.01,sell_price_per_unit:999}]}),
  get_status:()=>({in_game:true,is_paused:true,date:{formatted:'2200.01.01'},outliner:{sectors_summary:{capital_system:'太阳'}},resources:{food:{stockpile:food,max:2000,net:1,expense:10},trade:{stockpile:cash,max:2000,net:1,expense:100}}}),
  get_market_quote:p=>({success:true,price_basis:'engine_transaction_total',resource:p.resource,action:p.action,units:p.units,settlement_currency:'trade',total,includes_fee:true}),
  market_trade:()=>{writes++;food+=100;cash-=total;return {success:true}}
 });
 const good=await game.apply({requestId:'quoted-real',snapshotId:game.snapshotId,orders:[{command:'market_trade',arguments:{resource:'food',action:'buy',units:100}}]});
 assert.equal(good.orders[0].status,'posted');assert.equal(good.orders[0].verification.verified,true);assert.equal(writes,1);
 total=701;
 const blocked=await game.apply({requestId:'quoted-too-expensive',snapshotId:game.snapshotId,orders:[{command:'market_trade',arguments:{resource:'food',action:'buy',units:200}}]});
 assert.equal(blocked.orders[0].status,'rejected');assert.match(blocked.orders[0].error,/维护底线/);assert.equal(writes,1);
});

test('actual upkeep replaces fixed trade reserves and the paused quote is reused at the final budget gate',async t=>{
 let food=3062,cash=1971.51;const {game,calls}=await fixture(t,{
  get_status:()=>({in_game:true,is_paused:true,date:{formatted:'2200.01.01'},outliner:{sectors_summary:{capital_system:'太阳'}},resources:{food:{stockpile:food,max:15000,net:95,expense:52.78},trade:{stockpile:cash,max:50000,net:59.67,expense:119.34}}}),
  get_market:()=>({settlement_currency:'trade',resources:[{key:'food',batch_size:100}]}),
  get_market_quote:p=>({success:true,resource:p.resource,action:p.action,units:p.units,settlement_currency:'trade',total:70,price_basis:'engine_transaction_total',includes_fee:true}),
  market_trade:p=>{food-=p.units;cash+=70;return {success:true};}
 });
 const result=await game.apply({requestId:'surplus-sale',snapshotId:game.snapshotId,orders:[{command:'market_trade',arguments:{resource:'food',action:'sell',units:100}}]});
 assert.equal(result.orders[0].status,'posted');assert.equal(food,2962);assert.equal(calls.filter(c=>c.method==='get_market_quote').length,1);
 const admission=game.gestalt.data.actions[0].spendingAdmission;assert.equal(admission.upkeep.reserved,52.78);assert.equal(admission.basis,'engine_quote_and_actual_upkeep');
});

test('a quote that ages during durable intent is refreshed and cannot spend through an increased actual price',async t=>{
 let total=200;const {game,calls,advance}=await fixture(t,{
  get_status:()=>({in_game:true,is_paused:true,date:{formatted:'2200.01.01'},outliner:{sectors_summary:{capital_system:'太阳'}},resources:{food:{stockpile:500,max:15000,net:95,expense:52.78},trade:{stockpile:1000,max:50000,net:50,expense:100}}}),
  get_market:()=>({settlement_currency:'trade',resources:[{key:'food',batch_size:100}]}),
  get_market_quote:p=>({success:true,resource:p.resource,action:p.action,units:p.units,settlement_currency:'trade',total,price_basis:'engine_transaction_total',includes_fee:true})
 });
 const prepare=game.gestalt.prepare.bind(game.gestalt);game.gestalt.prepare=async(...args)=>{const result=await prepare(...args);advance(5001);total=1001;return result;};
 const result=await game.apply({requestId:'aged-trade',snapshotId:game.snapshotId,orders:[{command:'market_trade',arguments:{resource:'food',action:'buy',units:100}}]});
 assert.equal(result.orders[0].status,'deferred');assert.equal(result.orders[0].nativeWriteAttempted,false);assert.equal(calls.filter(c=>c.method==='get_market_quote').length,2);assert.equal(calls.filter(c=>c.method==='market_trade').length,0);assert.notEqual(game.uncertain,true);
});

test('stop drains an ordinary trade quote before cleanup can reuse the single native connection',async t=>{
 let entered,release;const enteredQuote=new Promise(done=>entered=done),heldQuote=new Promise(done=>release=done);
 const {game,calls}=await fixture(t,{
  get_status:()=>({in_game:true,is_paused:true,date:{formatted:'2200.01.01'},outliner:{sectors_summary:{capital_system:'太阳'}},resources:{food:{stockpile:500,max:15000,net:95,expense:52.78},trade:{stockpile:1000,max:50000,net:50,expense:100}}}),
  get_market:()=>({settlement_currency:'trade',resources:[{key:'food',batch_size:100}]}),
  get_market_quote:async p=>{entered();await heldQuote;return {success:true,resource:p.resource,action:p.action,units:p.units,settlement_currency:'trade',total:200,price_basis:'engine_transaction_total',includes_fee:true};}
 });
 const active=game.apply({requestId:'stop-held-quote',snapshotId:game.snapshotId,orders:[{command:'market_trade',arguments:{resource:'food',action:'buy',units:100}}]});const settled=Promise.allSettled([active]);
 await enteredQuote;const n=calls.length,stopping=game.stop();
 try{
  for(let i=0;i<200&&!game.stopped;i++)await new Promise(done=>setTimeout(done,5));assert.equal(game.stopped,true);
  await new Promise(done=>setTimeout(done,0));
  assert.equal(calls.slice(n).some(c=>c.method==='get_status'||c.method==='set_paused'),false,'清理不能与尚未返回的普通报价请求抢同一连接');
 }finally{release();await settled;await stopping;}
 assert.equal(calls.some(c=>c.method==='market_trade'),false);assert.equal(game.cleanup.pauseConfirmed,true);
});

test('unquoted market trades fail closed even when static estimates appear affordable', async t => {
  const {game,calls}=await fixture(t,{
    get_market(){return {settlement_currency:'trade',resources:[{key:'food',batch_size:100,sell_price_per_unit:0.7,buy_price_per_unit:1.3}]};},
    get_status(){return {in_game:true,date:{formatted:'2200.01.01'},outliner:{sectors_summary:{capital_system:'太阳'}},resources:{food:{stockpile:900,max:1000,net:1},trade:{stockpile:1000,max:2000,net:1}}};}
  });
  for(const [suffix,action,units] of [['reserve','sell',600],['batch','sell',101],['storage','buy',100],['apparently-affordable','buy',1],['apparently-safe-sale','sell',100]]) {
    const result=await game.apply({requestId:suffix,snapshotId:game.snapshotId,orders:[{command:'market_trade',arguments:{resource:'food',action,units}}]});
    assert.equal(result.orders[0].status,'rejected');
    assert.match(result.orders[0].error,/缺少可验证的实时整笔报价/);
  }
  assert.equal(calls.filter(x=>x.method==='market_trade').length,0);
});

test('military actions reject a fleet outside the current owned military list', async t => {
  const {game,calls}=await fixture(t,{get_military_fleets(){return {fleets:[{fleet_id:3}]};}});
  const result=await game.apply({requestId:'foreign',snapshotId:game.snapshotId,orders:[{command:'reinforce_fleet',arguments:{fleet_id:99}}]});
  assert.equal(result.orders[0].status,'rejected'); assert.equal(game.uncertain,false);
  assert.equal(calls.filter(x=>x.method==='reinforce_fleet').length,0);
});

test('diplomatic preconditions and stale proposals cannot submit a command', async t => {
  const {game,calls}=await fixture(t,{get_diplomacy_options(){return {options:[{action:'research_agreement',legal:false,reason:'需要大使馆'}]};},get_pending_diplomacy(){return {pending:[]};}});
  const result=await game.apply({requestId:'pact',snapshotId:game.snapshotId,orders:[{command:'diplomacy',arguments:{country_id:1,action:'research_agreement'}}]});
  assert.equal(result.orders[0].status,'rejected'); assert.match(result.orders[0].error,/大使馆/);
  const response=await game.apply({requestId:'expired-proposal',snapshotId:game.snapshotId,orders:[{command:'respond_diplomacy',arguments:{proposal:'18446744073709551615',accept:true}}]});
  assert.equal(response.orders[0].status,'rejected');
  assert.equal(calls.filter(x=>['diplomacy_action','respond_diplomacy'].includes(x.method)).length,0);
  assert.throws(()=>validateOrder({command:'respond_diplomacy',arguments:{proposal:18446744073709551615,accept:true}}));
  assert.throws(()=>validateOrder({command:'respond_diplomacy',arguments:{proposal:'18446744073709551616',accept:true}}));
});

test('a central event appearing within a batch defers later economy work',async t=>{
  let event=false;
  const {game,calls}=await fixture(t,{
    get_active_events(){return event?[{window_id:8,title:'宣战通知',options:[{index:0,is_valid:true}]}]:[];},
    build_district(){event=true;return {success:true};}
  });
  const result=await game.apply({requestId:'modal-race',snapshotId:game.snapshotId,orders:[
    {command:'build_district',arguments:{planet_id:0,district_key:'district_city'}},
    {command:'set_speed',arguments:{speed:2}}
  ]});
  assert.equal(result.orders[0].status,'posted');assert.equal(result.orders[1].status,'deferred');
  assert.equal(calls.filter(x=>x.method==='set_speed').length,0);
});

test('watch does not advance through an unresolved central window',async t=>{
  let modal=false;
  const {game,calls}=await fixture(t,{get_active_events(){return modal?[{window_id:0,title:'事件'}]:[];}});
  modal=true;const start=calls.length;
  const state=await game.watch(0);
  assert.match(state.needsAttention,/中央窗口/);assert.equal(state.paused,true);
  assert.equal(calls.slice(start).filter(x=>x.method==='set_paused' && x.params.paused===false).length,0);
});

test('a declaration can open goals, choose, close review and confirm in order',async t=>{
  let shown=false,chosen=false,notice=true;
  const {game,calls}=await fixture(t,{
    get_wars(){return {warGoalsWindow:shown,wars:[{war_id:16777216,have_defender_war_goal:chosen,defender_goal:{key:chosen?'wg_humiliation':null}}]};},
    get_active_events(){return notice?[{window_id:1,title:'宣战通知'}]:[];},
    get_war_goal_candidates(){return {candidates:chosen?[]:[{key:'wg_humiliation',legal:true}]};},
    open_war_goals(){shown=true;return {success:true};},
    set_defender_war_goal(){chosen=true;return {success:true};},
    close_war_goals(){shown=false;return {success:true};},
    resolve_event(){notice=false;return {success:true};}
  });
  const result=await game.apply({requestId:'whole-war-dialog',snapshotId:game.snapshotId,orders:[
    {command:'open_war_goals',arguments:{war_id:16777216}},
    {command:'set_defender_war_goal',arguments:{war_id:16777216,goal_key:'wg_humiliation'}},
    {command:'close_war_goals',arguments:{}},
    {command:'resolve_event',arguments:{window_id:1,option_index:0}}
  ]});
  assert.deepEqual(result.orders.map(x=>x.status),['posted','posted','posted','posted']);
  assert.ok(result.orders.every(x=>x.verification.verified));
  assert.equal(result.state.pendingEvents.length,0);assert.equal(result.state.warGoalsWindow,false);
});

test('war goals must be current legal candidates and are verified by full war handle',async t=>{
  let chosen=false;
  const {game,calls}=await fixture(t,{
    get_wars(){return {warGoalsWindow:true,wars:[{war_id:16777216,have_defender_war_goal:chosen,defender_goal:{key:chosen?'wg_humiliation':null}}]};},
    get_war_goal_candidates(){return {candidates:chosen?[]:[{key:'wg_humiliation',legal:true}]};},
    set_defender_war_goal(){chosen=true;return {success:true};}
  });
  const deferred=await game.apply({requestId:'war-first',snapshotId:game.snapshotId,orders:[{command:'set_speed',arguments:{speed:3}}]});
  assert.equal(deferred.orders[0].status,'deferred');
  const picked=await game.apply({requestId:'goal',snapshotId:game.snapshotId,orders:[{command:'set_defender_war_goal',arguments:{war_id:16777216,goal_key:'wg_humiliation'}}]});
  assert.equal(picked.orders[0].verification.verified,true);
  const stale=await game.apply({requestId:'stale-goal',snapshotId:game.snapshotId,orders:[{command:'set_defender_war_goal',arguments:{war_id:0,goal_key:'wg_humiliation'}}]});
  assert.equal(stale.orders[0].status,'rejected');assert.equal(game.uncertain,false);
  assert.equal(calls.filter(x=>x.method==='set_defender_war_goal').length,1);
});

test('fleet quota uses command points and allows normal reduction without disbanding',async t=>{
  let quota=18;
  const {game,calls}=await fixture(t,{
    get_military_fleets(){return {fleets:[{fleet_id:3}]};},
    get_fleets(){return {fleets:[{fleet_id:3,command_limit:70,template_size:quota*5,designs:[{design_id:0,target_quota:quota,actual_count:8,naval_size:5}]}]};},
    set_fleet_template_quota(p){quota=p.target_quota;return {success:true};}
  });
  const over=await game.apply({requestId:'over-limit',snapshotId:game.snapshotId,orders:[{command:'increase_fleet_quota',arguments:{fleet_id:3,design_id:0,target_quota:20}}]});
  assert.equal(over.orders[0].status,'rejected');
  const reduce=await game.apply({requestId:'reduce',snapshotId:game.snapshotId,orders:[{command:'decrease_fleet_quota',arguments:{fleet_id:3,design_id:0,target_quota:14}}]});
  assert.equal(reduce.orders[0].verification.verified,true);assert.equal(quota,14);
  assert.equal(calls.filter(x=>x.method==='set_fleet_template_quota').length,1);
});

test('losing every settled colony prevents further orders and simulation restart',async t=>{
  let alive=true;
  const {game,calls}=await fixture(t,{
    get_status(){return {in_game:true,date:{formatted:'2200.01.01'},stats:{colonies:alive?1:0},outliner:{sectors_summary:{capital_system:'太阳'}}};},
    get_galaxy_overview(){return {player:{country_id:0,capital_system_id:0,owned_systems:alive?1:0}};}
  });
  alive=false;const state=await game.observe();
  assert.equal(state.terminal.kind,'no_playable_empire');
  const start=calls.length;
  await assert.rejects(game.watch(0),/全部星系和殖民地/);
  assert.equal(calls.slice(start).some(x=>x.method==='set_paused' && !x.params.paused),false);
});

test('a foreign fleet order requires fresh visible target confirmation',async t=>{
  let visible=true;
  const {game,calls,advance}=await fixture(t,{
    get_military_fleets(){return {fleets:[{fleet_id:3}]};},
    get_system(){return {fleets:visible?[{id:99,own:false}]:[]};}
  });
  const order={command:'follow_fleet',arguments:{fleet_id:3,target_fleet_id:99,attack:true}};
  const unknown=await game.apply({requestId:'unseen',snapshotId:game.snapshotId,orders:[order]});
  assert.equal(unknown.orders[0].status,'rejected');
  advance(61000);await game.observe();await game.inspect({topic:'system',id:0});
  const seen=await game.apply({requestId:'seen',snapshotId:game.snapshotId,orders:[order]});
  assert.equal(seen.orders[0].status,'posted');
  advance(31000);await game.observe();
  const stale=await game.apply({requestId:'stale-visible',snapshotId:game.snapshotId,orders:[order]});
  assert.equal(stale.orders[0].status,'posted');
  visible=false;advance(61000);await game.observe();
  const lost=await game.apply({requestId:'lost-visible',snapshotId:game.snapshotId,orders:[order]});
  assert.equal(lost.orders[0].status,'rejected');
  assert.equal(calls.filter(x=>x.method==='follow_fleet').length,2);
});

test('merge requires distinct full IDs, and completion needs every original ship in one fleet',async t=>{
  for(const fleet_ids of [[1],[1,1],[1,0xffffffff],[1,2,3,4,5]])assert.throws(()=>validateOrder({command:'merge_fleets',arguments:{fleet_ids}}));
  assert.deepEqual(validateOrder({command:'merge_fleets',arguments:{fleet_ids:[0,16777221]}}).arguments.fleet_ids,[0,16777221]);
  let joined=false;
  const {game}=await fixture(t,{
    merge_fleets(){return {success:true,before_ship_ids:[100,200]};},
    get_fleet_tactics(){return {fleets:joined?[{fleet_id:1,ship_ids:[100,200],total_ships:2,actual_naval_size:20,command_limit:100}]:[{fleet_id:1,ship_ids:[100],actual_naval_size:10,command_limit:100},{fleet_id:2,ship_ids:[200],actual_naval_size:10,command_limit:100}]};}
  });
  const order={command:'merge_fleets',arguments:{fleet_ids:[1,2]}};
  const receipt=await game.apply({requestId:'merge',snapshotId:game.snapshotId,orders:[order]});
  assert.equal(receipt.orders[0].verification.verified,false);
  joined=true;const proof=await game.verifyOrder(order,order.arguments,{before_ship_ids:[100,200]});
  assert.equal(proof.verified,true);assert.equal(proof.total_ships,2);
});

test('local idle waiting wakes and pauses on a new central event before its scheduled review',async t=>{
  let checks=0;
  const {game,calls}=await fixture(t,{get_active_events(){return ++checks>=4?[{window_id:0,title:'event'}]:[];}});
  const state=await game.watch(20);
  assert.deepEqual(state.wakeReasons,['central_event']);assert.equal(state.paused,true);
  assert.ok(calls.filter(x=>x.method==='get_active_events').length>=3);
  assert.ok(calls.some(x=>x.method==='set_paused'&&x.params.paused));
});

test('reinforcement accounts for real old-design ships outside the current template',async t=>{
  const {game,calls}=await fixture(t,{
    get_military_fleets(){return {fleets:[{fleet_id:3}]};},
    get_fleets(){return {fleets:[{fleet_id:3,designs:[{actual_count:6,target_quota:8,naval_size:20},{actual_count:1,target_quota:1,naval_size:10}]}]};},
    get_fleet_tactics(){return {fleets:[{fleet_id:3,actual_naval_size:165,command_limit:170}]};}
  });
  const result=await game.apply({requestId:'legacy-capacity',snapshotId:game.snapshotId,orders:[{command:'reinforce_fleet',arguments:{fleet_id:3}}]});
  assert.equal(result.orders[0].status,'rejected');assert.match(result.orders[0].error,/现役占用165/);assert.equal(calls.filter(x=>x.method==='reinforce_fleet').length,0);
});

test('route inspection preserves system zero and blocks an engine-confirmed inaccessible destination',async t=>{
  const {game,calls}=await fixture(t,{find_path(params){return {fleet_id:params.fleet_id,from_system_id:0,to_system_id:params.to_system_id,reachable:false};}});
  await assert.rejects(game.inspect({topic:'route',fleet_id:1}),/需要 fleet_id/);
  const route=await game.inspect({topic:'route',fleet_id:1,system_id:163});assert.equal(route.from_system_id,0);assert.equal(route.reachable,false);
  const rejected=await game.apply({requestId:'blocked-route',snapshotId:game.snapshotId,orders:[{command:'move_fleet',arguments:{fleet_id:1,system_id:163}}]});
  assert.equal(rejected.orders[0].status,'rejected');assert.equal(game.uncertain,false);assert.equal(calls.filter(x=>x.method==='move_fleet').length,0);
  const same=await game.apply({requestId:'same-system',snapshotId:game.snapshotId,orders:[{command:'move_fleet',arguments:{fleet_id:1,system_id:0}}]});assert.equal(same.orders[0].status,'posted');
});

test('an active HUD agenda is preserved when the detailed government agenda is blank',async t=>{
  const {game,calls}=await fixture(t,{
    get_status(){return {in_game:true,date:{formatted:'2200.01.01'},outliner:{sectors_summary:{capital_system:'太阳'}},council:{active_agenda:'agenda_display_of_power',active_agenda_name:'力量展示',agenda_progress:100,agenda_cost:7000,agenda_ready:false}};},
    get_government(){return {agenda:{key:'',progress:54,cost:0}};}
  });
  const government=await game.inspect({topic:'government'});assert.equal(government.agenda.key,'agenda_display_of_power');assert.equal(government.agenda.progress,100);
  const result=await game.apply({requestId:'same-agenda',snapshotId:game.snapshotId,orders:[{command:'set_council_agenda',arguments:{agenda_key:'agenda_display_of_power'}}]});
  assert.equal(result.orders[0].status,'already_active');assert.equal(calls.filter(x=>x.method==='set_council_agenda').length,0);
});

test('a new agenda selection is only verified when its current HUD key matches',async t=>{
  let active='';
  const {game}=await fixture(t,{
    get_status(){return {in_game:true,date:{formatted:'2200.01.01'},outliner:{sectors_summary:{capital_system:'太阳'}},council:{active_agenda:active,agenda_progress:0}};},
    set_council_agenda(params){active=params.agenda_key;return {success:true};},
    get_government(){return {ethics:[{key:'ethic_militarist'}],available_agendas:[{key:'agenda_display_of_power'}]};}
  });
  const result=await game.apply({requestId:'new-agenda',snapshotId:game.snapshotId,orders:[{command:'set_council_agenda',arguments:{agenda_key:'agenda_display_of_power'}}]});
  assert.equal(result.orders[0].verification.verified,true);assert.equal(result.orders[0].verification.phase,'council_agenda_readback');
});

test('an incompatible agenda is rejected before opening the council panel or posting a command',async t=>{
  const {game,calls}=await fixture(t,{get_government(){return {ethics:[{key:'ethic_fanatic_egalitarian'},{key:'ethic_xenophile'}],available_agendas:[{key:'agenda_progressive_growth'},{key:'agenda_open_arms'}]};}});
  const options=await game.inspect({topic:'government'});
  assert.deepEqual(options.available_agendas.map(x=>x.key),['agenda_open_arms']);
  const result=await game.apply({requestId:'incompatible-agenda',snapshotId:game.snapshotId,orders:[{command:'set_council_agenda',arguments:{agenda_key:'agenda_progressive_growth'}}]});
  assert.equal(result.orders[0].status,'rejected');assert.match(result.orders[0].error,/思潮/);
  assert.equal(calls.filter(x=>x.method==='set_council_agenda').length,0);
  assert.equal(calls.filter(x=>x.method==='show_panel'&&x.params.panel==='government').length,0);
});

test('a completed council selection closes its managed panel before returning to the model',async t=>{
  let agenda='';const {game,calls}=await fixture(t,{
    get_status(){return {in_game:true,date:{formatted:'2200.01.01'},outliner:{sectors_summary:{capital_system:'太阳'}},council:{active_agenda:agenda}};},
    get_government(){return {ethics:[{key:'ethic_xenophile'}],available_agendas:[{key:'agenda_open_arms'}]};},
    set_council_agenda(p){agenda=p.agenda_key;return {success:true};}
  });
  await game.apply({requestId:'close-council',snapshotId:game.snapshotId,orders:[{command:'set_council_agenda',arguments:{agenda_key:'agenda_open_arms'}}]});
  const methods=calls.map(x=>x.method),posted=methods.indexOf('set_council_agenda');
  assert.ok(calls.slice(posted+1).some(x=>x.method==='show_panel'&&x.params.panel==='game'));
  assert.equal(game.presentationKey,undefined);
});

test('a new central event prevents presentation cleanup from dismissing its UI',async t=>{
  let event=false;const {game,calls}=await fixture(t,{get_active_events(){return event?[{window_id:7}]:[];}});
  game.presentationPanel='government';game.presentationKey='old-panel';event=true;
  const before=calls.length;await game.finishPresentation();
  assert.equal(calls.slice(before).some(x=>x.method==='show_panel'),false);
  assert.equal(game.presentationPanel,'government');
});

test('peace-time military expansion protects a deficit economy while preserving wartime decisions',async t=>{
  let war=false,stock=840;
  const {game,calls,advance}=await fixture(t,{
    get_status(){return {in_game:true,date:{formatted:'2200.01.01'},outliner:{sectors_summary:{capital_system:'太阳'}},resources:{alloys:{stockpile:stock,net:-17.6,expense:40}},stats:{naval_capacity:{used:410,capacity:333}}};},
    get_wars(){return {wars:war?[{war_id:0}]:[]};},
    get_buildable_ships(){return {success:true,buildable:[{design_id:1,ship_size:'destroyer',can_build:true,cost:{alloys:427}}],queue:[]};}
  });
  const order={command:'build_ship',arguments:{system_id:0,design_id:1,count:2}};
  const peace=await game.apply({requestId:'peace-budget',snapshotId:game.snapshotId,orders:[order]});
  assert.equal(peace.orders[0].status,'rejected');assert.match(peace.orders[0].error,/海军已占用/);assert.equal(calls.filter(x=>x.method==='build_ship').length,0);
  war=true;stock=2000;advance(61000);await game.observe();
  const emergency=await game.apply({requestId:'war-budget',snapshotId:game.snapshotId,orders:[order]});assert.equal(emergency.orders[0].status,'posted');
});

test('ship spending without task reservations protects full-batch upkeep for civilian and wartime construction',async t=>{
 for(const c of [{war:false,expense:300,expected:'deferred'},{war:true,expense:300,expected:'deferred'},{war:false,expense:200,expected:'posted'},{war:false,expense:undefined,expected:'deferred'}]){
  const {game,calls}=await fixture(t,{
   get_status:()=>({in_game:true,date:{formatted:'2200.01.01'},resources:{alloys:{stockpile:1000,net:20,expense:c.expense}},stats:{naval_capacity:{used:0,capacity:100}}}),
   get_wars:()=>({wars:c.war?[{war_id:0}]:[]}),
   get_buildable_ships:()=>({success:true,queue:[],buildable:[{design_id:0,ship_size:c.war?'corvette':'science',naval_size:c.war?1:0,can_build:true,cost:{alloys:400}}]})
  });
  const r=await game.apply({requestId:'whole-ship-batch',snapshotId:game.snapshotId,orders:[{command:'build_ship',arguments:{system_id:0,design_id:0,count:2}}]});
  assert.equal(r.orders[0].status,c.expected);assert.equal(calls.filter(x=>x.method==='build_ship').length,c.expected==='posted'?1:0);
  if(c.expected==='posted'){const a=game.gestalt.data.actions.find(a=>a.spendingAdmission);assert.equal(a.spendingAdmission.cost.alloys,800);assert.equal(a.spendingAdmission.expenseCycle,true);assert.equal(a.spendingAdmission.rows[0].maintenance,200);}
  else {assert.equal(game.uncertain,false);assert.match(r.orders[0].reason,/维护/);assert.equal(r.orders[0].nativeWriteAttempted,false);}
 }
});

test('strategic-resource deficits remain visible in normal model observations',async t=>{
  const {game}=await fixture(t,{get_status(){return {in_game:true,date:{formatted:'2200.01.01'},outliner:{sectors_summary:{capital_system:'太阳'}},resources:{volatile_motes:{stockpile:0,net:-1.5},exotic_gases:{stockpile:12,net:-2}}};}});
  assert.equal(game.lastState.resources.volatile_motes.net,-1.5);assert.equal(game.lastState.resources.exotic_gases.stockpile,12);
});

test('positive-income overcapacity blocks both direct construction and reinforcement, while civilian ships remain legal',async t=>{
  const {game,calls}=await fixture(t,{
    get_status(){return {in_game:true,date:{formatted:'2200.01.01'},outliner:{sectors_summary:{capital_system:'太阳'}},resources:{alloys:{net:50,stockpile:5000,expense:20}},stats:{naval_capacity:{used:638,capacity:506}}};},
    get_buildable_ships(){return {success:true,buildable:[{design_id:7,ship_size:'cruiser',can_build:true,cost:{alloys:500}},{design_id:8,ship_size:'science',naval_size:0,can_build:true,cost:{alloys:100}}]};},
    get_military_fleets(){return {fleets:[{fleet_id:0}]};},
    get_fleets(){return {fleets:[{fleet_id:0,designs:[{design_id:7,naval_size:20,actual_count:2,target_quota:3}]}]};},
    get_fleet_tactics(){return {fleets:[{fleet_id:0,actual_naval_size:40,command_limit:230}]};}
  });
  const military=await game.inspect({topic:'military'});assert.equal(military.empire_naval_capacity.used,638);assert.match(military.expansion_policy,/维护代价软限制/);
  const result=await game.apply({requestId:'positive-overcapacity',snapshotId:game.snapshotId,orders:[{command:'build_ship',arguments:{design_id:7,system_id:0}},{command:'reinforce_fleet',arguments:{fleet_id:0}},{command:'build_ship',arguments:{design_id:8,system_id:0}}]});
  assert.equal(result.orders[0].status,'rejected');assert.equal(result.orders[1].status,'rejected');assert.equal(result.orders[2].status,'posted');
  assert.equal(calls.filter(x=>x.method==='reinforce_fleet').length,0);assert.equal(calls.filter(x=>x.method==='build_ship').length,1);assert.equal(calls.find(x=>x.method==='build_ship').params.design_id,8);
});

test('district zones use current empty slots and never replace an existing zone',async t=>{
  let zone=null;
  const {game,calls}=await fixture(t,{
    get_available_district_zones(){return {districts:[{district_id:0,slots:[{slot:0,zone,buildable_zones:[{zone:'zone_industrial'}]},{slot:1,zone:'zone_default',buildable_zones:[{zone:'zone_industrial'}]}]}]};},
    set_district_zone(params){assert.equal(params.slot,0);zone=params.zone_key;return {success:true};}
  });
  const rejected=await game.apply({requestId:'replace-zone',snapshotId:game.snapshotId,orders:[{command:'set_district_zone',arguments:{planet_id:0,district_id:0,zone_slot:1,zone_key:'zone_industrial'}}]});
  assert.equal(rejected.orders[0].status,'rejected');assert.equal(calls.filter(x=>x.method==='set_district_zone').length,0);
  const accepted=await game.apply({requestId:'empty-zone',snapshotId:game.snapshotId,orders:[{command:'set_district_zone',arguments:{planet_id:0,district_id:0,zone_slot:0,zone_key:'zone_industrial'}}]});
  assert.equal(accepted.orders[0].verification.verified,true);assert.equal(accepted.orders[0].verification.phase,'zone_created');
});

test('job priority expresses a desired state and never blindly toggles it twice',async t=>{
  let prioritized=false;
  const {game,calls,advance}=await fixture(t,{
    get_planet_jobs(){return {strata:[{jobs:[{job_key:'metallurgist',is_prioritized:prioritized,can_prioritize:!prioritized}]}]};},
    set_job_priority(){prioritized=!prioritized;return {success:true};}
  });
  const order={command:'set_job_priority',arguments:{planet_id:0,job_key:'metallurgist',prioritized:true}};
  const result=await game.apply({requestId:'priority-on',snapshotId:game.snapshotId,orders:[order]});assert.equal(result.orders[0].verification.verified,true);
  advance(31000);const again=await game.apply({requestId:'priority-still-on',snapshotId:game.snapshotId,orders:[order]});
  assert.equal(again.orders[0].status,'already_configured');assert.equal(calls.filter(x=>x.method==='set_job_priority').length,1);
});

test('zone and job commands are restricted to currently owned colonies',async t=>{
  const {game,calls}=await fixture(t,{get_status(){return {in_game:true,date:{formatted:'2200.01.01'},outliner:{sectors_summary:{capital_system:'太阳',sectors:[{colonies_summary:[{planet_id:0}]}]}}};}});
  const result=await game.apply({requestId:'foreign-job',snapshotId:game.snapshotId,orders:[{command:'set_job_priority',arguments:{planet_id:42,job_key:'metallurgist',prioritized:true}}]});
  assert.equal(result.orders[0].status,'rejected');assert.equal(calls.filter(x=>x.method==='get_planet_jobs').length,0);
});

test('reinforcement cannot bypass the peace-time alloy-deficit budget',async t=>{
  const {game,calls}=await fixture(t,{
    get_status(){return {in_game:true,date:{formatted:'2200.01.01'},outliner:{sectors_summary:{capital_system:'太阳'}},resources:{alloys:{stockpile:2000,net:-20}}};},
    get_military_fleets(){return {fleets:[{fleet_id:3}]};},
    get_fleets(){return {fleets:[{fleet_id:3,designs:[{actual_count:1,target_quota:2,naval_size:20}]}]};},
    get_fleet_tactics(){return {fleets:[{fleet_id:3,actual_naval_size:20,command_limit:170}]};}
  });
  const result=await game.apply({requestId:'reinforce-budget',snapshotId:game.snapshotId,orders:[{command:'reinforce_fleet',arguments:{fleet_id:3}}]});
  assert.equal(result.orders[0].status,'rejected');assert.match(result.orders[0].error,/合金正在亏损/);assert.equal(calls.filter(x=>x.method==='reinforce_fleet').length,0);
});

test('station refusal survives request, constructor, queue and property-order changes until relevant facts change',async t=>{
  let deposit='d_minerals_2',allowed=false;
  const {game,calls,advance}=await fixture(t,{
    get_system:()=>({owner_id:0,planets:[{id:7,surveyed:true,deposits:[{key:deposit}]}]}),
    build_stations:()=>allowed?{success:true}:{success:false,error:'不能在这个恒星系中任何一个行星周围建设这种空间站'}
  });
  const first=await game.apply({requestId:'station-a',snapshotId:game.snapshotId,orders:[{command:'build_stations',arguments:{fleet_id:1,system_id:8,station_type:'mining'}}]});assert.equal(first.orders[0].status,'rejected');
  advance(61000);await game.observe();
  const repeat=await game.apply({requestId:'station-b',snapshotId:game.snapshotId,orders:[{command:'build_stations',arguments:{station_type:'mining',system_id:8,queue:true,fleet_id:2}}]});assert.equal(repeat.orders[0].status,'rejected_cached');assert.equal(calls.filter(x=>x.method==='build_stations').length,1);
  deposit='d_minerals_3';allowed=true;
  const changed=await game.apply({requestId:'station-changed',snapshotId:game.snapshotId,orders:[{command:'build_stations',arguments:{fleet_id:2,system_id:8,station_type:'mining'}}]});assert.equal(changed.orders[0].status,'posted');assert.equal(calls.filter(x=>x.method==='build_stations').length,2);
});

test('the final live merge is refused before any mutation using freshly read actual capacity',async t=>{
  const {game,calls}=await fixture(t,{get_fleet_tactics:()=>({fleets:[{fleet_id:3,actual_naval_size:290,command_limit:370},{fleet_id:7,actual_naval_size:215,command_limit:370}]})});
  const result=await game.apply({requestId:'live-merge',snapshotId:game.snapshotId,orders:[{command:'merge_fleets',arguments:{fleet_ids:[3,7]}}]});
  assert.equal(result.orders[0].status,'rejected');assert.match(result.orders[0].error,/505.*370/);assert.equal(calls.filter(x=>x.method==='merge_fleets').length,0);
});

test('an unknown priority state never sends the native toggle',async t=>{
  const {game,calls}=await fixture(t,{get_planet_jobs:()=>({strata:[{jobs:[{job_key:'artisan',can_prioritize:true}]}]})});
  const result=await game.apply({requestId:'unknown-priority',snapshotId:game.snapshotId,orders:[{command:'set_job_priority',arguments:{planet_id:0,job_key:'artisan',prioritized:true}}]});
  assert.equal(result.orders[0].status,'rejected');assert.match(result.orders[0].error,/状态未知/);assert.equal(calls.filter(x=>x.method==='set_job_priority').length,0);
});

test('a stale council launch is rejected locally instead of creating an unknown write',async t=>{
  let active='',ready=false;
  const {game,calls,advance}=await fixture(t,{get_status:()=>({in_game:true,date:{formatted:'2200.01.01'},council:{active_agenda:active,agenda_ready:ready}})});
  const order={command:'launch_council_agenda',arguments:{agenda_key:'agenda_open_arms'}};
  const rejected=await game.apply({requestId:'agenda-gone',snapshotId:game.snapshotId,orders:[order]});assert.equal(rejected.orders[0].status,'rejected');assert.equal(game.uncertain,false);assert.equal(calls.filter(x=>x.method==='launch_council_agenda').length,0);
  active='agenda_open_arms';ready=true;advance(61000);await game.observe();
  const posted=await game.apply({requestId:'agenda-ready',snapshotId:game.snapshotId,orders:[order]});assert.equal(posted.orders[0].status,'posted');assert.equal(calls.filter(x=>x.method==='launch_council_agenda').length,1);
});

test('reinforcement includes existing shipyard construction and resumes when that queue is cleared',async t=>{
  let queue=[{type:'ship',key:'9',item_id:77}];
  const {game,calls,advance}=await fixture(t,{
    get_status:()=>({in_game:true,date:{formatted:'2200.01.01'},resources:{alloys:{stockpile:5000,net:30}},stats:{naval_capacity:{used:100,capacity:130}}}),
    get_military_fleets:()=>({fleets:[{fleet_id:3}]}),
    get_fleets:()=>({fleets:[{fleet_id:3,designs:[{design_id:9,actual_count:1,target_quota:2,naval_size:20}]}]}),
    get_fleet_tactics:()=>({fleets:[{fleet_id:3,actual_naval_size:20,command_limit:170}]}),
    get_buildable_ships:()=>({queue,buildable:[]})
  });
  const order={command:'reinforce_fleet',arguments:{fleet_id:3}};
  const refused=await game.apply({requestId:'yard-budget',snapshotId:game.snapshotId,orders:[order]});assert.equal(refused.orders[0].status,'rejected');assert.match(refused.orders[0].error,/在建20/);assert.equal(calls.filter(x=>x.method==='reinforce_fleet').length,0);
  queue=[];advance(61000);await game.observe();
  const posted=await game.apply({requestId:'yard-cleared',snapshotId:game.snapshotId,orders:[order]});assert.equal(posted.orders[0].status,'posted');assert.equal(calls.filter(x=>x.method==='reinforce_fleet').length,1);
});

test('peace-time reinforcement cannot treat unknown total naval capacity as unlimited',async t=>{
  const {game,calls}=await fixture(t,{
    get_military_fleets:()=>({fleets:[{fleet_id:3}]}),
    get_fleets:()=>({fleets:[{fleet_id:3,designs:[{design_id:9,actual_count:1,target_quota:2,naval_size:20}]}]}),
    get_fleet_tactics:()=>({fleets:[{fleet_id:3,actual_naval_size:20,command_limit:170}]})
  });
  const result=await game.apply({requestId:'naval-unknown',snapshotId:game.snapshotId,orders:[{command:'reinforce_fleet',arguments:{fleet_id:3}}]});assert.equal(result.orders[0].status,'rejected');assert.match(result.orders[0].error,/容量未知/);assert.equal(calls.filter(x=>x.method==='reinforce_fleet').length,0);
});

test('new hull budget counts every owned starbase queue once and needs no existing fleet template',async t=>{
 let queued=true;
 const yard=(system_id,queue_id)=>({system_id,queue_id,queue_complete:true,naval_costs_complete:true,queue:queued?[{type:'ship',key:'8',item_id:queue_id}]:[],designs:[{design_id:8,ship_size:'destroyer',naval_size:2}]});
 const {game,calls,advance}=await fixture(t,{
  get_status:()=>({in_game:true,date:{formatted:'2200.01.01'},resources:{alloys:{stockpile:5000,net:30,expense:20}},stats:{naval_capacity:{used:100,capacity:105}}}),
  get_fleets:()=>({fleets:[]}),
  get_buildable_ships:()=>({success:true,queue:[],buildable:[{design_id:8,ship_size:'destroyer',naval_size:2,can_build:true,cost:{alloys:100}}]}),
  get_shipyards:()=>({success:true,coverage_complete:true,coverage_scope:'owned_system_starbase_shipyards',shipyards:[yard(0,0),yard(50,3),yard(50,3)]})
 });
 const order={command:'build_ship',arguments:{system_id:0,design_id:8}};
 const blocked=await game.apply({requestId:'all-yards',snapshotId:game.snapshotId,orders:[order]});assert.equal(blocked.orders[0].status,'rejected');assert.match(blocked.orders[0].error,/在建4/);
 queued=false;advance(61000);await game.observe();const posted=await game.apply({requestId:'new-hull',snapshotId:game.snapshotId,orders:[order]});assert.equal(posted.orders[0].status,'posted');assert.equal(calls.filter(x=>x.method==='build_ship').length,1);
});

test('incomplete empire shipyard coverage never counts missing construction as zero',async t=>{
 const {game,calls}=await fixture(t,{
  get_status:()=>({in_game:true,date:{formatted:'2200.01.01'},resources:{alloys:{stockpile:5000,net:30}},stats:{naval_capacity:{used:100,capacity:200}}}),
  get_fleets:()=>({fleets:[]}),get_buildable_ships:()=>({queue:[],buildable:[{design_id:8,ship_size:'destroyer',naval_size:2,cost:{alloys:100}}]}),
  get_shipyards:()=>({success:true,coverage_complete:false,coverage_scope:'owned_system_starbase_shipyards',shipyards:[]})
 });
 const result=await game.apply({requestId:'missing-yards',snapshotId:game.snapshotId,orders:[{command:'build_ship',arguments:{system_id:0,design_id:8}}]});assert.equal(result.orders[0].status,'rejected');assert.match(result.orders[0].error,/覆盖不完整/);assert.equal(calls.filter(x=>x.method==='build_ship').length,0);
 const military=await game.inspect({topic:'military'});assert.equal(military.shipyard_budget.known,false);assert.equal(military.shipyard_budget.points,null);
});

test('explicitly unknown global yard costs cannot be masked by a stale fleet template',async t=>{
 const {game,calls}=await fixture(t,{
  get_status:()=>({in_game:true,date:{formatted:'2200.01.01'},resources:{alloys:{stockpile:5000,net:30}},stats:{naval_capacity:{used:100,capacity:200}}}),
  get_fleets:()=>({fleets:[{designs:[{design_id:8,naval_size:2}]}]}),get_buildable_ships:()=>({queue:[],buildable:[{design_id:8,ship_size:'destroyer',naval_size:2,cost:{alloys:100}}]}),
  get_shipyards:()=>({success:true,coverage_complete:true,coverage_scope:'owned_system_starbase_shipyards',shipyards:[{system_id:0,queue_id:0,queue_complete:true,naval_costs_complete:false,queue:[{type:'ship',key:'8'}],designs:[{design_id:8,naval_size:null}]}]})
 });
 const r=await game.apply({requestId:'unknown-design-cost',snapshotId:game.snapshotId,orders:[{command:'build_ship',arguments:{system_id:0,design_id:8}}]});assert.equal(r.orders[0].status,'rejected');assert.match(r.orders[0].error,/真实舰容/);assert.equal(calls.filter(x=>x.method==='build_ship').length,0);
 assert.equal((await game.inspect({topic:'military'})).shipyard_budget.known,false);
});

test('special military hulls and unknown noncivilian costs cannot bypass naval budget checks',async t=>{
 let points=30;
 const {game,calls,advance}=await fixture(t,{
  get_status:()=>({in_game:true,date:{formatted:'2200.01.01'},resources:{alloys:{stockpile:5000,net:30}},stats:{naval_capacity:{used:100,capacity:110}}}),
  get_fleets:()=>({fleets:[]}),get_buildable_ships:()=>({queue:[],buildable:[{design_id:91,ship_size:'special_crisis_hull',naval_size:points,cost:{alloys:100}}]})
 });
 const order={command:'build_ship',arguments:{system_id:0,design_id:91}};
 const first=await game.apply({requestId:'special-hull',snapshotId:game.snapshotId,orders:[order]});assert.equal(first.orders[0].status,'rejected');assert.match(first.orders[0].error,/海军/);
 points=null;advance(61000);await game.observe();const second=await game.apply({requestId:'unknown-special',snapshotId:game.snapshotId,orders:[order]});assert.equal(second.orders[0].status,'rejected');assert.match(second.orders[0].error,/真实舰容/);assert.equal(calls.filter(x=>x.method==='build_ship').length,0);
});

test('a real council panel opens two seconds before the mutation and closes at ten seconds',async t=>{
 let active='';const {game,calls}=await fixture(t,{get_government:()=>({ethics:[{key:'ethic_xenophile'}],available_agendas:[{key:'agenda_open_arms'}]}),get_status:()=>({in_game:true,date:{formatted:'2200.01.01'},council:{active_agenda:active}}),set_council_agenda:p=>{active=p.agenda_key;return {success:true};}});
 await game.apply({requestId:'visible-council',snapshotId:game.snapshotId,orders:[{command:'set_council_agenda',arguments:{agenda_key:'agenda_open_arms'}}]});
 const open=calls.find(x=>x.method==='show_panel'&&x.params.panel==='government'),post=calls.find(x=>x.method==='set_council_agenda');
 const close=calls.find(x=>x.method==='show_panel'&&x.params.panel==='game'&&x.presentationAt>post.presentationAt);
 assert.equal(post.presentationAt-open.presentationAt,2000);assert.equal(close.presentationAt-open.presentationAt,10000);
});

test('each action in the same real panel gets its own visible operation and ten second window',async t=>{
 const {game,calls}=await fixture(t,{get_leaders:()=>({pool_candidates:[{id:7},{id:8}]})});
 await game.apply({requestId:'two-visible-actions',snapshotId:game.snapshotId,orders:[7,8].map(candidate_id=>({command:'hire_leader',arguments:{candidate_id}}))});
 assert.deepEqual(calls.filter(x=>x.method==='hire_leader').map(x=>x.presentationAt),[2000,12350]);
 assert.deepEqual(calls.filter(x=>x.method==='show_panel'&&x.params.panel==='leaders').map(x=>x.presentationAt),[0,10350]);
});

test('a central event during the preview prevents the mutation and leaves its real modal untouched',async t=>{
 let event=false;const {game,calls}=await fixture(t,{get_leaders:()=>({pool_candidates:[{id:7}]}),get_active_events:()=>event?[{window_id:8}]:[]},{onWait:()=>{event=true;}});
 const r=await game.apply({requestId:'preview-modal',snapshotId:game.snapshotId,orders:[{command:'hire_leader',arguments:{candidate_id:7}}]});
 assert.equal(r.orders[0].status,'deferred');assert.equal(calls.filter(x=>x.method==='hire_leader').length,0);
 assert.equal(calls.filter(x=>x.method==='show_panel'&&x.params.panel==='game').length,1);
});

test('stop during result viewing never permits a later speed change or closes a new modal',async t=>{
 const {game,calls}=await fixture(t,{get_leaders:()=>({pool_candidates:[{id:7}]})},{onWait:(at,g)=>{if(at>=2500)g.cancelPresentation('用户停止');}});
 const r=await game.apply({requestId:'stop-viewing',snapshotId:game.snapshotId,orders:[{command:'hire_leader',arguments:{candidate_id:7}},{command:'set_speed',arguments:{speed:3}}]});
 assert.equal(r.orders[0].status,'posted');assert.equal(r.orders[1].status,'deferred');assert.equal(calls.filter(x=>x.method==='set_speed').length,0);
 assert.equal(calls.filter(x=>x.method==='show_panel'&&x.params.panel==='game').length,1);
});

test('a newly declared war without a modal or alert interrupts normal panel viewing',async t=>{
 let war=false;const {game,calls}=await fixture(t,{get_leaders:()=>({pool_candidates:[{id:7}]}),get_wars:()=>({wars:war?[{war_id:3}]:[]})},{onWait:()=>{war=true;}});
 const r=await game.apply({requestId:'preview-war',snapshotId:game.snapshotId,orders:[{command:'hire_leader',arguments:{candidate_id:7}}]});assert.equal(r.orders[0].status,'deferred');assert.equal(calls.filter(x=>x.method==='hire_leader').length,0);assert.ok(calls.some(x=>x.method==='set_paused'&&x.params.paused===true));
});

test('failure to open the real panel prevents its gameplay operation',async t=>{
 const {game,calls}=await fixture(t,{get_leaders:()=>({pool_candidates:[{id:7}]}),show_panel:p=>({success:p.panel==='game'})});
 const r=await game.apply({requestId:'panel-unavailable',snapshotId:game.snapshotId,orders:[{command:'hire_leader',arguments:{candidate_id:7}}]});assert.equal(r.orders[0].status,'rejected');assert.equal(calls.filter(x=>x.method==='hire_leader').length,0);
});

test('owned planet construction shows only its verified camera and never invents a planet panel',async t=>{
 const {game,calls}=await fixture(t,{get_status:()=>({in_game:true,date:{formatted:'2200.01.01'},outliner:{sectors_summary:{sectors:[{colonies_summary:[{planet_id:0}]}]}}})});
 await game.apply({requestId:'planet-camera',snapshotId:game.snapshotId,orders:[{command:'build_district',arguments:{planet_id:0,district_key:'district_city'}}]});
 const focus=calls.find(x=>x.method==='focus_planet'),post=calls.find(x=>x.method==='build_district');assert.equal(post.presentationAt-focus.presentationAt,2000);
 assert.equal(calls.some(x=>x.method==='show_panel'&&x.params.panel==='planet'),false);
 const log=await readFile(game.journal,'utf8');assert.match(log,/"kind":"camera"/);assert.match(log,/"durationMs":10000/);
});

test('a camera response for the wrong planet cannot authorize a gameplay operation',async t=>{
 const {game,calls}=await fixture(t,{get_status:()=>({in_game:true,date:{formatted:'2200.01.01'},outliner:{sectors_summary:{sectors:[{colonies_summary:[{planet_id:0}]}]}}}),focus_planet:()=>({success:true,camera_target_id:7})});
 const r=await game.apply({requestId:'wrong-planet-camera',snapshotId:game.snapshotId,orders:[{command:'build_district',arguments:{planet_id:0,district_key:'district_city'}}]});assert.equal(r.orders[0].status,'rejected');assert.equal(calls.filter(x=>x.method==='build_district').length,0);
});

test('cancellation during the final awaited safety read cannot race into a gameplay write',async t=>{
 let gameRef,checks=0;
 const {game,calls}=await fixture(t,{get_leaders:()=>({pool_candidates:[{id:7}]}),get_alerts:()=>{if(gameRef?.presentationTimeline.now()===2000&&++checks===2)gameRef.cancelPresentation('最后回读期间停止');return [];}},{onWait:(_at,g)=>{gameRef=g;}});
 const r=await game.apply({requestId:'cancel-safety-read',snapshotId:game.snapshotId,orders:[{command:'hire_leader',arguments:{candidate_id:7}}]});
 assert.equal(r.orders[0].status,'deferred');assert.equal(calls.filter(x=>x.method==='hire_leader').length,0);
});

test('a real panel close refusal is never recorded as complete and defers later actions',async t=>{
 let opened=false;const {game,calls}=await fixture(t,{get_leaders:()=>({pool_candidates:[{id:7},{id:8}]}),show_panel:p=>{if(p.panel==='leaders'){opened=true;return {success:true};}return {success:!opened};}});
 const r=await game.apply({requestId:'close-refused',snapshotId:game.snapshotId,orders:[7,8].map(candidate_id=>({command:'hire_leader',arguments:{candidate_id}}))});
 assert.equal(r.orders[0].status,'posted');assert.equal(r.orders[1].status,'deferred');assert.equal(calls.filter(x=>x.method==='hire_leader').length,1);
 const log=await readFile(game.journal,'utf8');assert.match(log,/presentation_close_failed/);assert.doesNotMatch(log,/"type":"presentation_complete"/);
});

test('market base estimates are identified and actual balance deltas are reported without future price claims',async t=>{
 const {game}=await fixture(t,{get_market:()=>({settlement_currency:'trade',resources:[{key:'consumer_goods',buy_price_per_unit:2.6}]}),get_status:()=>({in_game:true,date:{formatted:'2200.01.01'},resources:{consumer_goods:{stockpile:3740.56},trade:{stockpile:38651.34}}})});
 assert.equal((await game.inspect({topic:'market'})).price_basis,'resource_definition_base_estimate');
 game.marketBefore={resource:3690.56,currency:38908.26,settlement:'trade',quote:{success:true,total:256.92295}};
 const v=await game.verifyOrder({command:'market_trade'},{resource:'consumer_goods',action:'buy',units:50},{});
 assert.equal(v.verified,true);assert.equal(v.observedResourceDelta,50);assert.ok(Math.abs(v.observedSettlementDelta+256.92)<0.001);
});


test('research rejection returns current slot candidates without writing or replaying rejected parameters',async t=>{
 let current=null;
 const {game,calls}=await fixture(t,{
  get_research_state:()=>({physics:{current:null,candidates:[{key:'tech_physics'}]},engineering:{current,candidates:[{key:'tech_engineering',name:'Engineering'}]}}),
  select_research:p=>{current={key:p.tech_key,is_researching:true};return {success:true};}
 });
 const bad={command:'select_research',arguments:{slot:'engineering',tech_key:'tech_physics'}};
 const r=await game.apply({requestId:'wrong-slot-pool',snapshotId:game.snapshotId,orders:[bad]});
 assert.equal(r.orders[0].status,'rejected');assert.deepEqual(r.orders[0].candidateFeedback.candidates[0].arguments,{slot:'engineering',tech_key:'tech_engineering'});
 assert.equal(calls.filter(x=>x.method==='select_research').length,0);
 const repeated=await game.apply({requestId:'same-bad-pool',snapshotId:game.snapshotId,orders:[bad]});assert.equal(repeated.orders[0].status,'rejected_cached');
 const good=await game.apply({requestId:'correct-slot-pool',snapshotId:game.snapshotId,orders:[{command:'select_research',arguments:r.orders[0].candidateFeedback.candidates[0].arguments}]});
 assert.equal(good.orders[0].status,'posted');assert.equal(calls.filter(x=>x.method==='select_research').length,1);
});
test('unknown and empty research pools are distinguished and never send a guessed technology',async t=>{
 for(const [label,area,known] of [['unknown',{current:null},false],['empty',{current:null,candidates:[]},true]]){
  const {game,calls}=await fixture(t,{get_research_state:()=>({physics:area})});
  const r=await game.apply({requestId:label,snapshotId:game.snapshotId,orders:[{command:'select_research',arguments:{slot:'physics',tech_key:'tech_guessed'}}]});
  assert.equal(r.orders[0].status,'rejected');assert.equal(r.orders[0].candidateFeedback.known,known);assert.deepEqual(r.orders[0].candidateFeedback.candidates,[]);assert.equal(calls.some(x=>x.method==='select_research'),false);
 }
});
test('tradition pool refresh returns replacement candidates without adopting the old choice',async t=>{
 let pool=[{key:'tr_old',name:'Old'}];
 const {game,calls}=await fixture(t,{get_tradition_candidates:()=>({candidates:pool})});
 await game.inspect({topic:'traditions'});pool=[{key:'tr_new',name:'New'}];
 const r=await game.apply({requestId:'changed-tradition',snapshotId:game.snapshotId,orders:[{command:'adopt_tradition',arguments:{tradition_key:'tr_old'}}]});
 assert.equal(r.orders[0].status,'rejected');assert.deepEqual(r.orders[0].candidateFeedback.candidates.map(x=>x.arguments),[{tradition_key:'tr_new'}]);assert.equal(calls.some(x=>x.method==='adopt_tradition'),false);
});

test('market inspection exposes unknown recurring coverage without enabling monthly writes',async t=>{
 const {game,calls}=await fixture(t,{get_market:()=>({resources:[],monthly_trades:[],settlement_currency:'trade'})});
 const r=await game.inspect({topic:'market'});assert.equal(r.monthlyAccounting.ordersKnown,false);assert.equal(r.monthlyAccounting.budgetKnown,false);assert.equal(r.monthlyAccounting.recurringWritesEnabled,false);assert.equal(calls.some(x=>x.method==='set_monthly_trade'),false);
});

test('focused market inspection keeps full monthly accounting and cannot authorize an old quote for execution',async t=>{
 let food=1000,cash=1000;
 const row=stockpile=>({stockpile,net:10,expense:10,max:15000,stockpile_known:true,net_known:true,expense_known:true,net_basis:'engine_total_including_monthly_trade'});
 const {game,calls}=await fixture(t,{
  get_status:()=>({in_game:true,is_paused:true,date:{formatted:'2200.01.01'},resources:{food:row(food),trade:row(cash),minerals:row(500)}}),
  get_market:()=>({settlement_currency:'trade',resources:[{key:'food',batch_size:100},{key:'minerals',batch_size:100}],monthly_trades_complete:true,monthly_trade_country_id:0,active_monthly_trades_count:1,monthly_trades:[{order_id:0,resource:'minerals',action:'sell',amount:1,max_unit_price:0}]}),
  get_market_quote:p=>({success:true,...p,total:p.units*.7,settlement_currency:'trade',includes_fee:true,price_basis:'engine_transaction_total'}),
  market_trade:p=>{food-=p.units;cash+=p.units*.7;return {success:true};}
 });
 const before=calls.length,r=await game.inspect({topic:'market',resource:'food',action:'sell',units:300});
 assert.equal(r.resources.length,1);assert.equal(r.resources[0].sell_total,210);
 assert.equal(r.monthlyAccounting.ordersKnown,true);assert.equal(r.monthlyAccounting.observedOrders[0].resource,'minerals');assert.equal(r.quoteScope.monthlyAccountingScope,'original_full_market');
 assert.equal(calls.slice(before).filter(c=>c.method==='get_market_quote').length,1);
 const afterPreview=calls.length;
 const posted=await game.apply({requestId:'fresh-after-focused-preview',snapshotId:game.snapshotId,orders:[{command:'market_trade',arguments:{resource:'food',action:'sell',units:100}}]});
 assert.equal(posted.orders[0].status,'posted');assert.equal(food,900);
 assert.deepEqual(calls.slice(afterPreview).filter(c=>c.method==='get_market_quote').map(c=>c.params.units),[100]);
 assert.equal(calls.some(c=>c.method==='set_monthly_trade'),false);
 const invalidStart=calls.length;await assert.rejects(game.inspect({topic:'ships',resource:'food'}),/仅用于market/);assert.equal(calls.length,invalidStart);
});

test('monthly accounting uses the shared task commitments and active campaign reserve floor',async t=>{
 const {game}=await fixture(t,{
  get_status:()=>({in_game:true,date:{formatted:'2200.01.01'},resources:{trade:{stockpile:1000,net:50,stockpile_known:true,net_known:true,net_basis:'engine_total_including_monthly_trade'}},outliner:{sectors_summary:{capital_system:'太阳'}}}),
  get_market:()=>({resources:[],monthly_trades:[],monthly_trades_complete:true,monthly_trade_country_id:0,active_monthly_trades_count:0,settlement_currency:'trade'})
 });
 game.gestalt.commitments=()=>({trade:100});game.gestalt.data.campaign={phase:'active',execution:{resourceFloors:{trade:200}}};
 const r=await game.inspect({topic:'market'});assert.equal(r.monthlyAccounting.budgetKnown,true);assert.equal(r.monthlyAccounting.projections[0].spendableNow,700);assert.equal(r.monthlyAccounting.gameDate,'2200.01.01');
});

test('monthly trade previews and unsupported execution never send a recurring trade mutation',async t=>{
 const {game,calls}=await fixture(t,{get_market:()=>({resources:[],monthly_trades:[],monthly_trades_complete:true,monthly_trade_country_id:0,active_monthly_trades_count:0,settlement_currency:'trade'})});
 const r=await game.monthlyTrade({operation:'preview',change:{operation:'set',resource:'food',action:'buy',amount:100,priceLimit:2}});
 assert.equal(r.preview.status,'creation_preview');assert.equal(r.preview.executable,false);assert.equal(calls.some(x=>x.method==='set_monthly_trade'),false);
 await assert.rejects(game.monthlyTrade({operation:'execute'}),/set\/cancel\/replace/);
 const before=calls.length;await assert.rejects(game.monthlyTrade({operation:'preview',change:{operation:'cancel',orderId:-1}}),/orderId/);assert.equal(calls.length,before);
});


test('monthly model execution pauses, posts and reads actual ID; stop cancels only owned order',async t=>{
 let paused=false;const orders=[];
 const row={stockpile:10000,net:0,stockpile_known:true,net_known:true,net_basis:'engine_total_including_monthly_trade'};
 const {game,calls}=await fixture(t,{
  ping:()=>({bridge_version:'cyberfish-0.6.9-monthly-read-r2',features:['building_upgrade_candidates','building_upgrade_queue_identity','ship_design_naval_size','zone_building_membership','owned_shipyard_queues','engine_market_transaction_quotes','normal_war_actions','native_survey_automation_candidate','monthly_trade_read_coverage_candidate']}),
  set_paused:p=>{paused=p.paused;return {success:true};},
  get_status:()=>({in_game:true,is_paused:paused,date:{formatted:'2200.01.01'},resources:{food:row,trade:row},outliner:{sectors_summary:{capital_system:'太阳'}}}),
  get_market:()=>({market_fee_percent:30,resources:[{key:'food'}],monthly_trades:structuredClone(orders),monthly_trades_complete:true,monthly_trade_country_id:0,active_monthly_trades_count:orders.length,settlement_currency:'trade'}),
  set_monthly_trade:p=>{if(p.cancel)orders.splice(orders.findIndex(o=>o.order_id===p.order_id),1);else orders.push({order_id:0,resource:p.resource,action:p.action,amount:p.amount,max_unit_price:p.price_limit});return {success:true};}
 });
 const args={operation:'execute',requestId:'set-one',snapshotId:game.snapshotId,change:{operation:'set',resource:'food',action:'buy',amount:10,priceLimit:2}};
 const r=await game.monthlyTrade(args);assert.equal(r.status,'order_registered');assert.equal(r.orderId,0);assert.equal(paused,true);
 assert.equal(game.gestalt.commitments().trade,20);
 await game.monthlyTrade(args);assert.equal(calls.filter(c=>c.method==='set_monthly_trade').length,1);
 await game.stop();assert.equal(game.cleanup.monthlyTrade.confirmed,true);assert.equal(orders.length,0);assert.equal(game.gestalt.commitments().trade??0,0);
 assert.throws(()=>game.assertRpcAllowed('set_monthly_trade',{cancel:true,order_id:999}),/正在停止/);
 assert.throws(()=>game.assertRpcAllowed('set_monthly_trade',{cancel:false}),/正在停止/);
});

test('local colony tool delegates bounded housing work and reclaims without cancelling queued construction',async t=>{
 let queue=[],built=0,stock=1000;
 const {game,calls}=await fixture(t,{
  get_status:()=>({in_game:true,is_paused:true,date:{formatted:'2200.01.01'},resources:{minerals:{stockpile:stock,net:10}},outliner:{sectors_summary:{capital_system:'太阳'}}}),
  get_colony_automation:()=>({known:true,enabled:false,planet_id:0,owner_id:0,colony_id:0,queue:{known:true,queue_id:0,items:queue.map(x=>({item_id:x.item_id}))}}),
  get_planet_details:()=>({planet_id:0,colony_id:0,kpi:{housing:2},designation_key:'col_capital',construction_queue:queue,districts:[]}),
  get_buildable_districts:()=>({success:true,planet_id:0,colony_id:0,current:[{key:'district_city',built}],buildable:[{key:'district_city',can_build:true,cost:{minerals:100}}]}),
  build_district:()=>{stock-=100;queue=[{item_id:0,key:'district_city',type:'district'}];return {success:true};}
 });
 await game.colonyControl({operation:'delegate',snapshotId:game.snapshotId,policy:{planetId:0,goal:'留出住房缓冲',districtKey:'district_city',housingTarget:10,maxBuilds:1,budget:{minerals:100},reviewDays:30}});
 await assert.rejects(game.apply({requestId:'manual-conflict',snapshotId:game.snapshotId,orders:[{command:'build_district',arguments:{planet_id:0,district_key:'district_city'}}]}),/托管/);
 const r=await game.colonyControl({operation:'advance',snapshotId:game.snapshotId});assert.equal(r.control.records[0].actions[0].status,'queued');assert.equal(calls.filter(c=>c.method==='build_district').length,1);
 await game.colonyControl({operation:'advance',snapshotId:game.snapshotId});assert.equal(calls.filter(c=>c.method==='build_district').length,1);
 await game.colonyControl({operation:'reclaim',planetId:0,snapshotId:game.snapshotId});assert.equal(game.colonyRoutine.view().records[0].status,'reclaimed');assert.equal(queue.length,1);
 await game.stop();assert.equal(calls.some(c=>c.method==='set_colony_automation'),false);assert.equal(game.cleanup.colonyControl.queuedWorkCancelled,false);
});
test('monthly reserves allow fresh research choices while still blocking unbudgeted spending',async t=>{
 let current=null;
 const {game,calls}=await fixture(t,{get_research_state:()=>({physics:{current,candidates:[{key:'tech_physics'}]}}),select_research:p=>{current={key:p.tech_key,is_researching:true};return {success:true};}});
 game.gestalt.data.monthlyTrades=[{sessionId:game.sessionId,status:'order_registered',reservation:{trade:10}}];
 const r=await game.apply({requestId:'research-with-trade',snapshotId:game.snapshotId,orders:[{command:'select_research',arguments:{slot:'physics',tech_key:'tech_physics'}}]});
 assert.equal(r.orders[0].status,'posted');assert.equal(calls.filter(c=>c.method==='select_research').length,1);
 await assert.rejects(game.apply({requestId:'spend-without-budget',snapshotId:game.snapshotId,orders:[{command:'build_district',arguments:{planet_id:0,district_key:'district_city'}}]}),/共享资源预留/);
});
test('monthly reserve handback pauses and cancels own order, preserving a manual order without model calls',async t=>{
 let paused=false;const orders=[{order_id:0,resource:'food',action:'buy',amount:1,max_unit_price:2},{order_id:1,resource:'food',action:'sell',amount:1,max_unit_price:0}];
 const row={stockpile:1,net:-10,stockpile_known:true,net_known:true,net_basis:'engine_total_including_monthly_trade'};
 const {game,calls}=await fixture(t,{
  set_paused:p=>{paused=p.paused;return {success:true};},
  get_status:()=>({in_game:true,is_paused:paused,date:{formatted:'2200.01.01'},resources:{trade:row},outliner:{sectors_summary:{capital_system:'太阳'}}}),
  get_market:()=>({monthly_trades:orders,monthly_trades_complete:true,monthly_trade_country_id:0,active_monthly_trades_count:orders.length}),
  set_monthly_trade:p=>{assert.equal(p.order_id,0);orders.shift();return {success:true};}
 });
 game.gestalt.data.monthlyTrades=[{sessionId:game.sessionId,requestId:'owned',status:'order_registered',ownedOrder:{order_id:0,resource:'food',action:'buy',amount:1,price_limit:2},reservation:{trade:2}}];
 const r=await game.watch(0);assert.deepEqual(r.wakeReasons,['monthly_trade_resource_risk']);assert.equal(paused,true);assert.deepEqual(orders.map(o=>o.order_id),[1]);
 assert.equal(calls.filter(c=>c.method==='set_monthly_trade').length,1);assert.equal(game.gestalt.data.monthlyTrades[0].released,true);
});

// Prepared after the user's implementation-only instruction; not executed yet.
test('unvalidated upgrade automation cannot be enabled through ordinary controller calls',async t=>{
 const {game,calls}=await fixture(t);
 await assert.rejects(game.colonyUpgradeControl({operation:'delegate',snapshotId:game.snapshotId,policy:{}}),/默认关闭/);
 assert.equal(calls.some(c=>c.method==='upgrade_building'),false);
});
test('explicit upgrade pilot uses the shared command pipeline and stops future dispatch',async t=>{
 let queue=[],paused=true;
 const candidate={building_id:0,zone_id:0,current_key:'building_lab_1',upgrade_key:'building_lab_2',can_upgrade:true,cost:{minerals:100}};
 const {game,calls}=await fixture(t,{
  get_status:()=>({in_game:true,is_paused:paused,date:{formatted:'2200.01.01'},resources:{minerals:{stockpile:1000,net:10}},outliner:{sectors_summary:{capital_system:'太阳',sectors:[{colonies_summary:[{planet_id:0,colony_id:0}]}]}}}),
  set_paused:p=>{paused=p.paused;return {success:true};},
  get_colony_automation:()=>({known:true,enabled:false,planet_id:0,owner_id:0,colony_id:0,queue:{known:true,queue_id:0,items:queue.map(q=>({item_id:q.item_id}))}}),
  get_planet_details:()=>({planet_id:0,colony_id:0,designation_key:'col_research',construction_queue:queue,districts:[{zones:[{buildings:[{id:0,key:'building_lab_1',status:'built'}]}]}]}),
  get_building_upgrade_candidates:()=>({success:true,planet_id:0,colony_id:0,queue_id:0,candidates:[candidate]}),
  upgrade_building:()=>{queue=[{item_id:0,key:'building_lab_2',type:'building_upgrade',building_id:0}];return {success:true};}
 },{colonyUpgradePilot:true});
 const policy={planetId:0,goal:'按批准列表升级科研设施',allowedUpgradeKeys:['building_lab_2'],maxBuilds:1,budget:{minerals:100},reviewDays:30};
 await game.colonyUpgradeControl({operation:'delegate',snapshotId:game.snapshotId,policy});
 await game.colonyUpgradeControl({operation:'advance',snapshotId:game.snapshotId});
 assert.equal(calls.filter(c=>c.method==='upgrade_building').length,1);assert.equal(game.colonyUpgradeRoutine.view().records[0].actions[0].status,'queued');
 await game.stop();assert.equal(game.cleanup.colonyUpgrades.records[0].status,'stopped');assert.equal(queue.length,1);
});

test('replacement instance completion crosses the real delegation pipeline and ends waiting without another unpause',async t=>{
 let queue=[],paused=true,buildingId=0,buildingKey='building_lab_1';
 const candidate={building_id:0,zone_id:0,current_key:'building_lab_1',upgrade_key:'building_lab_2',can_upgrade:true,cost:{minerals:100}};
 const {game,calls,advance}=await fixture(t,{
  get_status:()=>({in_game:true,is_paused:paused,date:{formatted:'2200.01.01'},resources:{minerals:{stockpile:1000,net:10}},outliner:{sectors_summary:{capital_system:'太阳',sectors:[{colonies_summary:[{planet_id:0,colony_id:0}]}]}}}),
  set_paused:p=>{paused=p.paused;return {success:true};},
  get_colony_automation:()=>({known:true,enabled:false,planet_id:0,owner_id:0,colony_id:0,queue:{known:true,queue_id:0,items:queue.map(q=>({item_id:q.item_id}))}}),
  get_planet_details:()=>({planet_id:0,colony_id:0,designation_key:'col_research',construction_queue:structuredClone(queue),districts:[{zones:[{slot_index:0,buildings_known:true,buildings:[{id:buildingId,key:buildingKey,slot_index:0,status:'built'}]}]}]}),
  get_building_upgrade_candidates:()=>({success:true,planet_id:0,colony_id:0,queue_id:0,candidates:[candidate]}),
  upgrade_building:()=>{queue=[{item_id:0,key:'building_lab_2',type:'building_upgrade',building_id:0}];return {success:true};}
 },{colonyUpgradePilot:true,localWaitPilot:true});
 await game.colonyUpgradeControl({operation:'delegate',snapshotId:game.snapshotId,policy:{planetId:0,goal:'核对原队列对应的替换实例',allowedUpgradeKeys:['building_lab_2'],maxBuilds:1,budget:{minerals:100},reviewDays:30}});
 await game.colonyUpgradeControl({operation:'advance',snapshotId:game.snapshotId});assert.ok(game.gestalt.data.colonyUpgradeRoutines[0].actions[0].queueWitness);
 buildingId=41;buildingKey='building_lab_2';queue=[];advance(5001);const n=calls.length;
 const result=await game.watch(60);assert.deepEqual(result.wakeReasons,['local_work_completed']);assert.equal(result.waitPolicy.effectiveSeconds,0);
 assert.equal(game.colonyUpgradeRoutine.view().records[0].status,'completed');assert.equal(game.gestalt.data.colonyUpgradeRoutines[0].actions[0].proof.building.id,41);
 assert.equal(calls.filter(c=>c.method==='upgrade_building').length,1);assert.equal(calls.slice(n).some(c=>c.method==='set_paused'&&c.params.paused===false),false);
});

// Implementation-only batch: prepared for the user's unified validation.
test('monthly expiry removes only its owned order while keeping a running game running',async t=>{
 let paused=false;const orders=[{order_id:0,resource:'food',action:'buy',amount:1,max_unit_price:2},{order_id:9,resource:'food',action:'sell',amount:1,max_unit_price:0}];
 const row={stockpile:10000,net:0,stockpile_known:true,net_known:true,net_basis:'engine_total_including_monthly_trade'};
 const {game,calls}=await fixture(t,{
  get_status:()=>({in_game:true,is_paused:paused,date:{formatted:'2200.01.01'},resources:{food:row,trade:row},outliner:{sectors_summary:{capital_system:'太阳'}}}),
  get_market:()=>({monthly_trades:structuredClone(orders),monthly_trades_complete:true,monthly_trade_country_id:0,active_monthly_trades_count:orders.length}),
  set_paused:p=>{paused=p.paused;return {success:true};},
  set_monthly_trade:p=>{assert.equal(p.cancel,true);assert.equal(p.order_id,0);orders.shift();return {success:true};}
 },{monthlyLifecyclePilot:true});
 game.gestalt.data.monthlyTrades=[{sessionId:game.sessionId,requestId:'expiry',status:'order_registered',ownedOrder:{order_id:0,resource:'food',action:'buy',amount:1,price_limit:2},change:{operation:'set',resource:'food',action:'buy',amount:1,priceLimit:2},policy:{expiresOn:'2200.01.01'},before:{scope:{gameDate:'2200.01.01'}},reservation:{trade:2}}];
 const before=calls.length;assert.equal(await game.monitorMonthlyTrade(await game.rpc('get_status')),false);
 assert.equal(paused,false);assert.deepEqual(orders.map(o=>o.order_id),[9]);assert.equal(calls.slice(before).some(c=>c.method==='set_paused'),false);
 assert.equal(game.gestalt.data.monthlyTrades[0].termination.reason,'policy_complete');assert.equal(game.monthlyExecution.view().counts.policyCompleted,1);
});
test('unknown target stock pauses without removing unrelated orders or fabricating completion',async t=>{
 let paused=false;const {game,calls}=await fixture(t,{
  get_status:()=>({in_game:true,is_paused:paused,date:{formatted:'2200.01.01'},resources:{},outliner:{sectors_summary:{capital_system:'太阳'}}}),
  set_paused:p=>{paused=p.paused;return {success:true};}
 },{monthlyLifecyclePilot:true});
 game.gestalt.data.monthlyTrades=[{sessionId:game.sessionId,requestId:'stock',status:'order_registered',ownedOrder:{order_id:0},change:{operation:'set',resource:'food',action:'buy',amount:1,priceLimit:2},policy:{maxStockpile:1000},before:{scope:{gameDate:'2200.01.01'}},reservation:{}}];
 assert.equal(await game.monitorMonthlyLifecycle(await game.rpc('get_status')),true);assert.equal(paused,true);assert.deepEqual(game.decisionPause.reasons,['monthly_lifecycle_state_unknown']);assert.equal(calls.some(c=>c.method==='set_monthly_trade'),false);
 // Teardown may inspect this unknown fixture; the assertion above concerns the review itself.
 game.gestalt.data.monthlyTrades[0].released=true;
});
test('survey trials disable both new spending pilots even if their environment switches are enabled',async t=>{
 const {game,calls}=await fixture(t,{}, {surveyPilot:true,monthlyLifecyclePilot:true,colonyUpgradePilot:true});
 assert.equal(game.monthlyLifecyclePilot,false);assert.equal(game.colonyUpgradePilot,false);
 const before=calls.length;
 await assert.rejects(game.monthlyTrade({operation:'execute',requestId:'no',snapshotId:game.snapshotId,change:{operation:'set',resource:'food',action:'buy',amount:1,priceLimit:2}}));
 assert.equal(calls.slice(before).some(c=>c.method==='set_monthly_trade'),false);
});

test('empty task budgets cannot spend through monthly commitments; fully allocated current costs preserve other reservations',async t=>{
 for(const budget of [{},{minerals:500}]){
  const {game,calls}=await fixture(t,{
   get_status:()=>({in_game:true,is_paused:true,date:{formatted:'2200.01.01'},resources:{minerals:{stockpile:650,net:0,stockpile_known:true,net_known:true}},outliner:{sectors_summary:{capital_system:'太阳'}}}),
   get_buildable_districts:()=>({success:true,planet_id:0,buildable:[{key:'district_city',can_build:true,cost:{minerals:500}}]}),
   build_district:()=>({success:true})
  });
  game.gestalt.data.monthlyTrades=[{sessionId:game.sessionId,status:'order_registered',reservation:{minerals:50}}];
  game.gestalt.data.campaign={phase:'prepare',execution:{resourceFloors:{minerals:100}}};
  await game.task({operation:'add',task:{goal:'建设住房但不占用月度储备',orders:[{command:'build_district',arguments:{planet_id:0,district_key:'district_city'}}],budget}});
  const r=await game.task({operation:'run'}),funded=!!budget.minerals;
  assert.equal(r.orders[0].status,funded?'posted':'deferred');assert.equal(calls.filter(c=>c.method==='build_district').length,funded?1:0);
  if(!funded)assert.match(r.orders[0].reason,/空预算/);
  else assert.equal(game.gestalt.data.actions[0].spendingAdmission.rows[0].otherReserved,50);
 }
});
test('a forged task ID cannot borrow the exemption for a spending action',async t=>{
 const {game,calls}=await fixture(t);
 await assert.rejects(game.apply({requestId:'fake-task',snapshotId:game.snapshotId,taskId:'nonexistent',orders:[{command:'build_district',arguments:{planet_id:0,district_key:'district_city'}}]}),/taskId/);
 assert.equal(calls.some(c=>c.method==='build_district'),false);
});

test('confirmed local waiting caches only bounded read evidence and rechecks current reserves without another queue RPC',async t=>{
 const row={stockpile:1000,net:0};const {game,calls,advance}=await fixture(t,{
  get_status:()=>({in_game:true,is_paused:false,date:{formatted:'2200.01.01'},resources:{minerals:row},outliner:{sectors_summary:{capital_system:'太阳'}}}),
  get_colony_automation:()=>({known:true,enabled:false,planet_id:0,colony_id:0,owner_id:0,queue:{known:true,queue_id:0,items:[{item_id:0}]}}),
  get_planet_details:()=>({planet_id:0,colony_id:0,designation_key:'col_capital',construction_queue:[{item_id:0,key:'district_city'}]})
 },{localWaitPilot:true});
 game.gestalt.data.colonyRoutines=[{id:'r',sessionId:game.sessionId,status:'waiting',planetId:0,colonyId:0,ownerId:0,queueId:0,designation:'col_capital',districtKey:'district_city',createdDate:'2200.01.01',actions:[{status:'queued',queueItemId:0,date:'2200.01.01',cost:{minerals:500}}]}];
 const status=await game.rpc('get_status');assert.equal((await game.confirmedLocalWork(status)).trusted,true);
 const reads=()=>calls.filter(c=>c.method==='get_colony_automation').length,n=reads();
 assert.equal((await game.confirmedLocalWork(status)).trusted,true);assert.equal(reads(),n);
 row.stockpile=-1;assert.equal((await game.confirmedLocalWork(await game.rpc('get_status'))).trusted,false);assert.equal(reads(),n);
 row.stockpile=1000;advance(5001);assert.equal((await game.confirmedLocalWork(await game.rpc('get_status'))).trusted,true);assert.equal(reads(),n+1);
 game.gestalt.data.colonyRoutines[0].status='paused';assert.equal((await game.confirmedLocalWork(status)).trusted,false);
});
test('local wait pilot is off by default and cannot be enabled in a survey comparison',async t=>{
 const normal=await fixture(t);assert.equal(normal.game.localWaitPilot,false);
 const trial=await fixture(t,{}, {surveyPilot:true,localWaitPilot:true});assert.equal(trial.game.localWaitPilot,false);
});

test('a vanished local queue is reconciled before watch can resume or an alert can defer completion',async t=>{
 for(const alert of [false,true]){
  let showAlert=false;
  const {game,calls}=await fixture(t,{
   get_status:()=>({in_game:true,is_paused:false,date:{formatted:'2200.01.01'},resources:{minerals:{stockpile:1000,net:0}},outliner:{sectors_summary:{capital_system:'太阳'}}}),
   get_alerts:()=>showAlert?[{type:'test_new_alert'}]:[],
   get_colony_automation:()=>({known:true,enabled:false,planet_id:0,colony_id:0,owner_id:0,queue:{known:true,queue_id:0,items:[]}}),
   get_planet_details:()=>({planet_id:0,colony_id:0,designation_key:'col_capital',construction_queue:[],kpi:{housing:20}}),
   get_buildable_districts:()=>({success:true,planet_id:0,colony_id:0,current:[{key:'district_city',built:1}],buildable:[]})
  },{localWaitPilot:alert});
  game.gestalt.data.colonyRoutines=[{id:'original',sessionId:game.sessionId,status:'waiting',planetId:0,colonyId:0,ownerId:0,queueId:0,designation:'col_capital',districtKey:'district_city',createdDate:'2200.01.01',maxBuilds:1,budget:{minerals:500},remainingBudget:{minerals:0},actions:[{status:'queued',queueItemId:0,date:'2200.01.01',cost:{minerals:500},beforeCount:0,beforeItems:[]}]}];
  showAlert=alert;const n=calls.length;
  if(alert)await game.monitorDecision(0);
  else{const result=await game.watch(20);assert.deepEqual(result.wakeReasons,['local_work_completed']);assert.equal(result.waitPolicy.effectiveSeconds,0);}
  assert.equal(game.gestalt.data.colonyRoutines[0].status,'completed');
  assert.equal(calls.slice(n).some(c=>c.method==='set_paused'&&c.params.paused===false||c.method==='build_district'),false);
  if(alert)assert.ok(game.decisionPause.reasons.includes('new_alert'));
 }
});

test('reserves do not block movement of existing invasion forces or quota edits without an immediate purchase',async t=>{
 const {game,calls}=await fixture(t,{
  get_landing_options:()=>({success:true,legal:true}),land_armies:()=>({success:true}),
  get_invasion_state:()=>({success:true,planet_id:0,occupied_by_player:true}),
  set_fleet_template_quota:()=>({success:true})
 });
 game.gestalt.data.monthlyTrades=[{sessionId:game.sessionId,status:'order_registered',reservation:{trade:10}}];
 game.gestalt.data.campaign={phase:'prepare',execution:{resourceFloors:{alloys:100}}};
 const r=await game.apply({requestId:'land-with-reserve',snapshotId:game.snapshotId,orders:[{command:'land_armies',arguments:{fleet_id:1,planet_id:0}}]});assert.equal(r.orders[0].status,'posted');assert.equal(calls.filter(c=>c.method==='land_armies').length,1);
});

test('monthly recover clears one explicitly selected old-session order through normal cancellation and refreshes visible recovery state',async t=>{
 const orders=[{order_id:0,resource:'food',action:'buy',amount:1,max_unit_price:2},{order_id:9,resource:'food',action:'sell',amount:1,max_unit_price:0}];
 const {game,calls}=await fixture(t,{
  get_status:()=>({in_game:true,is_paused:true,date:{formatted:'2200.01.01'},outliner:{sectors_summary:{capital_system:'太阳'}}}),
  get_market:()=>({monthly_trades:structuredClone(orders),monthly_trade_country_id:0,monthly_trades_complete:true,active_monthly_trades_count:orders.length}),
  set_monthly_trade:p=>{assert.equal(p.cancel,true);assert.equal(p.order_id,0);orders.shift();return {success:true};}
 });
 game.gestalt.data.monthlyTrades=[{sessionId:'old',requestId:'stale',status:'order_registered',ownedOrder:{order_id:0,resource:'food',action:'buy',amount:1,price_limit:2},reservation:{trade:2},before:{countryId:0,scope:{sessionId:'old',pid:42,creationTime:'fixed',gameDate:'2200.01.01'}}}];
 assert.equal(game.monthlyControlView().recovery.count,1);
 const r=await game.monthlyTrade({operation:'recover',previousSessionId:'old',requestId:'stale',snapshotId:game.snapshotId});assert.equal(r.confirmed,true);assert.equal(r.controlReleased,true);assert.equal(r.automaticResume,false);assert.equal(game.lastState.monthlyControl.recovery.count,0);assert.deepEqual(orders.map(o=>o.order_id),[9]);assert.equal(calls.filter(c=>c.method==='set_monthly_trade').length,1);
});

test('local pre-send rejection marks the outbox unsent, cancels unused task commitment and returns the original housing allowance',async t=>{
 let reads=0;const {game,calls}=await fixture(t,{
  get_status:()=>({in_game:true,is_paused:true,date:{formatted:'2200.01.01'},resources:{minerals:{stockpile:1000,net:0}},outliner:{sectors_summary:{capital_system:'太阳'}}}),
  get_colony_automation:()=>({known:true,enabled:false,planet_id:0,owner_id:0,colony_id:0,queue:{known:true,queue_id:0,items:[]}}),
  get_planet_details:()=>({planet_id:0,colony_id:0,kpi:{housing:2},designation_key:'col_capital',construction_queue:[],districts:[]}),
  get_buildable_districts:()=>({success:true,planet_id:0,colony_id:0,current:[{key:'district_city',built:0}],buildable:[{key:'district_city',can_build:true,cost:{minerals:++reads>=3?200:100}}]})
 });
 const policy={planetId:0,goal:'不足预算不能派发',districtKey:'district_city',housingTarget:10,maxBuilds:1,budget:{minerals:100},reviewDays:30};
 await game.colonyControl({operation:'delegate',snapshotId:game.snapshotId,policy});await game.colonyControl({operation:'advance',snapshotId:game.snapshotId});
 const r=game.gestalt.data.colonyRoutines[0];assert.equal(r.remainingBudget.minerals,100);assert.equal(r.actions[0].receipt.nativeWriteAttempted,false);assert.equal(r.reviewRequired,true);assert.equal(calls.some(c=>c.method==='build_district'),false);
 assert.equal(game.gestalt.commitments().minerals??0,0);assert.equal(game.gestalt.data.actions[0].nativeWriteAttempted,false);
});
test('an exception after a possible construction send never turns into an unsent refund',async t=>{
 const {game}=await fixture(t);const action={requestId:'after-send',cost:{minerals:100}},order={command:'build_district',arguments:{planet_id:0,district_key:'district_city'}};
 const observe=game.observe.bind(game);game.observe=async()=>{game.lastState.resources={minerals:{stockpile:1000,net:0}};return game.lastState;};
 const apply=game.apply.bind(game);game.apply=async args=>{game.gestalt.data.actions.push({taskId:args.taskId,status:'issued',order});throw Error('receipt persistence failed after possible send');};
 try{const r=await game.executeColonyOrder({record:{goal:'保持未知动作防重'},action,order});assert.equal(r.status,'unknown');assert.notEqual(r.nativeWriteAttempted,false);assert.equal(game.gestalt.data.tasks.find(t=>t.id===action.taskId).status,'ready');}finally{game.apply=apply;game.observe=observe;}
});

// Prepared during implementation-only work. These cases have not been run.
test('normal stop refuses pause and cleanup writes after process, empire or date binding changes',async t=>{
 for(const mode of ['process','country','rollback']){
  let country=0,date='2200.01.01',paused=true;
  const {game,calls}=await fixture(t,{
   get_status:()=>({in_game:true,is_paused:paused,date:{formatted:date},outliner:{sectors_summary:{capital_system:'太阳'}}}),
   get_galaxy_overview:()=>({player:{country_id:country,capital_system_id:0}}),
   set_paused:p=>{paused=p.paused;return {success:true};}
  });
  const before=calls.length;if(mode==='process')game.processReader=async()=>({pid:99,creationTime:'other'});if(mode==='country')country=1;if(mode==='rollback')date='2199.12.30';
  await game.stop();assert.equal(calls.slice(before).some(c=>['set_paused','set_monthly_trade','set_survey_automation'].includes(c.method)),false);assert.equal(game.cleanup.pauseConfirmed,false);assert.equal(game.cleanup.bindingConfirmed,false);assert.equal(game.runtimeStatus.paused,null);
 }
});
test('stop seals immediately, drains in-flight work and coalesces parallel stop calls before using the single native pipe',async t=>{
 let paused=false;const {game,calls}=await fixture(t,{
  get_status:()=>({in_game:true,is_paused:paused,date:{formatted:'2200.01.01'},outliner:{sectors_summary:{capital_system:'太阳'}}}),
  set_paused:p=>{paused=p.paused;return {success:true};}
 });
 let release;game.monthlyBusy=new Promise(done=>release=done);const before=calls.length;let secondFinished=false;
 const first=game.stop(),second=game.stop().then(()=>secondFinished=true);
 await new Promise(done=>setImmediate(done));assert.equal(game.stoppingRequested,true);assert.equal(secondFinished,false);assert.equal(calls.slice(before).some(c=>c.method==='set_paused'),false);
 release();await Promise.all([first,second]);assert.equal(calls.slice(before).filter(c=>c.method==='set_paused').length,1);assert.equal(game.cleanup.pauseConfirmed,true);
});
test('watch returns explicit runtime completion and performs cleanup without unpausing beyond its original deadline',async t=>{
 let paused=false;const {game,calls,advance}=await fixture(t,{
  get_status:()=>({in_game:true,is_paused:paused,date:{formatted:'2200.01.01'},outliner:{sectors_summary:{capital_system:'太阳'}}}),set_paused:p=>{paused=p.paused;return {success:true};}
 });
 advance(600001);const before=calls.length,r=await game.watch(20);assert.equal(r.runtimeComplete,true);assert.equal(r.remainingSeconds,0);assert.deepEqual(r.wakeReasons,['runtime_complete']);assert.equal(calls.slice(before).some(c=>c.method==='set_paused'&&c.params.paused===false),false);assert.equal(game.cleanup.pauseConfirmed,true);
});
test('watch window is shortened to the remaining authorization instead of consuming a full ordinary window',async t=>{
 const {game}=await fixture(t);game.ends=game.now()+20;
 const r=await game.watch(20);assert.equal(r.waitPolicy.requestedSeconds,20);assert.ok(r.waitPolicy.effectiveSeconds<=.02);assert.ok(r.waitPolicy.effectiveSeconds>=0);
});
test('ordinary RPC writes reject a changed process or player before the target command is sent',async t=>{
 for(const mode of ['process','player','invalid-date']){
  let player=0,date='2200.01.01';const {game,calls}=await fixture(t,{get_status:()=>({in_game:true,is_paused:true,date:{formatted:date},outliner:{sectors_summary:{capital_system:'太阳'}}}),get_galaxy_overview:()=>({player:{country_id:player,capital_system_id:0}})});
  if(mode==='process')game.processReader=async()=>({pid:99,creationTime:'other'});else if(mode==='player')player=1;else date='2200.13.01';
  const before=calls.length;await assert.rejects(game.rpc('move_fleet',{fleet_id:1,system_id:1}),e=>e.nativeWriteAttempted===false&&/身份|绑定|日期/.test(e.message));
  assert.equal(calls.slice(before).some(c=>c.method==='move_fleet'),false);
 }
});
test('a reviewed native rejection remains a rejected command rather than poisoning the whole session as unknown',async t=>{
 const {game}=await fixture(t,{set_fleet_stance:()=>{const e=Error('rejected by the engine');e.rejected=true;e.nativeWriteAttempted=true;throw e;}});
 const r=await game.apply({requestId:'known-native-refusal',snapshotId:game.snapshotId,orders:[{command:'set_fleet_stance',arguments:{fleet_id:1,stance:'evasive'}}]});
 assert.equal(r.orders[0].status,'rejected');assert.equal(r.orders[0].nativeWriteAttempted,true);assert.equal(game.uncertain,false);
});
test('monthly phase-two budget exclusion requires the exact persisted current record and preserves other commitments',async t=>{
 const {game}=await fixture(t);const own={sessionId:game.sessionId,requestId:'own',status:'prepared',steps:[],reservation:{trade:20}},other={sessionId:game.sessionId,requestId:'other',status:'prepared',steps:[],reservation:{trade:15}};
 game.gestalt.data.monthlyTrades=[own,other];game.gestalt.data.tasks.push({id:'other-task',status:'ready',budget:{trade:30}});game.gestalt.data.campaign={phase:'prepare',execution:{resourceFloors:{trade:100}}};
 assert.equal(game.delegationBudgetOptions().commitments.trade,65);const options=game.delegationBudgetOptions({excludeMonthlyRecord:own});assert.equal(options.commitments.trade,45);assert.equal(options.floors.trade,100);
 assert.throws(()=>game.delegationBudgetOptions({excludeMonthlyRecord:structuredClone(own)}),/非持久/);own.sessionId='foreign';assert.throws(()=>game.delegationBudgetOptions({excludeMonthlyRecord:own}),/其他会话/);own.sessionId=game.sessionId;
});

test('construction bundle is available through NativeGame only for owned colonies and never submits game writes',async t=>{
 const {game,calls}=await fixture(t,{
  get_planet_details:()=>({planet_id:0,colony_id:0,kpi:{housing:2},construction_queue:[]}),
  get_buildable_buildings:()=>({success:true,planet_id:0,colony_id:0,zones:[]}),
  get_buildable_districts:()=>({success:true,planet_id:0,colony_id:0,current:[],buildable:[]})
 });
 game.lastState.colonies=[{colonies_summary:[{planet_id:0}]}];const n=calls.length;
 const r=await game.inspect({topic:'construction',id:0});assert.equal(r.allRequestedKnown,false);assert.equal(r.sections.buildings.known,false);assert.equal(r.planet.colony_id,0);assert.equal(game.colonyReviews.has(0),true);assert.ok(JSON.stringify(game.operationalContext.view()).includes('星球0'));
 assert.equal(calls.slice(n).some(c=>!c.method.startsWith('get_')&&c.method!=='ping'),false);
 await assert.rejects(game.inspect({topic:'construction',id:1}),/己方/);
 await assert.rejects(game.inspect({topic:'construction'}),/需要 id/);
 await assert.rejects(game.inspect({topic:'planet',id:0,sections:['jobs']}),/sections仅用于/);
});

test('a regular empire can bind and configure an existing war without declaring it again',async t=>{
 const wars=[{war_id:0,primary_attacker_id:0,primary_defender_id:2,player_side:'attacker',attacker_goal:{key:'wg_conquest'}}];
 const {game,calls}=await fixture(t,{get_government:()=>({authority:'auth_democratic'}),get_wars:()=>({wars}),get_fleet_tactics:()=>({fleets:[{fleet_id:0,total_ships:5,system_id:0}]}),get_system:()=>({id:9,owner_id:2,planets:[{id:0,colony_id:0,owner_id:2}]})});
 await game.campaign({operation:'select',target:2,reason:'继续当前征服战',reviewDate:'2201.01.01'});await game.campaign({operation:'bind-war',warId:0});
 assert.equal(game.gestalt.data.campaign.enabled,undefined);assert.match(game.gestalt.data.campaign.nextCheck,/start/);
 await game.campaign({operation:'start',fleetId:0,transportId:1,rallySystem:0,targetSystem:9,planets:[0],goalKey:'wg_conquest',finishDate:'2202.01.01'});
 const c=game.gestalt.data.campaign;assert.equal(c.enabled,true);assert.equal(c.phase,'combat');assert.equal(c.warId,0);assert.deepEqual(c.participants,{attacker:0,defender:2});assert.equal(c.baseline.objectives[0].ownerId,2);assert.equal(calls.some(c=>c.method==='declare_war'),false);
});
test('target discovery uses named map columns and does not turn unknown enemy power into zero',async t=>{
 const {game}=await fixture(t,{get_contacts:()=>({empires:[{country_id:2,name:'邻国',country_type:'default',has_communications:true}]}),get_galaxy_map:()=>({columns:['flags','intel','jumps','owner_id','name','id'],rows:[['C',3,2,2,'目标',9]]}),get_system:()=>({id:9,intel:3,planets:[{id:0,colony_id:0,owner_id:2}],fleets:[{owner_id:2,ship_class:'shipclass_military',military_power:null}]})});
 const r=await game.inspect({topic:'targets',system_id:0});assert.equal(r.center_system_id,0);assert.equal(r.candidates[0].system_id,9);assert.equal(r.candidates[0].known_colonies[0].planet_id,0);assert.equal(r.candidates[0].visible_orbital_power,null);assert.equal(r.candidates[0].total_enemy_and_ally_power_known,false);assert.equal(r.automaticWarAuthorized,false);
});

test('peace can retarget only the same enemy while recovery can replace its missing navy without transport',async t=>{
 let wars=[{war_id:0,primary_attacker_id:0,primary_defender_id:2,player_side:'attacker'}],owner=2;
 const {game,calls}=await fixture(t,{get_wars:()=>({wars}),get_fleet_tactics:()=>({fleets:[{fleet_id:2,total_ships:5,system_id:0}]}),get_war_fleets:()=>({success:true,fleets:[{fleet_id:1,ship_class:'shipclass_transport',embarked_armies:2}]}),get_system:()=>({id:12,owner_id:owner,planets:[{id:4,colony_id:0,owner_id:owner}]})});
 const c=game.gestalt.data.campaign={enabled:true,phase:'peace',target:2,warId:0,participants:{attacker:0,defender:2},history:[],execution:{fleetId:2,transportId:1,minShips:1,planets:[0],targetSystem:9,finishDate:'2202.01.01'},actions:{attack:{status:'posted'}},baseline:{ships:5,objectives:[{planetId:0,ownerId:2,systemId:9}]}};
 owner=3;await assert.rejects(game.campaign({operation:'revise',targetSystem:12,planets:[4],reason:'占领新目标'}),/原敌国/);assert.equal(c.execution.targetSystem,9);
 owner=2;await game.campaign({operation:'revise',targetSystem:12,planets:[4],reason:'继续推进同一敌国战役'});assert.equal(c.phase,'combat');assert.equal(c.execution.targetSystem,12);assert.deepEqual(c.baseline.objectives.map(x=>x.planetId),[0,4]);assert.equal(c.actions.attack,undefined);
 c.phase='recover';wars=[];c.execution.fleetId=0;c.execution.transportId=7;await game.campaign({operation:'revise',fleetId:2,reason:'战后替换失去的主力'});assert.equal(c.execution.fleetId,2);assert.equal(c.phase,'recover');assert.equal(calls.some(x=>x.method==='declare_war'),false);
});

test('known uncolonized border targets configure through normal campaign without an army, unknown colonies cannot',async t=>{
 let intel=4;
 const {game,calls}=await fixture(t,{get_government:()=>({authority:'auth_democratic'}),get_contacts:()=>({empires:[{country_id:2,name:'邻国',country_type:'default',has_communications:true}]}),get_galaxy_map:()=>({columns:['flags','intel','jumps','owner_id','name','id'],rows:[['SB',4,1,2,'边境',9]]}),get_fleet_tactics:()=>({fleets:[{fleet_id:0,total_ships:5,system_id:0}]}),get_system:()=>({id:9,owner_id:2,surveyed:true,intel,planets:[{id:100}],fleets:[{owner_id:2,ship_class:'shipclass_starbase',military_power:200}]})});
 const r=await game.inspect({topic:'targets'});assert.equal(r.candidates[0].systemOnlyConfirmed,true);assert.equal(r.candidates[0].objectiveType,'uncolonized_system');assert.equal(r.candidates[0].blockedReason,undefined);
 await game.campaign({operation:'select',target:2,reason:'获得边境通道',reviewDate:'2201.01.01'});
 const config={operation:'start',fleetId:0,rallySystem:0,targetSystem:9,planets:[],goalKey:'wg_conquest',finishDate:'2202.01.01'};
 intel=1;await assert.rejects(game.campaign(config),/无殖民地情报/);assert.equal(game.gestalt.data.campaign.execution,undefined);
 intel=4;await game.campaign(config);assert.deepEqual(game.gestalt.data.campaign.execution.planets,[]);assert.equal(game.gestalt.data.campaign.execution.transportId,undefined);assert.equal(game.gestalt.data.campaign.baseline.systems[0].ownerId,2);assert.equal(calls.some(c=>c.method==='declare_war'),false);
});

test('claims always reprice and send a native cap while preserving unrelated and influence reservations',async t=>{
 let claims=0;
 const resources={energy:{stockpile:1000,net:10},alloys:{stockpile:1000,net:10},influence:{stockpile:500,net:0}};
 const {game,calls}=await fixture(t,{get_status:()=>({in_game:true,is_paused:true,date:{formatted:'2200.01.01'},resources}),get_claim_quote:p=>({success:true,system_id:p.system_id,action:'add',count:1,legal:true,cost_basis:'engine_add_system_claim_cost',influence_cost_fixed:5500123,cost:{influence:55.00123}}),get_system:p=>({id:p.system_id,player_claims:claims,fleets:[]}),claim_system:()=>{claims++;return {success:true,player_claims_before:0,count:1};}});
 game.gestalt.commitments=()=>({influence:300,minerals:200});
 game.gestalt.data.campaign={phase:'prepare',execution:{resourceFloors:{influence:100}}};
 const result=await game.apply({requestId:'claim-real-cost',snapshotId:game.snapshotId,orders:[{command:'claim_system',arguments:{system_id:9}}]});
 assert.equal(result.orders[0].status,'posted');assert.equal(result.orders[0].verification.verified,true);assert.equal(calls.find(x=>x.method==='claim_system').params.max_influence_cost_fixed,5500123);assert.equal(game.gestalt.data.actions[0].spendingAdmission.cost.influence,55.00123);
});
test('claim budget shortages and empty task allocations never reach the native write',async t=>{
 for(const taskBudget of [undefined,{}]){
 const resources={energy:{stockpile:1000,net:10},alloys:{stockpile:1000,net:10},influence:{stockpile:100,net:0}};
 const {game,calls}=await fixture(t,{get_status:()=>({in_game:true,is_paused:true,date:{formatted:'2200.01.01'},resources}),get_claim_quote:p=>({success:true,system_id:p.system_id,action:'add',count:1,legal:true,cost_basis:'engine_add_system_claim_cost',influence_cost_fixed:6000000,cost:{influence:60}})});
 const orders=[{command:'claim_system',arguments:{system_id:9}}];let taskId;
 if(taskBudget){const task=await game.gestalt.add({goal:'不能用空预算宣称',orders,budget:taskBudget},game.lastState);taskId=task.id;}else game.gestalt.commitments=()=>({influence:50});
 const result=await game.apply({requestId:'claim-blocked',snapshotId:game.snapshotId,orders,taskId});assert.equal(result.orders[0].status,'deferred');assert.equal(calls.some(x=>x.method==='claim_system'),false);
 }
});
test('tasks run honors an explicit ready id and malformed task orders have a useful error',async t=>{
 const {game,calls}=await fixture(t);await game.task({operation:'add',task:{goal:'high',orders:[{command:'set_speed',arguments:{speed:1}}],priority:100}});
 const selected=await game.task({operation:'add',task:{goal:'selected',orders:[{command:'set_speed',arguments:{speed:2}}],priority:1}});const target=selected.tasks.find(t=>t.goal==='selected');
 await game.task({operation:'run',id:target.id});assert.equal(calls.filter(c=>c.method==='set_speed').at(-1).params.speed,2);
 await assert.rejects(game.task({operation:'run',id:'missing'}),/不会改跑/);
 await assert.rejects(game.task({operation:'add',task:{goal:'bad',orders:{command:'set_speed'}}}),/orders数组/);
});

test('bounded acceptance speed is enforced before any order in a batch is sent',async t=>{
 const {game,calls}=await fixture(t,{}, {maximumGameSpeed:2});const n=calls.length;
 await assert.rejects(game.apply({requestId:'too-fast',snapshotId:game.snapshotId,orders:[{command:'set_speed',arguments:{speed:3}}]}),/速度上限为2/);assert.equal(calls.length,n);
});

test('war goal inspection returns compact current legality and on-demand exact details with country-scoped facts',async t=>{
 const {game,calls}=await fixture(t,{get_attack_options:p=>({country_id:p.country_id,options:[{goal_key:'wg_conquest',legal:false,reason:'先宣称'},{goal_key:'wg_plunder',legal:false,reason:'x'.repeat(10000)}]})});
 const v=await game.inspect({topic:'attack_options',id:2});assert.equal(v.options[1].reason,undefined);assert.equal(v.options[0].reason,'先宣称');assert.equal(game.operationalContext.view()[0].countryId,2);
 const detail=await game.inspect({topic:'attack_options',id:2,goal_key:'wg_plunder'});assert.equal(detail.options[0].reason.length,10000);
 const n=calls.length;await assert.rejects(game.inspect({topic:'military',goal_key:'wg_conquest'}),/仅用于/);assert.equal(calls.length,n);
});

test('terminating after observed war end preserves territorial readback and leaves recovery explicitly pending',async t=>{
 const {game}=await fixture(t,{get_wars:()=>({wars:[]}),get_fleet_tactics:()=>({fleets:[{fleet_id:0,total_ships:5,system_id:0}]}),get_system:p=>({id:p.system_id,owner_id:0,fleets:[]})});
 const c=game.gestalt.data.campaign={enabled:true,phase:'peace',target:2,warId:0,history:[],execution:{fleetId:0,planets:[]},baseline:{ships:5,systems:[{systemId:9,ownerId:2}],objectives:[]}};
 await game.campaign({operation:'terminate',reason:'结束自动战役并检查战后任务'});assert.equal(c.enabled,false);assert.equal(c.result.warEnded,true);assert.deepEqual(c.result.gainedSystems,[9]);assert.equal(c.nextCampaignReview.recoveryRequired,true);assert.equal(c.recoveryEvidence,undefined);
});
test('fleet stance is confirmed from the current own fleet row instead of leaving a permanent unconfirmed action',async t=>{
 const {game}=await fixture(t,{get_fleet_tactics:()=>({fleets:[{fleet_id:0,system_id:0}]}),get_system:()=>({id:0,fleets:[{id:0,own:true,stance:'aggressive'}]})});
 const proof=await game.verifyOrder({command:'set_fleet_stance'},{fleet_id:0,stance:'aggressive'},{});assert.equal(proof.verified,true);assert.equal(proof.phase,'fleet_stance_readback');
});

test('configuring a bound war cannot relabel its existing war goal',async t=>{
 const {game}=await fixture(t,{get_government:()=>({authority:'auth_democratic'}),get_wars:()=>({wars:[{war_id:0,primary_attacker_id:0,primary_defender_id:2,player_side:'attacker',attacker_goal:{key:'wg_subjugation'}}]})});
 await game.campaign({operation:'select',target:2,reason:'推进既有战争',reviewDate:'2201.01.01'});await game.campaign({operation:'bind-war',warId:0});
 await assert.rejects(game.campaign({operation:'start',fleetId:0,rallySystem:0,targetSystem:9,planets:[],goalKey:'wg_conquest',finishDate:'2202.01.01'}),/己方真实战争目标/);assert.equal(game.gestalt.data.campaign.execution,undefined);
});


test('country AI host fences routine writes, forwards world zero, and retains key control after takeover',async t=>{
 let paused=true,on=false,world=0,phase='idle',generation=0,physicsKey='tech_old';
 const nativeState=()=>({success:true,country_id:0,paused,single_local_human_guard:true,world_generation_tracking:true,
  global_flags:{normal_ai:true,human_ai:on,force_human_ai:on},precondition:{world_generation:world,country_id:0,country_address:123,date:'2200.01.01',sequence:0,global_flags:{human_ai:on,force_human_ai:on}}});
 const {game,calls}=await fixture(t,{
  ping:()=>({bridge_version:'cyberfish-0.6.16-country-ai-p1-r2',features:['building_upgrade_candidates','building_upgrade_queue_identity','ship_design_naval_size','zone_building_membership','owned_shipyard_queues','engine_market_transaction_quotes','normal_war_actions','country_ai_own_session_post_gate','country_ai_command_clone_lifetime','country_ai_native_queue_gate','country_ai_game_update_lease','country_ai_world_generation','country_ai_serialized_execution_receipts']}),
  get_status:()=>({in_game:true,is_paused:paused,date:{formatted:'2200.01.01'},outliner:{sectors_summary:{capital_system:'太阳'}}}),
  get_country_ai_state:nativeState,
  get_research_state:()=>({physics:{current:{is_researching:true,key:physicsKey},candidates:[{key:'tech_new',cost:1}]}}),
  select_research:p=>{physicsKey=p.tech_key;return {success:true};},
  set_paused:p=>{paused=p.paused;return {success:true};},
  country_ai_lease:async p=>{
   if(p.action==='prepare'){phase='prepared';generation++;}
   if(p.action==='enable'){const saved=JSON.parse(await readFile(join(game.directory,'latest-session.json')));assert.equal(saved.countryAIControl.generation,generation);assert.equal(saved.countryAIControl.worldScope.world_generation,0);phase='ready_paused';on=true;}
   if(p.action==='run'){phase='running';paused=false;}
   if(p.action==='stop'){phase='stopped';paused=true;on=false;}
   return {success:true,phase,generation,last_native_state:nativeState(),routine_gate:{armed:!['idle','stopped'].includes(phase)},observation:{armed:!['idle','stopped'].includes(phase)}};
  }
 },{nativeCountryAI:true});
 await assert.rejects(game.apply({requestId:'no-handoff',snapshotId:game.snapshotId,strategicResearchOverride:true,explanation:'当前优先发展科研能力',orders:[{command:'select_research',arguments:{slot:'physics',tech_key:'tech_new'}}]}),/尚无本轮/);
 await game.countryAIControl({operation:'delegate',maxWallSeconds:30});
 await assert.rejects(game.rpc('select_research',{area:'physics',tech_key:'tech_key'}),/封口/);
 await assert.rejects(game.apply({}),/先通过国家 AI 接管/);
 assert.equal(calls.filter(c=>c.method==='select_research').length,0);
 assert.equal(game.nativeRoutineSuppressed,true);
 const prepare=calls.find(c=>c.params?.action==='prepare');assert.equal(prepare.params._expected_world_generation,0);
 assert.equal(prepare.params._expected_game_pid,42);assert.equal(prepare.params._expected_game_creation,'fixed');
 await game.countryAIControl({operation:'takeover'});
 assert.equal(game.nativeCountryAIFence,false);assert.equal(game.nativeRoutineSuppressed,true);
 const normal=await game.apply({requestId:'keep-current',snapshotId:game.snapshotId,orders:[{command:'select_research',arguments:{slot:'physics',tech_key:'tech_new'}}]});
 assert.equal(normal.orders[0].status,'already_researching');assert.equal(physicsKey,'tech_old');
 const strategic=await game.apply({requestId:'strategic-key',snapshotId:game.snapshotId,strategicResearchOverride:true,explanation:'接管后转向当前战略科研重点',orders:[{command:'select_research',arguments:{slot:'physics',tech_key:'tech_new'}}]});
 assert.equal(strategic.orders[0].verification.verified,true);assert.equal(physicsKey,'tech_new');
 assert.equal(calls.filter(c=>c.method==='select_research').length,1);
 world=1;
 await assert.rejects(game.countryAIControl({operation:'resume'}),/世界|代次/);
 assert.equal(calls.filter(c=>c.params?.action==='prepare').length,1);
 world=0;
});

test('economic candidate host persists strategic protection and hands it to native resume without routine orders',async t=>{
 let paused=true,on=false,phase='idle',generation=0,policy='',protectedTargets={jobs:[],colonies:[],shipyards:[]};
 const nativeState=()=>({success:true,country_id:0,paused,single_local_human_guard:true,world_generation_tracking:true,
  global_flags:{normal_ai:true,human_ai:on,force_human_ai:on},precondition:{world_generation:0,country_id:0,country_address:123,date:'2200.01.01',sequence:0,global_flags:{human_ai:on,force_human_ai:on}}});
 const {game,calls}=await fixture(t,{
  ping:()=>({bridge_version:COUNTRY_AI_ECONOMY_CANDIDATE_VERSION,features:[...COUNTRY_AI_P1_FEATURES,...COUNTRY_AI_ECONOMY_FEATURES,
   'building_upgrade_candidates','building_upgrade_queue_identity','ship_design_naval_size','zone_building_membership','owned_shipyard_queues','engine_market_transaction_quotes','normal_war_actions']}),
  get_status:()=>({in_game:true,is_paused:paused,date:{formatted:'2200.01.01'},outliner:{sectors_summary:{capital_system:'太阳'}}}),
  get_country_ai_state:nativeState,set_paused:p=>{paused=p.paused;return {success:true};},
  country_ai_lease:p=>{
   if(p.action==='prepare'){phase='prepared';generation++;policy=p.policy;protectedTargets=structuredClone(p.protected_targets);}
   if(p.action==='enable'){phase='ready_paused';on=true;}
   if(p.action==='run'){phase='running';paused=false;}
   if(p.action==='stop'){phase='stopped';paused=true;on=false;}
   return {success:true,phase,generation,last_native_state:nativeState(),routine_gate:{armed:!['idle','stopped'].includes(phase),
    protected_targets:protectedTargets,economic_administration_allowed:policy.startsWith('economy'),ship_production_allowed:policy==='economy_and_ship_production'},
    observation:{armed:!['idle','stopped'].includes(phase),commands_drained:true}};
  }
 },{nativeCountryAI:true,nativeCountryAIEconomyCandidate:true});
 await game.countryAIControl({operation:'delegate',policy:'economy_and_ship_production',maxWallSeconds:30});
 await assert.rejects(game.countryAIControl({operation:'protect',protectedTargets:{colonies:[0]},reason:'保留工业方向'}),/接管/);
 await game.countryAIControl({operation:'takeover'});
 const protectedView=await game.countryAIControl({operation:'protect',protectedTargets:{colonies:[0],shipyards:[0]},reason:'保留工业定位和关键造船干预'});
 assert.equal(protectedView.control.protectionStatus,'pending_native_revalidation');
 const saved=JSON.parse(await readFile(join(game.directory,'latest-session.json')));
 assert.deepEqual(saved.countryAIControl.protectedTargets,{jobs:[],colonies:[0],shipyards:[0]});
 await assert.rejects(game.countryAIControl({operation:'resume',protectedTargets:{}}),/不能被其他操作静默覆盖/);
 const returned=await game.countryAIControl({operation:'resume',maxWallSeconds:30});
 assert.equal(returned.control.protectionStatus,'native_arm_confirmed');assert.equal(returned.control.owner,'native');
 assert.deepEqual(calls.filter(c=>c.params?.action==='prepare').at(-1).params.protected_targets,{jobs:[],colonies:[0],shipyards:[0]});
 assert.equal(calls.some(c=>['build_ship','set_job_workforce_limit','select_research'].includes(c.method)),false);
 await game.countryAIControl({operation:'stop'});
});
