import test from 'node:test';import assert from 'node:assert/strict';
import {bindFleetExploration,recordExplorationLeg,syncExplorationLegs,planExplorationLeg} from '../src/persistent-fleet-exploration.mjs';

test('真实一跳到达保留持续目标，独立选择器复用邻接与风险事实且无原生保护不并行派单',async()=>{
 const state={date:'2210.01.01',player:{country_id:0},wars:[],resources:{},userEconomicPolicy:{version:1,source:'user-current-chat',militaryPolicy:'exploration_until_threat'}};
 const data=bindFleetExploration(null,'same-world','2210.01.01');
 assert.equal(recordExplorationLeg(data,{state,fleetId:3,fromSystemId:23,targetSystemId:62,trackingId:'leg-1',accepted:true}),true);
 let calls=0;const idleRpc=async()=>{calls++;throw Error('不应额外查询');};
 assert.equal((await planExplorationLeg(data,{state,fleetId:3,rpc:idleRpc,protectionConfirmed:true})).status,'waiting');assert.equal(calls,0);
 syncExplorationLegs(data,{state,orders:[{id:'leg-1',command:'move_fleet',arguments:{fleet_id:3,system_id:62},status:'completed'}]});
 assert.equal(data.fleets[0].phase,'planning');assert.deepEqual(data.fleets[0].visited,[23,62]);
 const unprotected=await planExplorationLeg(data,{state,fleetId:3,rpc:idleRpc});
 assert.equal(unprotected.status,'needs_native_fleet_protection');assert.equal(unprotected.allowNativeEconomy,true);assert.equal(calls,0);
 const origin={id:62,intel:4,owner_id:0,hyperlanes:[{to:23},{to:80},{to:90}],fleets:[{id:3,own:true,ship_class:'shipclass_military',stance:'passive'}]};
 const readCalls=[],rpc=async(method,p)=>{
  readCalls.push({method,p});assert.match(method,/^(get_|find_)/);
  if(method==='get_wars')return {wars:[],warGoalsWindow:false};
  if(method==='get_fleet_tactics')return {fleets:[{fleet_id:3,system_id:62,total_ships:10,status:'无指令',available_to_merge:true}]};
  if(method==='find_path')return {fleet_id:3,from_system_id:62,to_system_id:p.to_system_id,reachable:true,systems:[{id:62},{id:p.to_system_id}]};
  if(method==='get_system')return p.system_id===62?origin:{id:p.system_id,intel:p.system_id===80?4:0,owner_id:p.system_id===80?2:null,starbase:null,fleets:[]};
 };
 const next=await planExplorationLeg(data,{state,fleetId:3,rpc,protectionConfirmed:true});
 assert.equal(next.status,'ready');assert.equal(next.order.arguments.system_id,90);assert.equal(next.proof.unexploredNeighbour,true);
 assert.equal(readCalls.filter(c=>c.method==='get_wars').length,1);assert.equal(readCalls.filter(c=>c.method==='get_fleet_tactics').length,1);
 assert.equal(data.fleets[0].phase,'planning'); // The selector did not submit anything.
 recordExplorationLeg(data,{state,fleetId:3,fromSystemId:62,targetSystemId:90,trackingId:'leg-2',accepted:true});
 syncExplorationLegs(data,{state,orders:[{id:'leg-2',command:'move_fleet',arguments:{fleet_id:3,system_id:90},status:'executing'}]});
 assert.equal(data.fleets[0].phase,'moving');assert.equal(data.fleets[0].visited.includes(90),false);
 const emergency=await planExplorationLeg(data,{state:{...state,wars:[{war_id:1}]},fleetId:3,rpc:idleRpc,protectionConfirmed:true});
 assert.equal(emergency.status,'yield');assert.equal(data.fleets[0].phase,'suspended');
 assert.deepEqual(bindFleetExploration(data,'another-world','2210.01.01').fleets,[]);
 assert.deepEqual(bindFleetExploration(data,'same-world','2209.01.01').fleets,[]);
});
