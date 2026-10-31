import test from 'node:test';
import assert from 'node:assert/strict';
import {validateStrategyContract,applySteering,reservedOrder,reservedRPC,steeringRPC} from '../src/strategy-contract.mjs';
import {validateOrder} from '../src/native-game.mjs';
import {NativeStrategyReview} from '../src/native-strategy-review.mjs';
const contract={economyFocus:'research',expansionStance:'consolidate',militaryStance:'peaceful',oneOffActions:[],reason:'优先科研并消化现有疆域'};
test('StrategyContract accepts only three dimensions and reserved decisions, not routine micro',()=>{
 assert.deepEqual(validateStrategyContract(contract,validateOrder),contract);
 const valid={...contract,oneOffActions:[{type:'declare_war',arguments:{country_id:0,goal_key:'wg_conquest'}}]};
 assert.equal(validateStrategyContract(valid,validateOrder).oneOffActions[0].arguments.country_id,0);
 for(const invalid of [{...contract,economyFocus:'cheat'},{...contract,extra:1},{...contract,oneOffActions:[{type:'build_ship',arguments:{}}]},
  {...contract,oneOffActions:[{type:'declare_war',arguments:{country_id:-1,goal_key:'wg_conquest'}}]}])assert.throws(()=>validateStrategyContract(invalid,validateOrder));
 assert.ok(reservedOrder('offer_peace'));assert.ok(reservedRPC('diplomacy_action'));
 assert.equal(reservedOrder('build_ship'),false);assert.equal(steeringRPC('toggle_edict',{edict_key:'subsidize_research',enabled:true}),false);
});
test('steering switches only own prefixed edicts, removes old dimension, reads confirmation without turning AI off',async()=>{
 const active=new Set(['cfsteer_economy_balanced','unrelated']),writes=[];
 const rpc=async(m,p)=>{if(m==='get_edicts')return {active_edicts:[...active].map(key=>({key}))};writes.push({m,p});p.enabled?active.add(p.edict_key):active.delete(p.edict_key);return {success:true};};
 assert.equal((await applySteering({contract,rpc,wait:async()=>{}})).confirmed,true);
 assert.equal(active.has('unrelated'),true);assert.equal(active.has('cfsteer_economy_balanced'),false);
 assert.ok(active.has('cfsteer_economy_research'));assert.ok(writes.every(w=>w.m==='toggle_edict'));
 writes.length=0;await applySteering({contract,rpc});assert.equal(writes.length,0);
});
test('unconfirmed steering does not replay a posted toggle or execute unrelated actions',async()=>{
 const writes=[];await assert.rejects(applySteering({contract,attempts:2,wait:async()=>{},rpc:async(m,p)=>{
  if(m==='get_edicts')return {active_edicts:[]};writes.push(p);return {success:true};
 }}),/尚未确认/);assert.equal(writes.length,1);
});
test('strategy review is six game months or changed strategic events, not idle time or routine queues',()=>{
 const review=new NativeStrategyReview(),state={date:'2200.01.01',wars:[],pendingEvents:[],resources:{energy:{stockpile:1000,net:10}}};
 assert.deepEqual(review.due(state),['initial_strategy']);review.acknowledge(state);
 assert.deepEqual(review.due({...state,date:'2200.06.30',construction_queue:[1]}),[]);
 assert.ok(review.due({...state,date:'2200.07.01'}).includes('six_month_review'));
 assert.ok(review.due({...state,wars:[{war_id:0}]}).includes('strategic_event'));
 assert.ok(review.due({...state,resources:{energy:{stockpile:5,net:-5}}}).includes('strategic_event'));
});
