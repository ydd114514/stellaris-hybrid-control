import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeGame} from '../src/native-game.mjs';
import {createGrowthTracker} from '../src/strategic-review.mjs';

const state=(date,science=100)=>({date,player:{country_id:0,capital_system_id:0},resources:{
 energy:{stockpile:2000,net:20},minerals:{stockpile:1000,net:20},alloys:{stockpile:1000,net:20},
 unity:{stockpile:500,net:60},physics_research:{net:science},society_research:{net:science},engineering_research:{net:science}},
 colonies:[{colonies_summary:[{planet_id:0,name:'首都',status_alerts_count:0},{planet_id:5,name:'新殖民地',status_alerts_count:2}]}],wars:[],capabilities:{availableActions:['upgrade_building']}});
const context=(growthTracker,extra={})=>({nativeCountryAIEnabled:true,strategyContract:{economyFocus:'research',expansionStance:'consolidate',militaryStance:'peaceful'},
 government:{authority:'auth_hive_mind'},colonyReviews:new Map(),now:()=>200000,growthTracker,...extra});

test('native strategy exposes the actual recorded long-run growth diagnosis without losing native ownership boundary',()=>{
 const tracker=createGrowthTracker(),start=state('2200.01.01');tracker.record(start);
 const latest=state('2211.01.01',105);tracker.record(latest);
 const game=context(tracker),review=NativeGame.prototype.reviewStrategy.call(game,latest);
 assert.equal(review.mode,'native_strategy');assert.equal(review.diagnosisMode,'develop_capacity');
 assert.equal(review.growth.known,true);assert.equal(review.growth.scienceGrowthPercent,5);assert.equal(review.growth.stagnating,true);
 assert.deepEqual(review.currentContract,game.strategyContract);assert.equal(review.reviewEveryGameDays,180);
 assert.match(review.note,/不开放普通经营派单/);assert.ok(review.reviewTargets.some(p=>p.planetId===5));
});

test('native strategy includes current deficits and fresh owned-colony distress, while excluding stale or foreign reviews',()=>{
 const tracker=createGrowthTracker(),latest=state('2230.01.01');latest.resources.energy={stockpile:30,net:-10};tracker.record(latest);
 const colonyReviews=new Map([[0,{planetId:0,name:'首都',inhabited:true,stability:35,at:199000}],
 [5,{planetId:5,name:'旧快照',inhabited:true,stability:10,at:0}],[8,{planetId:8,name:'非本国目标',inhabited:true,stability:10,at:199000}]]);
 const review=NativeGame.prototype.reviewStrategy.call(context(tracker,{colonyReviews}),latest);
 assert.equal(review.diagnosisMode,'stabilize');assert.equal(review.deficits[0].resource,'energy');assert.equal(review.deficits[0].months,3);
 assert.match(review.priorities.join('；'),/首都/);assert.doesNotMatch(review.priorities.join('；'),/旧快照|非本国目标/);
 assert.deepEqual(review.reviewTargets.map(x=>x.planetId),[5]);
});

test('fresh native session reports unknown long-run history honestly and ordinary mode keeps its existing diagnosis shape',()=>{
 const latest=state('2200.01.01'),tracker=createGrowthTracker();tracker.record(latest);
 const review=NativeGame.prototype.reviewStrategy.call(context(tracker),latest);
 assert.equal(review.growth.known,false);assert.match(review.growth.reason,/尚无同局/);
 const ordinary=NativeGame.prototype.reviewStrategy.call(context(tracker,{nativeCountryAIEnabled:false}),latest);
 assert.equal(ordinary.mode,'selective_growth');assert.equal(ordinary.diagnosisMode,undefined);assert.equal(ordinary.currentContract,undefined);
});
