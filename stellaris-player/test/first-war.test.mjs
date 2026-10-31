import test from 'node:test';
import assert from 'node:assert/strict';
import {createCampaign} from '../src/gestalt-campaign.mjs';
import {configureFirstWar,advanceFirstWar,confirmedUncolonizedSystem} from '../src/first-war.mjs';
function fixture(){
 const state={date:'2200.01.01',snapshotId:'s1',player:{country_id:0},wars:[],resources:{energy:{stockpile:1000,net:10},alloys:{stockpile:1000,net:10}}};
 const c=configureFirstWar(createCampaign({target:2,reason:'取得通道殖民地',reviewDate:'2201.01.01'},state),{fleetId:0,transportId:1,rallySystem:0,targetSystem:9,planets:[0],goalKey:'wg_conquest',finishDate:'2202.01.01',resourceFloors:{energy:50}},state);
 c.baseline.ships=5;
 const env={atTarget:false,occupied:false,owned:false,combat:false,reachable:true,stopped:false,ships:5,invasionUnknown:false,systemId:0,atHome:true,claims:1};const calls=[],tracked=[];
 const rpc=async (method,args)=>{
  if(method==='get_fleet_tactics'&&env.noFleet)return {fleets:[]};
  if(method==='get_fleet_tactics')return {fleets:[{fleet_id:0,total_ships:env.ships,system_id:env.systemId,status:env.fleetStatus}]};
  if(method==='get_fleets')return {fleets:[{fleet_id:0},{fleet_id:1}]};
  if(method==='get_war_fleets')return {success:true,fleets:[{fleet_id:0,ship_class:'shipclass_military'},{fleet_id:1,ship_class:'shipclass_transport',embarked_armies:2}]};
  if(method==='get_attack_options')return {options:[{goal_key:'wg_conquest',legal:true}]};
  if(method==='get_peace_options')return {options:[{outcome:'demand_surrender',legal:true},{outcome:'status_quo',legal:true},{outcome:'surrender',legal:true}]};
  if(method==='get_landing_options')return {success:true,legal:true};
  if(method==='get_market')return {resources:[]};
  if(method==='find_path'){assert.ok(Number.isSafeInteger(args.to_system_id));assert.equal(args.to_system,undefined);return {reachable:env.reachable};}
  if(method==='get_system')return {id:args.system_id,surveyed:true,intel:4,player_claims:env.claims,owner_id:args.system_id===0||env.systemOwned?0:2,planets:env.systemOnly?[{id:100}]:[{id:0,colony_id:0,owner_id:2}],fleets:args.system_id===0?(env.atHome?[{id:0,own:true},{id:1,own:true}]:[]):env.atTarget?[{id:0,own:true,stance:env.stance},...(env.starbaseCaptured||Number.isInteger(env.starbaseOwner)?[{id:50,own:false,owner_id:env.starbaseOwner??0,ship_class:'shipclass_starbase'}]:[])]:[]};
  if(method==='get_invasion_state')return env.invasionUnknown?{success:false,error:'尚无当地情报'}:{success:true,planet_id:args.planet_id,occupied_by_player:env.occupied,owned_by_player:env.owned,ground_combat:env.combat,owner_id:env.owned?0:2,controller_id:env.occupied||env.owned?0:2};
  throw Error(method);
 };
 const send=async order=>{calls.push(order);return {orders:[{status:'posted'}]};};
 const step=()=>advanceFirstWar(c,{state,rpc,send,save:async()=>{},tasks:[],records:tracked,isStopped:()=>env.stopped});
 return {c,state,env,calls,step,tracked};
}
test('complete first war executes muster, declaration, attack, landing, peace and recovery on observed evidence',async()=>{
 const {c,state,env,calls,step}=fixture();await step();assert.equal(c.phase,'muster');await step();assert.equal(c.phase,'declare');await step();assert.equal(calls.at(-1).command,'declare_war');await step();assert.equal(calls.length,1);
 state.wars=[{war_id:0,primary_attacker_id:0,primary_defender_id:2,player_side:'attacker',attacker_goal:{key:'wg_conquest'}}];await step();assert.equal(c.phase,'combat');await step();assert.equal(calls.at(-1).command,'set_fleet_stance');await step();assert.equal(calls.at(-1).command,'move_fleet');
 env.atTarget=true;await step();assert.equal(calls.at(-1).command,'land_armies');env.combat=true;await step();assert.equal(c.phase,'combat');assert.equal(calls.length,4);
 env.occupied=true;env.combat=false;await step();assert.equal(c.phase,'peace');await step();assert.equal(calls.at(-1).command,'offer_peace');await step();assert.equal(calls.length,5);
 state.wars=[];env.owned=true;await step();assert.equal(c.phase,'completed');assert.equal(c.result.success,true);assert.equal(c.result.warEnded,true);
});
test('pause and restart before declaration response cannot replay the write',async()=>{
 const {c,env,calls,step}=fixture();env.stopped=true;await step();assert.equal(calls.length,0);env.stopped=false;await step();await step();c.actions.declare={status:'issued'};await step();assert.equal(calls.length,0);assert.match(c.nextCheck,/不重复发送/);
});

test('known enemy objective can be approached before ground intel; landing still requires fresh intel',async()=>{
 const {c,state,env,calls,step}=fixture();c.phase='combat';c.warId=0;c.participants={attacker:0,defender:2};state.wars=[{war_id:0,primary_attacker_id:0,primary_defender_id:2}];env.invasionUnknown=true;
 await step();await step();assert.equal(calls.at(-1).command,'move_fleet');
 env.atTarget=true;await step();assert.equal(calls.length,2);assert.match(c.nextCheck,/情报/);
});

test('unaccepted withdrawal proposal requires a model decision and never automatically surrenders',async()=>{
 const {c,state,calls,step}=fixture();c.phase='peace';c.exitReason='进攻路线中断';c.warId=0;c.participants={attacker:0,defender:2};state.wars=[{war_id:0,primary_attacker_id:0,primary_defender_id:2}];
 c.actions['peace-status_quo']={status:'posted',issuedDate:'2199.09.01'};
 await step();assert.equal(calls.length,0);assert.equal(c.decisionRequired.kind,'peace_unaccepted');assert.match(c.nextCheck,/不会自动投降/);
 await step();assert.equal(calls.length,0);
});

test('postwar MIA fleet waits without issuing a doomed return order',async()=>{
 const {c,env,calls,step}=fixture();c.phase='recover';env.systemId=0xffffffff;
 await step();assert.equal(calls.length,0);assert.match(c.nextCheck,/失踪/);
 env.systemId=0;await step();assert.equal(c.phase,'terminated');
});
test('preparation timeout terminates; unavailable combat route requires a fresh strategic review',async()=>{
 const a=fixture();a.state.date='2201.01.01';await a.step();assert.equal(a.c.phase,'terminated');assert.equal(a.calls.length,0);
 const b=fixture();b.c.phase='combat';b.c.warId=0;b.c.participants={attacker:0,defender:2};b.state.wars=[{war_id:0,primary_attacker_id:0,primary_defender_id:2}];b.env.reachable=false;await b.step();await b.step();assert.equal(b.c.phase,'combat');assert.equal(b.c.decisionRequired.kind,'route_unavailable');assert.match(b.c.nextCheck,/未知|跃迁/);
});

test('ground combat and actual occupation are checked even after the navy leaves the system',async()=>{
 const {c,state,env,calls,step}=fixture();c.phase='combat';c.warId=0;c.participants={attacker:0,defender:2};state.wars=[{war_id:0,primary_attacker_id:0,primary_defender_id:2}];
 env.combat=true;await step();assert.equal(calls.length,0);assert.match(c.nextCheck,/地面战/);
 env.combat=false;env.occupied=true;await step();assert.equal(c.phase,'peace');assert.equal(calls.length,0);
});

test('postwar return uses capital ID zero before replenishment; isolated fleets use normal MIA once',async()=>{
 const {c,state,env,calls,step}=fixture();c.phase='recover';c.execution.rallySystem=8;c.baseline.ships=5;env.ships=4;env.systemId=9;env.atHome=false;state.player.capital_system_id=0;
 await step();assert.deepEqual(calls[0],{command:'move_fleet',arguments:{fleet_id:0,system_id:0}});
 env.atHome=true;env.systemId=0;await step();assert.equal(calls.at(-1).command,'reinforce_fleet');assert.equal(c.recoverySystem,0);
 const b=fixture();b.c.phase='recover';b.env.atHome=false;b.env.systemId=9;b.env.reachable=false;
 await b.step();assert.deepEqual(b.calls[0],{command:'fleet_mia',arguments:{fleet_ids:[0],type:'return_home'}});
 b.env.systemId=0xffffffff;await b.step();assert.equal(b.calls.length,1);assert.match(b.c.nextCheck,/失踪/);
});

test('conquest claims are submitted once and require actual claims before muster',async()=>{
 const {c,env,calls,step}=fixture();env.claims=0;await step();assert.equal(calls[0].command,'claim_system');assert.equal(c.phase,'prepare');await step();assert.equal(calls.length,1);
 env.claims=1;await step();assert.equal(c.phase,'muster');
});
test('war end is not victory, recovery waits for economy and replacement ships',async()=>{
 const {c,state,env,calls,step}=fixture();c.phase='recover';c.baseline.ships=5;env.ships=3;await step();assert.equal(calls.at(-1).command,'reinforce_fleet');await step();assert.equal(calls.length,1);env.ships=5;state.resources.energy.stockpile=0;await step();assert.equal(c.phase,'recover');state.resources.energy.stockpile=100;await step();assert.equal(c.phase,'terminated');assert.equal(c.result.success,false);
});

test('a confirmed old movement can be approached again after retreat, but unknown or mismatched proof never replays',async()=>{
 for(const proof of ['fleet_at_destination','unknown']){
 const f=fixture();f.c.phase='combat';f.c.warId=0;f.c.participants={attacker:0,defender:2};f.state.wars=[{war_id:0,primary_attacker_id:0,primary_defender_id:2}];
 f.c.actions['attack-stance']={status:'posted'};f.c.actions.attack={status:'posted',trackingId:'old',order:{command:'move_fleet',arguments:{fleet_id:0,system_id:9}}};
 f.tracked.push({id:'old',command:'move_fleet',status:'completed',proof:{kind:proof}});
 await f.step();assert.equal(f.calls.length,proof==='fleet_at_destination'?1:0);
 if(f.calls.length){assert.equal(f.c.actions.attack.attempts,2);await f.step();assert.equal(f.calls.length,1);}
 }
});
test('observed war end and changed prewar ownership prove gains, while an offered outcome remains unverified',async()=>{
 const f=fixture();f.c.phase='recover';f.c.warId=0;f.c.outcome='demand_surrender';f.c.baseline.objectives=[{planetId:0,ownerId:2}];f.env.owned=true;
 await f.step();assert.equal(f.c.result.success,true);assert.deepEqual(f.c.result.gainedPlanets,[0]);assert.equal(f.c.result.outcome,null);assert.equal(f.c.result.requestedOutcome,'demand_surrender');assert.equal(f.c.nextCampaignReview.required,true);
 const unknown=fixture();unknown.c.phase='recover';unknown.c.warId=0;unknown.env.owned=true;await unknown.step();assert.equal(unknown.c.result.success,false);assert.deepEqual(unknown.c.result.gainedPlanets,[]);
});
test('missing recovery fleet does not suppress actual gains and explicitly requests a replacement',async()=>{
 const f=fixture();f.c.phase='recover';f.c.warId=0;f.c.baseline.objectives=[{planetId:0,ownerId:2}];f.env.owned=true;f.env.noFleet=true;await f.step();assert.deepEqual(f.c.result.gainedPlanets,[0]);assert.equal(f.c.phase,'recover');assert.match(f.c.nextCheck,/revise/);assert.equal(f.calls.length,0);
});
test('war budget includes present settlement/consumer resources without a fixed 500 floor',async()=>{
 const f=fixture();f.state.resources.trade={stockpile:100,net:10};f.state.resources.consumer_goods={stockpile:100,net:1};
 configureFirstWar(f.c,{...f.c.execution,resourceFloors:{trade:20},finishDate:'2202.01.01'},f.state);assert.equal(f.c.execution.resourceFloors.trade,20);assert.equal(f.c.execution.resourceFloors.consumer_goods,0);
 f.state.resources.trade.net_known=false;await f.step();assert.equal(f.calls.length,0);assert.match(f.c.nextCheck,/trade/);
});

test('system-only conquest requires complete uncolonized intel and never treats arrival as occupation',async()=>{
 const f=fixture();configureFirstWar(f.c,{...f.c.execution,planets:[],transportId:undefined},f.state);f.env.systemOnly=true;
 await f.step();assert.equal(f.c.phase,'muster');await f.step();assert.equal(f.c.phase,'declare');await f.step();
 f.state.wars=[{war_id:0,primary_attacker_id:0,primary_defender_id:2,player_side:'attacker',attacker_goal:{key:'wg_conquest'}}];await f.step();await f.step();await f.step();
 f.env.atTarget=true;f.env.fleetStatus='正在战斗';await f.step();assert.equal(f.c.phase,'combat');assert.match(f.c.nextCheck,/抵达不等于占领/);assert.equal(f.calls.some(x=>x.command==='land_armies'),false);
 f.env.starbaseCaptured=true;await f.step();assert.equal(f.c.phase,'peace');assert.ok(Object.values(f.c.observedEvidence).some(x=>x.kind==='fleet_combat'));await f.step();
 f.state.wars=[];f.env.systemOwned=true;await f.step();assert.equal(f.c.phase,'completed');assert.deepEqual(f.c.result.gainedSystems,[9]);assert.deepEqual(f.c.result.gainedPlanets,[]);assert.equal(f.c.result.success,true);
});
test('empty ground objectives reject hidden or colonized targets, and unrelated ownership is not a gain',async()=>{
 const base={owner_id:2,surveyed:true,intel:4,planets:[{id:0}]};assert.equal(confirmedUncolonizedSystem(base,2),true);
 for(const patch of [{surveyed:false},{intel:1},{planets:[]},{planets:[{id:0,colony_id:0}]},{planets:[{id:0,owner_id:2}]},{owner_id:0}])assert.equal(confirmedUncolonizedSystem({...base,...patch},2),false);
 const f=fixture();f.c.execution.planets=[];await f.step();assert.equal(f.c.status,'blocked');assert.equal(f.calls.length,0);
 f.c.phase='recover';f.c.warId=0;f.c.baseline.systems=[{systemId:9,ownerId:0}];f.env.systemOwned=true;await f.step();assert.equal(f.c.result.success,false);
});

test('exit deadlines request a model review without treating a healthy fleet as defeated',async()=>{
 const f=fixture();f.c.phase='combat';f.c.warId=0;f.c.participants={attacker:0,defender:2};f.state.wars=[{war_id:0,primary_attacker_id:0,primary_defender_id:2}];f.state.date='2202.01.01';
 await f.step();assert.equal(f.c.phase,'combat');assert.equal(f.c.status,'review_required');assert.equal(f.c.decisionRequired.kind,'exit_deadline');assert.equal(f.calls.length,0);
});
test('captured starbase ownership overrides own=false and observed stance prevents duplicate writes',async()=>{
 const f=fixture();f.c.phase='combat';f.c.warId=0;f.c.participants={attacker:0,defender:2};f.c.execution.planets=[];f.state.wars=[{war_id:0,primary_attacker_id:0,primary_defender_id:2}];f.env.systemOnly=true;f.env.atTarget=true;f.env.starbaseCaptured=true;
 await f.step();assert.equal(f.c.phase,'peace');assert.equal(f.calls.length,0);assert.ok(Object.values(f.c.observedEvidence).some(x=>x.kind==='system_occupation'));
});

test('already aggressive navy is adopted from current system evidence without replaying a manual stance order',async()=>{
 const f=fixture();f.c.phase='combat';f.c.warId=0;f.c.participants={attacker:0,defender:2};f.c.execution.planets=[];f.state.wars=[{war_id:0,primary_attacker_id:0,primary_defender_id:2}];f.env.systemOnly=true;f.env.atTarget=true;f.env.stance='aggressive';
 await f.step();assert.equal(f.calls.length,0);assert.equal(f.c.actions['attack-stance'].status,'observed');assert.equal(f.c.phase,'combat');
});


test('a counterattack or unknown starbase control never reuses a stale occupation as peace gains',async()=>{
 for(const owner of [2,undefined]){
 const f=fixture();f.c.phase='peace';f.c.warId=0;f.c.execution.planets=[];f.state.wars=[{war_id:0}];f.env.atTarget=true;f.env.starbaseOwner=owner;f.c.observedEvidence={old:{kind:'system_occupation',entity:9}};
 await f.step();assert.equal(f.calls.length,0);
 if(owner===2){assert.equal(f.c.decisionRequired.kind,'occupation_lost');assert.equal(f.c.status,'review_required');}else assert.match(f.c.nextCheck,/当前控制权未知/);
 }
});
