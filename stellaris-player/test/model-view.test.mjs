import test from 'node:test';
import assert from 'node:assert/strict';
import {ModelView,restoreModelView,attentionReasons} from '../src/model-view.mjs';

test('model deltas reconstruct complete current state, including zero, empty and removed fields',()=>{
  const view=new ModelView({fullEvery:4});let memory={};
  const states=[{snapshotId:'a',date:'1',wars:[{war_id:0}],research:{physics:{current:{is_researching:true}}},retired:true},{snapshotId:'b',date:'2',wars:[],research:{physics:{current:{is_researching:true}}},count:0},{snapshotId:'c',date:'3',wars:[],research:{physics:{current:{is_researching:false}}},count:0}];
  for(const state of states){const result=view.project(state);memory=restoreModelView(memory,result);assert.deepEqual(memory,state);}
  assert.equal(view.project(states.at(-1),{full:true}).view,'full');
});
test('nested resource deltas retain limits and income and explicitly remove fields, while arrays replace literally',()=>{
  const v=new ModelView({fullEvery:20});let state={snapshotId:'s0',resources:{alloys:{stockpile:100,max:1000,net:10},energy:{net:4}},civilian:{ships:[{id:0}]},pendingEvents:[{window_id:0}]};
  let memory=restoreModelView({},v.project(state));
  state={snapshotId:'s1',resources:{alloys:{stockpile:101,max:1000,net:0},energy:{}},civilian:{ships:[]},pendingEvents:[],warGoalsWindow:false};
  const delta=v.project(state);assert.deepEqual(delta.changes.resources,{alloys:{stockpile:101,net:0}});
  assert.deepEqual(delta.removed,[['resources','energy','net']]);assert.deepEqual(delta.changes.civilian.ships,[]);
  memory=restoreModelView(memory,delta);assert.deepEqual(memory,state);
  state={...state,resources:null};memory=restoreModelView(memory,v.project(state));assert.deepEqual(memory,state);
});
test('object/scalar transitions and empty objects reconstruct without losing the current snapshot',()=>{
  const v=new ModelView({fullEvery:50});let memory={};
  for(const value of [3,{},null,[],{a:{b:0}},{a:[]},{},false]){
    const state={snapshotId:JSON.stringify(value),date:'2200.01.01',remainingSeconds:0,paused:false,speed:0,value};
    memory=restoreModelView(memory,v.project(state));assert.deepEqual(memory,state);
  }
});
test('a full observation is periodically refreshed without dropping unchanged state',()=>{
  const v=new ModelView({fullEvery:2}),state={snapshotId:'x',player:{country_id:0}};
  assert.equal(v.project(state).view,'full');assert.equal(v.project(state).view,'delta');assert.equal(v.project(state).view,'full');
});
test('quiet resource accumulation waits locally while urgent changes wake the model',()=>{
  const base={resources:{alloys:{stockpile:1000,net:20,capped:false}},military:{fleets:[{fleet_id:0,total_ships:4,status:'移动中'}]},research:{physics:{current:{key:'tech_a',is_researching:true}}},wars:[],alerts:[],pendingEvents:[],pendingDiplomacy:[]};
  const quiet=structuredClone(base);quiet.resources.alloys.stockpile=1100;assert.deepEqual(attentionReasons(base,quiet),[]);
  const changed=structuredClone(quiet);changed.pendingEvents=[{window_id:0}];changed.military.fleets[0].status='无指令';changed.research.physics.current.is_researching=false;
  const reasons=attentionReasons(base,changed);assert.ok(reasons.includes('central_event'));assert.ok(reasons.includes('fleet_changed'));assert.ok(reasons.includes('research_changed'));
});

test('native full snapshots keep the strategy brief ahead of details when the client clips the payload',()=>{
  const view=new ModelView({fullEvery:2});
  const state={resources:{largeDetail:'x'.repeat(20000)},snapshotId:'s0',date:'2200.01.01',
    decisionReview:{mode:'native_strategy',wakeReasons:['initial_strategy']},
    strategyBrief:{lockedDimensions:{economyFocus:{value:'research',by:'本人要求'}}}};
  const first=view.project(state,{full:true});
  const clipped=JSON.stringify(first).slice(0,2000);
  assert.match(clipped,/"decisionReview":/);
  assert.match(clipped,/"strategyBrief":\{"lockedDimensions":/);
  assert.deepEqual(restoreModelView({},first),state);

  const next={...state,snapshotId:'s1'};
  const delta=view.project(next);
  assert.equal(delta.view,'delta');
  assert.deepEqual(delta.strategyBrief,next.strategyBrief);
  assert.deepEqual(restoreModelView(state,delta),next);
  assert.match(JSON.stringify(view.project(next)).slice(0,2000),/"strategyBrief":/);

  const ordinary={...state,decisionReview:{mode:'ordinary'}};
  assert.equal(JSON.stringify(new ModelView().project(ordinary)),JSON.stringify({view:'full',...ordinary}));
});
