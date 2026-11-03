import test from 'node:test';
import assert from 'node:assert/strict';
import {ModelView} from '../src/model-view.mjs';
import {NativeStrategyReview} from '../src/native-strategy-review.mjs';
import {readStrategyNeighbors,strategyBrief,STRATEGY_BRIEF_MAX_BYTES} from '../src/strategy-brief.mjs';

test('strategy brief compares known metrics with the acknowledged review, preserves unknowns, and explains hive steering',()=>{
  let now=0;
  const review=new NativeStrategyReview({now:()=>now});
  review.acknowledge({date:'2200.01.01',population:50,resources:{alloys:{net:-10,stockpile:100}}});
  const state={date:'2200.07.01',population:58,colonyCount:2,player:{owned_systems:4},
    capacities:{naval_capacity:{used:60,capacity:50}},military:{fleets:[{military_power:100},{military_power:150}]},
    resources:{alloys:{net:-5,stockpile:100},energy:{net:0,net_known:false,stockpile:50},minerals:{net:2,stockpile:1},unity:{net:1,stockpile_known:false,stockpile:0},
      physics_research:{net:10},society_research:{net:11},engineering_research:{net:12}},
    strategyContract:{goals:[{metric:'pops',target:65,byDate:'2201.01.01'}]}};
  now=180000;
  assert.deepEqual(review.due(state),['six_month_review']);
  const government={authority:'auth_hive_mind',ethics:[{name:'格式塔意识'}],civics:[{name:'集体意志'}]};
  const brief=strategyBrief(state,{government,previousMetrics:review.lastMetrics});
  assert.deepEqual(brief.empire,{type:'蜂巢',ethics:['格式塔意识'],civics:['集体意志'],phase:'消化疆域，修复内政'});
  assert.deepEqual(brief.metrics.pops,{current:58,change:8});
  assert.deepEqual(brief.metrics.alloys_reserve_months,{current:20,change:10});
  for(const [metric,value] of Object.entries({colonies:2,systems:4,research_monthly:33,fleet_power:250,naval_used:60,
    naval_capacity:50,naval_used_ratio:1.2,alloys_monthly:-5,energy_monthly:'未知',energy_reserve_months:'未知',
    minerals_monthly:2,minerals_reserve_months:'无净消耗',unity_monthly:1,unity_reserve_months:'未知'})){
    assert.equal(brief.metrics[metric].current,value,metric);
  }
  assert.equal(brief.previousGoals[0].status,'near');
  assert.equal(brief.neighbors,'未知');
  assert.match(brief.steeringEffects.economyFocus.consumer_stability,/凝聚力优先（本帝国不用消费品）/);
});

test('strategy brief bounds the visible contact comparison and never treats uncovered borders, wars or power as known',async()=>{
  const empires=Array.from({length:32},(_,i)=>({country_id:i,name:'长名字'.repeat(30),has_communications:i!==31}));
  const state={player:{country_id:2,capital_system_id:0},
    wars:[{primary_attacker_id:2,primary_defender_id:3}]};
  const queried=[];
  const neighbors=await readStrategyNeighbors(state,async(method,params)=>{
    if(method==='get_contacts')return {empires};
    if(method==='get_galaxy_map')return {columns:['id','owner_id'],rows:[[0,2],[1,0],[3,3],[4,null]],hyperlanes:[[0,1],[0,4]]};
    queried.push(params.country_id);
    return params.country_id===3?{country_id:3,options:[{legal:false}]}:
      params.country_id===0?{country_id:0,options:[{legal:true}]}:{error:'unavailable'};
  });
  const brief=strategyBrief(state,{neighbors});
  assert.equal(brief.neighborColumns.length,7);
  assert.deepEqual(brief.neighbors[0].slice(2),['未知','未知','未知',true,false]);
  assert.deepEqual(brief.neighbors[1].slice(2),['未知','未知',true,'未知',true]);
  assert.equal(brief.neighbors.length+brief.omittedNeighbors,30);
  assert.ok(Buffer.byteLength(JSON.stringify(brief))<=STRATEGY_BRIEF_MAX_BYTES);
  assert.equal(queried.length,12);
  assert.ok(!queried.includes(2)&&!queried.includes(31));
  const view=new ModelView();
  view.project({strategyBrief:brief});
  assert.deepEqual(view.project({strategyBrief:brief}).strategyBrief,brief);
});
