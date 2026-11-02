import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {resolveStrategyDirection,ascensionEconomyStage} from '../src/strategy-direction.mjs';
import {NativeGame} from '../src/native-game.mjs';
import {NativeStrategyReview} from '../src/native-strategy-review.mjs';
const base={economyFocus:'research',expansionStance:'aggressive',militaryStance:'peaceful',oneOffActions:[],reason:'发展科研'};
test('operator phase counts actually adopted ascension perks, not completed trees, slots or unity income',()=>{
 const state={operatorMessages:['前期主搞凝聚力，第三个飞升搞完后再点科研'],traditions:{adopted_trees_count:7},ascensionPerks:{adopted:[{key:'ap_one'},{key:'ap_two'}],available_slots:6},resources:{unity:{net:1000}}};
 assert.equal(resolveStrategyDirection({state,contract:base}).contract.economyFocus,'unity_traditions');
 state.ascensionPerks.adopted.push({key:'ap_three'});assert.equal(resolveStrategyDirection({state,contract:{...base,economyFocus:'unity_traditions'}}).contract.economyFocus,'research');
 const phaseReview=new NativeStrategyReview();phaseReview.acknowledge({...state,ascensionPerks:{adopted:state.ascensionPerks.adopted.slice(0,2)}});assert.ok(phaseReview.due(state).includes('strategic_event'));
 state.wars=[{war_id:1}];assert.equal(resolveStrategyDirection({state,contract:base}).contract.economyFocus,'alloys_military');
 delete state.wars;state.ascensionPerks=null;assert.equal(ascensionEconomyStage(state).count,null);assert.equal(resolveStrategyDirection({state,contract:base}).contract.economyFocus,'unity_traditions');
 state.operatorMessages=[];state.operationalGoal={text:'第三个飞升后转科研，前期凝聚力'};assert.equal(ascensionEconomyStage(state),undefined);
});
test('standing overrides advice and model, survival temporarily overrides standing and then restores it',()=>{
 const state={operatorStanding:{economyFocus:'unity_traditions'},operationalGoal:{targetResource:'alloys'},wars:[],resources:{energy:{stockpile:100,net:1}}};
 const resolve=()=>resolveStrategyDirection({state,contract:base});
 assert.equal(resolve().contract.economyFocus,'unity_traditions');
 state.wars=[{war_id:1}];assert.equal(resolve().contract.economyFocus,'alloys_military');assert.match(resolve().reason,/战争.*恢复/);
 state.wars=[];state.resources.energy={stockpile:5,net:-1};assert.equal(resolve().contract.economyFocus,'balanced');assert.match(resolve().reason,/六个月.*恢复/);
 state.resources.energy={stockpile:100,net:1};assert.equal(resolve().contract.economyFocus,'unity_traditions');
 delete state.operatorStanding;assert.equal(resolve().contract.economyFocus,'alloys_military');
 delete state.operationalGoal;assert.equal(resolve().contract.economyFocus,'research');
 const review=new NativeStrategyReview();review.acknowledge(state);
 assert.ok(review.due({...state,operatorStanding:{text:'凝聚力',economyFocus:'unity_traditions'}}).includes('strategic_event'));
});
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'direction-'));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'commentary'));
 const active=new Set(['cfsteer_economy_balanced']),calls=[];
 const game=Object.create(NativeGame.prototype);
 Object.assign(game,{directory:join(root,'bridge'),nativeCountryAIEnabled:true,modelStrategyContract:base,now:()=>100000,
  countryAI:{view:()=>({owner:'native',generation:1}),heartbeat:async()=>{}},commandScope:async()=>{},
  rpc:async(method,p)=>{calls.push({method,p});if(method==='get_edicts')return {active_edicts:[...active].map(key=>({key}))};
   assert.equal(method,'toggle_edict');p.enabled?active.add(p.edict_key):active.delete(p.edict_key);return {success:true};}});
 return {game,active,calls,receipt:async()=>JSON.parse(await readFile(join(root,'commentary/controller-receipt.json'),'utf8'))};
}
test('controller applies unity without model requests, publishes confirmed receipt, recovers after war and withdraws on deletion',async t=>{
 const {game,active,calls,receipt}=await fixture(t);
 const state={date:'2200.01.01',operatorStanding:{id:'o-1',economyFocus:'unity_traditions'},resources:{},wars:[]};
 await game.syncStrategyDirection(state);assert.ok(active.has('cfsteer_economy_unity_traditions'));assert.equal((await receipt()).steeringApplied,true);assert.equal((await receipt()).operatorStandingId,'o-1');
 const n=calls.length;await game.syncStrategyDirection(state);assert.equal(calls.length,n);
 state.wars=[{war_id:1}];await game.syncStrategyDirection(state);assert.ok(active.has('cfsteer_economy_alloys_military'));assert.match((await receipt()).reason,/战争/);
 state.wars=[];await game.syncStrategyDirection(state);assert.ok(active.has('cfsteer_economy_unity_traditions'));
 delete state.operatorStanding;await game.syncStrategyDirection(state);assert.ok(active.has('cfsteer_economy_research'));assert.equal(active.has('cfsteer_economy_unity_traditions'),false);assert.equal((await receipt()).steeringApplied,false);
 assert.ok(calls.every(c=>['get_edicts','toggle_edict'].includes(c.method)));
});
test('failed or inactive steering is never acknowledged as applied and an unconfirmed command is not replayed',async t=>{
 const {game,receipt}=await fixture(t),state={operatorStanding:{id:'o-2',economyFocus:'unity_traditions'}};
 game.countryAI.view=()=>({owner:'human',generation:1});await game.syncStrategyDirection(state);assert.equal((await receipt()).steeringApplied,false);
 game.countryAI.view=()=>({owner:'native',generation:1});let writes=0;
 game.rpc=async(method)=>{if(method==='get_edicts')return {active_edicts:[]};writes++;return {success:false};};
 await game.syncStrategyDirection(state);assert.equal((await receipt()).steeringApplied,false);
 await game.syncStrategyDirection(state,{force:true});assert.equal(writes,1);
});
test('model contract cannot override standing, and automatic recovery does not replay reserved decisions',async t=>{
 const {game,active}=await fixture(t);let decisions=0;
 game.sessionId='s';game.binding={pid:1};game.lastState={date:'2200.01.01',operatorStanding:{id:'o-3',economyFocus:'unity_traditions'}};
 game.refreshOperatorStanding=async()=>{};game.checkpoint=async()=>{};game.countryAI.acknowledgeReview=async()=>{};
 game.strategyReview={acknowledge:()=>{}};game.observe=async()=>game.lastState;game.apply=async()=>{decisions++;return {status:'posted'};};
 const contract={...base,oneOffActions:[{type:'declare_war',arguments:{country_id:1,goal_key:'wg_conquest'}}]};
 const result=await game.strategyControl({requestId:'strategy-1',contract});
 assert.equal(result.status,'applied');assert.equal(result.contract.economyFocus,'unity_traditions');assert.equal(decisions,1);assert.ok(active.has('cfsteer_economy_unity_traditions'));
 await game.strategyControl({requestId:'strategy-1',contract});assert.equal(decisions,1);
 game.lastState.wars=[{war_id:1}];await game.syncStrategyDirection(game.lastState);
 game.lastState.wars=[];await game.syncStrategyDirection(game.lastState);assert.equal(decisions,1);
});
test('text-only standing is delivered without inventing a focus; stopped controller revokes applied receipt',async t=>{
 const {game,calls,receipt}=await fixture(t);delete game.modelStrategyContract;
 const state={operatorStanding:{id:'o-4',text:'前期主拉凝聚力',economyFocus:null}};
 await game.syncStrategyDirection(state);assert.equal(calls.length,0);assert.equal((await receipt()).steeringApplied,false);assert.match((await receipt()).reason,/尚未解析/);
 state.operatorStanding.economyFocus='unity_traditions';await game.syncStrategyDirection(state);assert.equal((await receipt()).steeringApplied,true);
 const n=calls.length;game.stopped=true;await game.syncStrategyDirection(state);assert.equal(calls.length,n);assert.equal((await receipt()).steeringApplied,false);
});
