import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveStrategyDirection} from '../src/strategy-direction.mjs';
import {strategicReview,createGrowthTracker} from '../src/strategic-review.mjs';
import {expansionHealth} from '../src/expansion-health.mjs';

const model={economyFocus:'unity_traditions',expansionStance:'aggressive',militaryStance:'peaceful',oneOffActions:[],reason:'持续提高凝聚力，选择有价值的扩张'};
const state=()=>({date:'2200.01.01',player:{country_id:0,capital_system_id:1,owned_systems:1},wars:[],pendingEvents:[],
 resources:Object.fromEntries(['energy','minerals','alloys','food','consumer_goods','unity','physics_research','society_research','engineering_research'].map(key=>[key,{stockpile:1000,net:10}])),
 capacities:{colonies:1,empire_size:60},colonies:[{colonies_summary:[{planet_id:3,is_colonizing:false}]}]});
const audited=(extra={})=>({planetId:3,name:'首都',ageDays:0,popGroups:10,housing:100,amenities:10,unemployed:0,...extra});
const resolve=(s)=>resolveStrategyDirection({state:s,contract:model}).contract;

test('confirmed consolidation guides the summary and defers fresh conquest, while war keeps its priority',()=>{
 const s=state();s.strategyContract={...model,expansionStance:'consolidate',steeringConfirmed:true};
 let review=strategicReview(s);
 assert.equal(review.mode,'consolidate');assert.equal(review.ordinaryExpansionAllowed,false);
 assert.equal(review.conquest.nextCall,null);assert.equal(review.conquest.stage,'deferred_by_strategy');
 assert.doesNotMatch(review.priorities.join('；'),/主动评估.*征服/);
 s.wars=[{war_id:1,player_side:'attacker'}];review=strategicReview(s);
 assert.equal(review.mode,'campaign');assert.match(review.priorities[0],/占领|进攻/);assert.notEqual(review.conquest.stage,'deferred_by_strategy');
 s.wars=[{war_id:1,player_side:'defender'}];assert.equal(strategicReview(s).mode,'defense');
 s.wars=[];s.strategyContract.steeringConfirmed=false;assert.equal(strategicReview(s).ordinaryExpansionAllowed,true);
});

test('observed colony capacity deficits temporarily consolidate without replacing the economic goal or model intent',()=>{
 const s=state();s.operatorStanding={economyFocus:'unity_traditions'};
 s.colonyAudit={colonies:[audited({housing:-100})]};
 s.strategy=strategicReview(s);assert.equal(resolve(s).expansionStance,'consolidate');assert.equal(resolve(s).economyFocus,'unity_traditions');
 assert.match(resolve(s).reason,/住房不足/);assert.equal(model.expansionStance,'aggressive');
 for(const issue of [{amenities:-1},{unemployed:100}]){
  s.colonyAudit.colonies=[audited(issue)];s.strategy=strategicReview(s);assert.equal(resolve(s).expansionStance,'consolidate');
 }
 s.colonyAudit.colonies=[audited()];s.strategy=strategicReview(s);assert.equal(resolve(s).expansionStance,'aggressive');
});

test('initial low unity, missing KPIs, empty planets, old audits and empire size alone never freeze expansion',()=>{
 const s=state();s.resources.unity.net=1;s.capacities.empire_size=10000;
 for(const row of [audited({housing:null,amenities:null,unemployed:null}),audited({popGroups:0,housing:-100}),audited({ageDays:361,housing:-100})]){
  s.colonyAudit={colonies:[row]};s.strategy=strategicReview(s);assert.equal(resolve(s).expansionStance,'aggressive');
 }
 s.strategy={expansionHealth:{date:'2199.01.01',consolidate:true,reasons:['旧读数']}};assert.equal(resolve(s).expansionStance,'aggressive');
});

test('growth lag only consolidates with a real expansion burden and restores the model direction after recovery',()=>{
 const s=state();
 const unity={known:true,focused:true,net:10,reasons:[],scalingBehind:true,baseline:{observedYears:3}};
 let growth={known:false,unity,expansion:{known:true,observedYears:3,coloniesAdded:0,systemsAdded:0}};
 s.strategy=strategicReview(s,{growth});assert.equal(resolve(s).expansionStance,'aggressive');
 growth.expansion.coloniesAdded=1;s.strategy=strategicReview(s,{growth});assert.equal(resolve(s).expansionStance,'consolidate');
 growth.unity={...unity,scalingBehind:false};s.strategy=strategicReview(s,{growth});assert.equal(resolve(s).expansionStance,'aggressive');
 growth={known:false,unity};s.colonies[0].colonies_summary.push({planet_id:4,is_colonizing:true});
 assert.equal(expansionHealth(s,{growth}).consolidate,true);
 growth.unity={...unity,baseline:null};assert.equal(expansionHealth(s,{growth}).consolidate,false);
});

test('same-world growth samples distinguish real additions from a large established empire and reset on reload',()=>{
 const tracker=createGrowthTracker(),s=state();tracker.record(s);
 s.date='2203.01.01';s.capacities.colonies=2;s.player.owned_systems=4;tracker.record(s);
 assert.deepEqual(tracker.review(s).expansion,{known:true,observedYears:3,coloniesAdded:1,systemsAdded:3});
 s.date='2201.01.01';tracker.record(s);assert.equal(tracker.review(s).expansion.known,false);
 s.date='2205.01.01';s.player.country_id=1;tracker.record(s);assert.equal(tracker.review(s).expansion.known,false);
});

test('direct owner consolidation outranks model expansion, but cautious language and negated stops do not invent a freeze',()=>{
 const s=state();s.operatorStanding={text:'先巩固现有殖民地，提高凝聚力',economyFocus:'unity_traditions'};
 assert.equal(resolve(s).expansionStance,'consolidate');assert.equal(strategicReview(s).ordinaryExpansionAllowed,false);
 s.operatorStanding.text='控制规模，不要无脑扩张';assert.equal(resolve(s).expansionStance,'aggressive');
 s.operatorStanding.text='不要停止扩张';assert.equal(resolve(s).expansionStance,'aggressive');
 delete s.operatorStanding;s.operationalGoal={text:'先巩固现有殖民地'};assert.equal(resolve(s).expansionStance,'aggressive');
});
