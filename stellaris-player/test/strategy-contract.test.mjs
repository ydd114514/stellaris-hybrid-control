import test from 'node:test';
import assert from 'node:assert/strict';
import {validateStrategyContract,applySteering,reservedOrder,reservedRPC,steeringRPC} from '../src/strategy-contract.mjs';
import {validateOrder} from '../src/native-game.mjs';
import {NativeStrategyReview} from '../src/native-strategy-review.mjs';
const context={currentDate:'2200.01.01',empireType:'regular'};
const contract={goals:[{metric:'pops',target:120,byDate:'2220.01.01'}],economyFocus:'research',expansionStance:'consolidate',militaryStance:'peaceful',oneOffActions:[],reason:'优先科研并消化现有疆域'};
test('StrategyContract accepts only three dimensions and reserved decisions, not routine micro',()=>{
 assert.deepEqual(validateStrategyContract(contract,validateOrder,context),contract);
 const valid={...contract,oneOffActions:[{type:'declare_war',arguments:{country_id:0,goal_key:'wg_conquest'}}]};
 assert.equal(validateStrategyContract(valid,validateOrder,context).oneOffActions[0].arguments.country_id,0);
 for(const invalid of [{...contract,economyFocus:'cheat'},{...contract,extra:1},{...contract,oneOffActions:[{type:'build_ship',arguments:{}}]},
  {...contract,oneOffActions:[{type:'declare_war',arguments:{country_id:-1,goal_key:'wg_conquest'}}]}])assert.throws(()=>validateStrategyContract(invalid,validateOrder,context));
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
 let now=0;
 const review=new NativeStrategyReview({now:()=>now}),state={date:'2200.01.01',wars:[],pendingEvents:[],resources:{energy:{stockpile:1000,net:10}}};
 assert.deepEqual(review.due(state),['initial_strategy']);review.acknowledge(state);
 assert.deepEqual(review.due({...state,date:'2200.06.30',construction_queue:[1]}),[]);
 now=180000;
 assert.ok(review.due({...state,date:'2200.07.01'}).includes('six_month_review'));
 assert.ok(review.due({...state,wars:[{war_id:0}]}).includes('strategic_event'));
 assert.ok(review.due({...state,resources:{energy:{stockpile:5,net:-5}}}).includes('strategic_event'));
});

test('quantified native strategy goals and directions are bounded and match the empire',()=>{
 const {goals,...withoutGoals}=contract;
 for(const invalid of [withoutGoals,{...contract,goals:[]},{...contract,goals:Array(4).fill(goals[0])}]){
  assert.throws(()=>validateStrategyContract(invalid,validateOrder,context),/1～3个可量化目标/);
 }
 for(const byDate of ['2220.13.01','2210.02.31','2210-02-01']){
  assert.throws(()=>validateStrategyContract({...contract,goals:[{...goals[0],byDate}]},validateOrder,context),/有效指标/);
 }
 assert.throws(()=>validateStrategyContract({...contract,goals:[{...goals[0],byDate:'2220.01.02'}]},validateOrder,context),/20年/);
 assert.throws(()=>validateStrategyContract({...contract,warTarget:{countryId:0}},validateOrder,context),/只有备战/);
 assert.throws(()=>validateStrategyContract({...contract,expansionDirection:{towardCountryId:-1}},validateOrder,context),/帝国ID/);
 for(const empireType of ['hive','machine']){
  assert.throws(()=>validateStrategyContract({...contract,economyFocus:'consumer_stability'},validateOrder,{...context,empireType}),/凝聚力优先.*本帝国不用消费品/);
 }
 const planned={...contract,expansionDirection:{towardCountryId:0},militaryStance:'prepare_war',warTarget:{countryId:1}};
 assert.deepEqual(validateStrategyContract(planned,validateOrder,context),planned);
 assert.deepEqual(validateStrategyContract(withoutGoals,validateOrder,{requireGoals:false}),withoutGoals);
});

test('only two acknowledged reviews with all metrics known and no goal near completion signal stagnation',()=>{
 let now=0;
 const review=new NativeStrategyReview({now:()=>now});
 const state={date:'2200.01.01',population:60,strategyContract:contract,military:{fleets:[{military_power:100}]},resources:{
  physics_research:{net:30},society_research:{net:30},engineering_research:{net:30}
 }};
 review.acknowledge(state);
 now+=180000;
 const first={...state,date:'2200.07.01'};
 assert.deepEqual(review.due(first),['six_month_review']);
 assert.deepEqual(review.due(first),['six_month_review']);
 review.acknowledge(first);
 now+=180000;
 const second={...state,date:'2201.01.01'};
 assert.deepEqual(review.due(second),['six_month_review','stagnation']);
 for(const improved of [{population:61},{population:96},{military:{}},{military:{fleets:[{military_power:101}]}},
  {resources:{...state.resources,physics_research:{net:31}}}]){
  assert.deepEqual(review.due({...second,...improved}),['six_month_review']);
 }
 review.acknowledge(second,{changed:true});now+=180000;
 assert.deepEqual(review.due({...state,date:'2201.07.01'}),['six_month_review']);
});
