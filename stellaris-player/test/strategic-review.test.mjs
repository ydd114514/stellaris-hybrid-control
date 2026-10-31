import test from 'node:test';
import assert from 'node:assert/strict';
import {empireRoute,strategicReview,expansionCandidates,colonyReview,createGrowthTracker} from '../src/strategic-review.mjs';
const base=()=>({resources:{energy:{stockpile:1000,net:10},minerals:{stockpile:500,net:30},alloys:{stockpile:1000,net:20},food:{stockpile:2000,net:10},consumer_goods:{stockpile:1000,net:10}},capacities:{colonies:3,empire_size:600},wars:[],pendingEvents:[]});
test('live long-reserve deficit with capped stores is maintenance, while true shortage and war keep priority',()=>{
 const s=base();s.resources.consumer_goods={stockpile:20389.07,net:-41.36};s.resources.food={stockpile:25000,max:25000,net:75.18};s.resources.alloys={stockpile:24584.75,max:25000,net:27.44};
 const review=strategicReview(s);assert.equal(review.mode,'develop_capacity');assert.equal(review.marketPolicy.mode,'bounded_maintenance');assert.equal(review.ordinaryExpansionAllowed,true);
 assert.ok(review.marketPolicy.reviewAcrossTurns.includes('research'));assert.ok(review.marketPolicy.reviewAcrossTurns.includes('expansion'));
 s.resources.consumer_goods.stockpile=10;assert.equal(strategicReview(s).marketPolicy.mode,'rescue_shortage');
 s.wars=[{war_id:0}];assert.equal(strategicReview(s).marketPolicy.mode,'support_defense');
 assert.equal(strategicReview({}).marketPolicy.mode,'verify_first');
});
test('routes distinguish regular, hive and machine; an unknown authority stays unknown',()=>{
  assert.equal(empireRoute({authority:'auth_democratic'}),'regular');assert.equal(empireRoute({authority:'auth_hive_mind'}),'hive');assert.equal(empireRoute({authority:'auth_machine_intelligence'}),'machine');assert.equal(empireRoute({authority:'auth_modded_unknown'}),'unknown');
});
test('hive and machine summaries do not inherit regular-empire consumer-goods obligations',()=>{
  const s=base();s.resources.consumer_goods={stockpile:0,net:-2};
  assert.equal(strategicReview(s,{government:{authority:'auth_democratic'}}).mode,'stabilize');
  for(const authority of ['auth_hive_mind','auth_machine_intelligence'])assert.equal(strategicReview(s,{government:{authority}}).ordinaryExpansionAllowed,true);
});
test('historical double deficit prioritizes consolidation while healthy growth has no fixed empire-size cap',()=>{
  const s=base();s.resources.consumer_goods={stockpile:3303.28,net:-104.76};s.resources.food={stockpile:2344.35,net:-74.64};
  const review=strategicReview(s,{government:{authority:'auth_democratic'}});assert.equal(review.mode,'consolidate');assert.equal(review.ordinaryExpansionAllowed,false);assert.match(review.priorities.join('；'),/岗位填充/);assert.ok(review.deficits[0].months>31&&review.deficits[0].months<32);
  assert.equal(strategicReview(base()).ordinaryExpansionAllowed,true);
});
test('small sustainable deficits do not permanently forbid growth and recovery resumes it',()=>{
  const s=base();s.resources.food={stockpile:2000,net:-1};assert.equal(strategicReview(s).mode,'selective_growth');
  s.resources.food={stockpile:1,net:-1};assert.equal(strategicReview(s).mode,'stabilize');s.resources.food.net=1;assert.equal(strategicReview(s).ordinaryExpansionAllowed,true);
});
test('war, distressed populated colonies and missing data have explicit priorities; empty planet zero KPI is not a rebellion',()=>{
  const s=base();s.wars=[{war_id:0}];assert.equal(strategicReview(s).mode,'defense');s.wars=[];
  const bad=colonyReview({planet_id:0,name:'地球',kpi:{pop_groups:300,stability_percent:37,amenities:-100,housing:200}});
  assert.equal(strategicReview(s,{colonies:[bad]}).mode,'consolidate');
  const empty=colonyReview({planet_id:1,kpi:{pop_groups:0,stability_percent:0,amenities:0}});assert.equal(strategicReview(s,{colonies:[empty]}).mode,'selective_growth');assert.equal(strategicReview({}).mode,'reconnaissance');
});
test('colony candidates use current color boundaries and rank all candidates before trimming',()=>{
  const review=strategicReview(base());const planets=Array.from({length:9},(_,i)=>({planet_id:i,can_colonize:false,system_owned:true,habitability_percent:100}));
  planets.push({planet_id:10,can_colonize:true,system_owned:true,habitability_percent:70},{planet_id:11,can_colonize:true,system_owned:true,habitability_percent:39.9},{planet_id:12,can_colonize:true,system_owned:true,habitability_percent:40});
  assert.deepEqual(expansionCandidates({purpose:'colonizable',planets},review).planets.map(x=>x.planet_id),[10,12]);
  assert.equal(expansionCandidates({purpose:'colonizable',planets},{...review,ordinaryExpansionAllowed:false}).planets.length,0);
});
test('routine outpost candidates must be legal, surveyed and contiguous; surveying and resource work remain available',()=>{
  const good={id:0,can_build:true,surveyed:true,borders_own_space:true};
  assert.deepEqual(expansionCandidates({purpose:'outpost',systems:[{...good,id:1,borders_own_space:false},{...good,id:2,can_build:false},good]},strategicReview(base())).systems,[good]);
  const bad=strategicReview({...base(),wars:[{war_id:1}]});assert.deepEqual(expansionCandidates({purpose:'deposit',systems:[{id:0}]},bad).systems,[{id:0}]);
});
test('ample reserves with small deficits and capped surpluses prioritize productive growth, not emergency repair',()=>{
  const s=base();s.resources.energy={stockpile:35000,max:35000,net:294};s.resources.minerals={stockpile:23931,max:25000,net:178};
  s.resources.consumer_goods={stockpile:12214,net:-24};s.resources.food={stockpile:21556,net:-2};
  const review=strategicReview(s,{government:{authority:'auth_democratic'}});
  assert.equal(review.mode,'develop_capacity');assert.equal(review.ordinaryExpansionAllowed,true);
  assert.deepEqual(review.growth.cappedSurpluses,['energy','minerals']);
  assert.match(review.priorities.join('；'),/产能|岗位容量/);assert.match(review.priorities.join('；'),/监测/);
});
test('growth opportunities never override a near-term shortage or defense and unknown reserves do not imply a surplus',()=>{
  const s=base();for(const k of ['energy','minerals'])s.resources[k]={stockpile:1000,max:1000,net:100};
  s.resources.food={stockpile:1,net:-2};
  assert.equal(strategicReview(s,{growth:{known:true,stagnating:true}}).mode,'stabilize');
  s.wars=[{war_id:1}];assert.equal(strategicReview(s,{growth:{known:true,stagnating:true}}).mode,'defense');
  const unknown={...base(),resources:{energy:{net:10,capped:true},minerals:{stockpile:500,net:20},alloys:{stockpile:500,net:10}}};
  assert.equal(strategicReview(unknown).mode,'reconnaissance');assert.deepEqual(strategicReview(unknown).growth.cappedSurpluses,[]);
});
test('capital upgrade alerts surface the actual capability gap without interpreting every upgrade alert as a capital',()=>{
  const colony=colonyReview({planet_id:3,name:'地球',kpi:{pop_groups:100},status_alerts:[{id:'upgrade_available',desc:'首府建筑可以升级了'}]});
  const review=strategicReview(base(),{colonies:[colony]});assert.equal(colony.capitalUpgradeAvailable,true);
  assert.match(review.priorities.join('；'),/未提供首府\/建筑升级/);assert.ok(review.capabilityGaps.includes('首府/建筑升级'));
  assert.equal(colonyReview({planet_id:4,kpi:{pop_groups:100},status_alerts:[{id:'upgrade_available',desc:'其他建筑升级'}]}).capitalUpgradeAvailable,false);
  const enabled=strategicReview({...base(),capabilities:{availableActions:['upgrade_building']}},{colonies:[colony]});
  assert.match(enabled.priorities.join('；'),/inspect upgrades/);assert.equal(enabled.capabilityGaps.includes('首府/建筑升级'),false);
});
const scientificState=(year,value,day='01.01')=>({...base(),date:`${year}.${day}`,player:{country_id:0,capital_system_id:1},resources:{...base().resources,physics_research:{net:value},society_research:{net:value},engineering_research:{net:value}}});
test('bounded year buckets preserve long-run stagnation despite a busy observation loop',()=>{
  const tracker=createGrowthTracker();tracker.record(scientificState(2200,100));
  for(let year=2201;year<=2210;year++)for(let day=1;day<=28;day++)tracker.record(scientificState(year,105,`01.${String(day).padStart(2,'0')}`));
  const state=scientificState(2210,105,'01.28'),trend=tracker.review(state);
  assert.equal(trend.known,true);assert.equal(trend.stagnating,true);assert.equal(trend.scienceGrowthPercent,5);
  assert.equal(strategicReview(state,{growth:trend}).mode,'develop_capacity');
  const growthState=scientificState(2211,150);tracker.record(growthState);assert.equal(tracker.review(growthState).stagnating,false);
});
test('growth tracking resets across backdated saves or player changes and missing science stays unknown',()=>{
  const tracker=createGrowthTracker();tracker.record(scientificState(2200,100));tracker.record(scientificState(2210,100));
  assert.equal(tracker.review(scientificState(2210,100)).known,true);
  tracker.record(scientificState(2205,100));assert.equal(tracker.review(scientificState(2205,100)).known,false);
  tracker.record({...scientificState(2215,100),player:{country_id:1,capital_system_id:2}});
  assert.equal(tracker.review(scientificState(2215,100)).known,false);
  const incomplete=scientificState(2225,100);delete incomplete.resources.physics_research;
  assert.equal(tracker.review(incomplete).known,false);
});
test('empty colony candidates identify change conditions and do not invent global impossibility',()=>{
  const result=expansionCandidates({purpose:'colonizable',planets:[]},strategicReview(base()));
  assert.match(result.nextReview,/不等于整张地图没有目标/);assert.match(result.nextReview,/变化后再查/);
  const valid={planet_id:1,can_colonize:true,system_owned:true,habitability_percent:80};
  const reopened=expansionCandidates({purpose:'colonizable',planets:[valid]},strategicReview(base()));
  assert.deepEqual(reopened.planets,[valid]);assert.equal(reopened.nextReview,undefined);
});

test('offensive war remains a campaign objective and peaceful preparation does not require full equilibrium',()=>{
 const s=base();s.wars=[{war_id:0,player_side:'attacker'}];const active=strategicReview(s);assert.equal(active.mode,'campaign');assert.equal(active.marketPolicy.mode,'support_campaign');assert.match(active.priorities[0],/占领|进攻/);
 const peace=base();peace.resources.consumer_goods={stockpile:1000,net:-40};const r=strategicReview(peace,{government:{authority:'auth_democratic'}});assert.equal(r.mode,'consolidate');assert.equal(r.conquest.stage,'seek_target');assert.deepEqual(r.conquest.economicGaps,[]);assert.equal(r.conquest.automaticDeclaration,false);
 peace.gestalt={campaign:{phase:'completed',result:{success:true,warEnded:true,objectives:[{planetId:0,ownerId:0}]}}};assert.equal(strategicReview(peace).conquest.stage,'evaluate_next_target');
});

test('routine consolidation keeps a concrete conquest decision while genuine emergencies keep their priority',()=>{
 const s=base();s.resources.minerals={stockpile:300,net:-10};const r=strategicReview(s);assert.equal(r.mode,'consolidate');assert.match(r.priorities[0],/campaign select/);assert.equal(r.conquest.nextCall.input.topic,'targets');
 s.resources.energy={stockpile:10,net:-100};assert.doesNotMatch(strategicReview(s).priorities[0],/campaign select/);
});
