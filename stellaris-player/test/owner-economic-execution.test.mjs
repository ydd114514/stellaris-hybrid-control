import test from 'node:test';import assert from 'node:assert/strict';
import {OrderTracker,makeOrderBaseline} from '../src/order-tracker.mjs';
import {NativeGame} from '../src/native-game.mjs';

test('本人任务真实执行期阻止正常交回，双次完整否定证明取消，真实完工后才自动恢复且危机可让路',async()=>{
 let now=1000,queue=[{item_id:201,key:'building_hive_node'}],complete=true;
 const policy={version:1,source:'user-current-chat',priority:'unity_first',preferredUnityBuildings:['building_hive_node'],militaryPolicy:'exploration_until_threat'};
 const state={date:'2210.01.01',player:{country_id:0},userEconomicPolicy:policy,wars:[],resources:{energy:{stockpile:1000,net:10}}};
 const order={command:'build_building',arguments:{planet_id:3,building_key:'building_hive_node',slot_index:0,district_type:'district_hive'}};
 const zones=[{zone_id:0,district:'district_hive',buildings_known:true,buildings:1,building_instances:[{id:10,key:'building_lab',status:'built'}]}];
 const baseline=makeOrderBaseline(order,{state,planet:{planet_id:3},buildingCandidates:{zones}});
 const tracker=new OrderTracker({sessionId:'same-world',now:()=>now});
 const register=(requestId,item)=>tracker.register({requestId,order,response:{success:true,queue_id:3,colony_id:0},verification:{verified:true,phase:'construction_queue',entry:{item_id:item}},beforeState:state,baseline});
 register('owner-1',201);
 const rpc=async method=>method==='get_colony_automation'?{known:true,planet_id:3,colony_id:0,owner_id:0,queue:{known:true,queue_id:3,items:queue.map(q=>({item_id:q.item_id}))}}:
  method==='get_planet_details'?{planet_id:3,colony_id:0,construction_queue:queue}:{success:true,planet_id:3,colony_id:0,zones:zones.map(z=>({...z,buildings_known:complete}))};
 const poll=async at=>{now=at;await tracker.poll({state,rpc,maxQueries:3,assertScope:async()=>{}});};
 await poll(5000);assert.equal(tracker.view()[0].status,'queued');
 const game=Object.create(NativeGame.prototype);game.nativeCountryAIEnabled=true;game.ownerEconomicReturnPending=true;game.orderTracker=tracker;game.lastState=state;
 game.countryAI={active:false,saved:{scope:'current'},phase:'human',takeoverGeneration:1,view:()=>({owner:'human',paused:false})};game.observe=async()=>game.lastState;
 const held=await game.countryAIControl({operation:'resume'});assert.equal(held.delegationDeferred,true);assert.equal(held.status,'attention');assert.equal(held.nextCall.name,'watch');
 assert.equal(game.ownerEconomicReturnPending,true);
 queue=[{item_id:335,key:'building_physics_lab'}];await poll(11000);assert.equal(tracker.view()[0].status,'queued');
 complete=false;await poll(22000);assert.equal(tracker.view()[0].status,'queued');
 complete=true;await poll(45000);assert.equal(tracker.view()[0].status,'queued');
 await poll(90000);assert.equal(tracker.view()[0].status,'failed');assert.equal(tracker.view()[0].proof.kind,'building_queue_cancelled_no_instance');
 const failure=await game.countryAIControl({operation:'resume'});assert.equal(failure.status,'attention');assert.equal(failure.nextCall.name,'inspect');
 queue=[{item_id:202,key:'building_hive_node'}];register('owner-2',202);assert.equal(tracker.view().filter(t=>t.ownerEconomicTask).length,1);
 queue=[];zones[0].building_instances.push({id:11,key:'building_hive_node',status:'built'});zones[0].buildings=2;
 await poll(100000);assert.equal(tracker.view().find(t=>t.requestId==='owner-2').status,'completed');
 let resumes=0;game.now=()=>now;game.ends=1e9;game.countryAIControl=async input=>{assert.equal(input.operation,'resume');resumes++;return{control:{owner:'native'},state:game.lastState};};
 const returned=await game.settleOwnerEconomicExecution();assert.equal(resumes,1);assert.equal(returned.ownerEconomicExecution.returnedToNative,true);assert.equal(game.ownerEconomicReturnPending,false);

 game.ownerEconomicReturnPending=false;game.countryAI.saved=undefined;
 const needsDelegate=await NativeGame.prototype.countryAIControl.call(game,{operation:'resume'});
 assert.equal(needsDelegate.status,'attention');assert.equal(needsDelegate.nextCall.arguments.operation,'delegate');assert.equal(resumes,1);
 game.ownerEconomicReturnPending=true;game.countryAI.saved={scope:'current'};
 game.orderTracker={view:()=>[{ownerEconomicTask:true,id:'pending-move',command:'move_fleet',arguments:{fleet_id:3,system_id:462},status:'executing'}]};
 game.lastState={...state,resources:{energy:{stockpile:10,net:-5,net_known:true}}};
 const yielded=await game.settleOwnerEconomicExecution();assert.equal(resumes,2);assert.equal(yielded.ownerEconomicExecution.emergency,true);assert.equal(yielded.ownerEconomicExecution.tasks[0].status,'executing');
});
