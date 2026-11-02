import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import {join,resolve,dirname} from 'node:path';import {tmpdir} from 'node:os';
import {NativeGame} from '../src/native-game.mjs';
import {userEconomicOrderAllowed,assertNativeEconomicOrders,checkEconomicExploration} from '../src/user-economic-intervention.mjs';
import {readActualSpendingCost,checkActualSpending} from '../src/shared-spending-guard.mjs';

test('本人窄干预实际通过空bulk建造，仍受定向费用/人类暂停/白名单与逐路点安全门控',async()=>{
 const policy={version:1,source:'user-current-chat',priority:'unity_first',preferredUnityBuildings:['building_hive_node'],militaryPolicy:'exploration_until_threat'};
 const state={userEconomicPolicy:policy,player:{country_id:0}},order={command:'build_building',arguments:{planet_id:0,building_key:'building_hive_node',district_type:'district_hive',slot_index:0}};
 assert.equal(userEconomicOrderAllowed(order,state),true);assert.throws(()=>assertNativeEconomicOrders([{command:'build_ship',arguments:{}}],state),/封口/);
 assert.throws(()=>assertNativeEconomicOrders([{...order,arguments:{...order.arguments,building_key:'building_lab'}}],state),/封口/);
 const systems=new Map([0,1].map(id=>[id,{id,intel:3,owner_id:id?null:0,hyperlanes:id?[]:[{to:1}],starbase:null,fleets:id?[]:[{id:7,own:true,ship_class:'shipclass_military',stance:'evasive',military_power:100}]}]));
 const move={command:'move_fleet',arguments:{fleet_id:7,system_id:1}},rpc=async method=>{
  if(method==='get_wars')return {wars:[],warGoalsWindow:false};
  if(method==='get_fleet_tactics')return {fleets:[{fleet_id:7,system_id:0,total_ships:10,status:'无指令',available_to_merge:true}]};
 };
 const routeRpc=async(m,p)=>m==='get_system'?systems.get(p.system_id):m==='find_path'?{fleet_id:7,from_system_id:0,to_system_id:1,reachable:true,systems:[{id:0},{id:1}]}:rpc(m,p);
 assert.deepEqual((await checkEconomicExploration(move,state,routeRpc)).route,[0,1]);
 systems.get(0).fleets[0].stance='passive';systems.get(1).owner_id=0;
 assert.equal((await checkEconomicExploration(move,state,routeRpc)).evasiveRequired,false);
 systems.get(1).owner_id=null;systems.get(1).intel=0;
 assert.equal((await checkEconomicExploration(move,state,routeRpc)).observedStance,'passive');
 systems.get(0).fleets[0].stance='aggressive';await assert.rejects(checkEconomicExploration(move,state,routeRpc),/非主动追敌姿态/);systems.get(0).fleets[0].stance='evasive';
 systems.get(1).intel=0;assert.equal((await checkEconomicExploration(move,state,routeRpc)).unexploredNeighbour,true);
 systems.get(0).hyperlanes=[];await assert.rejects(checkEconomicExploration(move,state,routeRpc),/直接相邻/);systems.get(0).hyperlanes=[{to:1}];systems.get(1).intel=3;
 for(const patch of [{owner_id:2},{fleets:[{id:99,own:false,ship_class:'shipclass_military',military_power:1}]}]){
  const previous=systems.get(1);systems.set(1,{...previous,...patch});await assert.rejects(checkEconomicExploration(move,state,routeRpc));systems.set(1,previous);
 }
 await assert.rejects(checkEconomicExploration({command:'set_fleet_stance',arguments:{fleet_id:7,stance:'aggressive'}},state,routeRpc),/未授权/);
 const directory=await mkdtemp(join(tmpdir(),'cyberfish-economic-action-'));let paused=true,built=0,allowed=true;
 const resources={minerals:{stockpile:600,net:10,stockpile_known:true,net_known:true},energy:{stockpile:100,net:10},alloys:{stockpile:100,net:10},unity:{stockpile:50,net:10}};
 const calls=[],pipe={close(){},async request(method,p={}){
  calls.push({method,p});
  if(method==='ping')return {bridge_version:'cyberfish-0.6.6-gestalt-war-r1',features:['building_upgrade_candidates','building_upgrade_queue_identity','ship_design_naval_size','zone_building_membership','owned_shipyard_queues','engine_market_transaction_quotes','normal_war_actions']};
  if(method==='get_status')return {in_game:true,is_paused:paused,date:{formatted:'2201.06.01'},resources,outliner:{sectors_summary:{capital_system:'太阳',sectors:[{colonies_summary:[{planet_id:0}]}]}}};
  if(method==='get_galaxy_overview')return {player:{country_id:0,capital_system_id:0}};
  if(method==='get_picture_state')return {visible:true,rendering:true,frames:1};
  if(method==='get_active_events'||method==='get_alerts')return [];
  if(method==='get_wars')return {wars:[],warGoalsWindow:false};
  if(method==='get_civilian_fleets')return {science_ships:[],construction_ships:[]};
  if(method==='get_fleets')return {fleets:[]};if(method==='get_research_state')return {};
  if(method==='get_government')return {authority:'auth_hive_mind'};
  if(method==='get_planet_details')return {planet_id:0,colony_id:0,name:'地球',kpi:{pop_groups:100},construction_queue:[]};
  if(method==='get_buildable_buildings')return p.building_key?{success:true,planet_id:0,building_key:p.building_key,zones:[{zone_id:0,zone:'zone_default',can_build:allowed,...allowed?{cost:{minerals:400},build_days:360}:{reason:'当前矿物不足400'}}]}:
   {success:true,planet_id:0,colony_id:0,zones:[{zone_id:0,zone:'zone_default',district:'district_hive',buildings:3,max_buildings:6,buildable:[]}]};
  if(method==='set_paused'){paused=p.paused;return {success:true};}
  if(method==='build_building'){built++;resources.minerals.stockpile-=400;return {success:true};}
  return {success:true};
 }};
 const game=new NativeGame({pipe,directory,minutes:5,presentOrders:false,processReader:async()=>({pid:42,creationTime:'offline'}),stopFile:join(directory,'STOP'),guidanceFile:join(directory,'guidance.json')});
 try{
  await game.start({keepPaused:true});game.nativeCountryAIEnabled=true;game.lastState.userEconomicPolicy=policy;
  const human={owner:'human',nativePhase:'stopped',paused:true,ordinaryOrdersBlocked:false,actualFlags:{human_ai:false,force_human_ai:false}};
  game.countryAI.state=async()=>({});game.countryAI.view=()=>human;
  const cost=await readActualSpendingCost(order,(m,p)=>pipe.request(m,p),{forceTargetBuilding:true});assert.deepEqual(cost,{minerals:400});
  assert.throws(()=>checkActualSpending({cost,status:{resources},floors:{minerals:300}}),/维护底线/);
  const wrong=await game.apply({requestId:'owner-node-wrong-zone',snapshotId:game.snapshotId,orders:[{...order,arguments:{...order.arguments,slot_index:4}}],explanation:'优先补突触节点。'});
  assert.equal(wrong.orders[0].status,'rejected');assert.equal(wrong.orders[0].nativeWriteAttempted,false);assert.equal(built,0);
  assert.equal(wrong.orders[0].candidateFeedback.reasonCode,'zone_id_not_found');
  assert.deepEqual(wrong.orders[0].candidateFeedback.actualZones,[{zone_id:0,district:'district_hive',zone_name:null,buildings:3,max_buildings:6}]);
  game.lastState.userEconomicPolicy=policy;
  const result=await game.apply({requestId:'owner-node',snapshotId:game.snapshotId,orders:[order],explanation:'先补凝聚力节点，提高现有殖民地的产能。'});
  assert.equal(result.orders[0].status,'posted');assert.equal(built,1);
  assert.ok(calls.filter(c=>c.method==='get_buildable_buildings'&&c.p.building_key).length>=3);
  allowed=false;await assert.rejects(readActualSpendingCost(order,(m,p)=>pipe.request(m,p),{forceTargetBuilding:true}),/当前矿物不足400/);
  human.owner='native';human.actualFlags.human_ai=true;await assert.rejects(game.confirmManualBuildingControl(),/实际收回/);
  game.nativeCountryAIFence=true;await assert.rejects(game.apply({orders:[order]}),/原生国家 AI/);assert.equal(built,1);
  game.nativeCountryAIFence=false;human.owner='human';human.actualFlags.human_ai=false;paused=false;await assert.rejects(game.confirmManualBuildingControl(),/暂停/);
 }finally{
  paused=true;game.nativeCountryAIEnabled=false;await game.stop();
  if(dirname(directory)!==resolve(tmpdir()))throw Error('测试清理范围不明');await rm(directory,{recursive:true,force:true});
 }
});
