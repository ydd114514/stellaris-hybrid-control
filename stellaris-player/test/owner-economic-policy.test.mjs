import test from 'node:test';
import assert from 'node:assert/strict';
import {economicResourceGap,ownerEconomicPolicyReview,economicEdictActivationProblem,existingExplorerOrderProblem} from '../src/owner-economic-policy.mjs';
import {applyDomesticEdict} from '../src/strategy-contract.mjs';
const policy={version:1,source:'user-current-chat',priority:'unity_first',resourcePolicy:'deficit_only',edictPolicy:'unity_net_gain',civilianFleetPolicy:'use_existing_explorers'};
const state=()=>({snapshotId:'current-1',date:'2200.01.01',userEconomicPolicy:policy,wars:[],resources:Object.fromEntries(['energy','minerals','food','consumer_goods','alloys','trade','physics_research','society_research','engineering_research'].map(key=>[key,{net:10,stockpile:100}]))});
const active=keys=>({summary:{active_edicts_count:keys.length},active_edicts:keys.map(key=>({key})),available_edicts:keys.map(key=>({key,can_deactivate:true}))});
const activation=key=>({type:'toggle_edict',arguments:{edict_key:key,enabled:true}});

test('real and quoted upcoming gaps count, low reserves and positive net alone do not invent surplus goals',()=>{
 const s=state();s.resources.minerals.stockpile=1;
 assert.equal(economicResourceGap(s,'minerals').needed,false);
 assert.equal(economicResourceGap(s,'minerals',{upcomingCost:2}).needed,true);
 assert.equal(economicResourceGap(s,'minerals',{additionalMonthlyUpkeep:11}).needed,true);
 s.resources.minerals.net=-1;assert.equal(economicResourceGap(s,'minerals').actualDeficit,true);
 s.resources.minerals.net_known=false;assert.equal(economicResourceGap(s,'minerals').known,false);
});

test('owner policy produces executable ordinary cancellations while preserving supply, free and nonordinary edicts',()=>{
 const s=state();s.resources.food.net=-1;
 const edicts=active(['research_subsidies','mining_subsidies','farming_subsidies','veneration_of_saints','cfsteer_economy_unity_traditions','system_role']);
 const review=ownerEconomicPolicyReview(s,{edicts});
 assert.deepEqual(review.domesticActions.map(action=>action.arguments.edict_key),['research_subsidies']);
 assert.ok(review.deferred.some(row=>row.key==='farming_subsidies'));assert.equal(review.unitySavingsKnown,false);
 const postDisableProjections={mining_subsidies:{verified:true,edictKey:'mining_subsidies',action:'disable',snapshotId:s.snapshotId,date:s.date,resources:{minerals:{net:2,net_known:true}}}};
 assert.deepEqual(ownerEconomicPolicyReview(s,{edicts,postDisableProjections}).domesticActions.map(action=>action.arguments.edict_key),['research_subsidies','mining_subsidies']);
 edicts.active_edicts[0].upkeep_known=true;edicts.active_edicts[0].upkeep={unity:0};
 assert.deepEqual(ownerEconomicPolicyReview(s,{edicts,postDisableProjections}).domesticActions.map(action=>action.arguments.edict_key),['mining_subsidies']);
 s.wars=[{}];assert.deepEqual(ownerEconomicPolicyReview(s,{edicts}).domesticActions,[]);
});

test('core subsidies require a current verified post-disable projection and cannot turn healthy current income red',()=>{
 const s=state(),edicts=active(['forge_subsidies','capacity_subsidies','mining_subsidies']);
 let review=ownerEconomicPolicyReview(s,{edicts});assert.deepEqual(review.domesticActions,[]);
 assert.ok(review.deferred.every(row=>/缺少停用后/.test(row.reason)));
 const quote=(key,resource,net)=>({verified:true,edictKey:key,action:'disable',snapshotId:s.snapshotId,date:s.date,resources:{[resource]:{net,net_known:true}}});
 const projections={forge_subsidies:quote('forge_subsidies','alloys',-20),capacity_subsidies:quote('capacity_subsidies','energy',0),mining_subsidies:quote('mining_subsidies','minerals',5)};
 review=ownerEconomicPolicyReview(s,{edicts,postDisableProjections:projections});
 assert.deepEqual(review.domesticActions.map(action=>action.arguments.edict_key),['capacity_subsidies','mining_subsidies']);
 assert.match(review.deferred.find(row=>row.key==='forge_subsidies').reason,/停用后将形成/);
 for(const change of [{verified:false},{snapshotId:'old'},{date:'2199.01.01'},{resources:{energy:{net:0,net_known:false}}}]){
  review=ownerEconomicPolicyReview(s,{edicts:active(['capacity_subsidies']),postDisableProjections:{capacity_subsidies:{...projections.capacity_subsidies,...change}}});
  assert.deepEqual(review.domesticActions,[]);
 }
 review=ownerEconomicPolicyReview(s,{edicts:active(['mining_subsidies']),postDisableProjections:projections,upcomingCosts:{minerals:101}});
 assert.deepEqual(review.domesticActions,[]);
});

test('partial law lists, unknown supply and explicit native refusal never schedule removals',()=>{
 const s=state(),edicts=active(['mining_subsidies']);edicts.summary.active_edicts_count=2;
 assert.deepEqual(ownerEconomicPolicyReview(s,{edicts}).domesticActions,[]);
 edicts.summary.active_edicts_count=1;s.resources.minerals.net_known=false;
 assert.deepEqual(ownerEconomicPolicyReview(s,{edicts}).domesticActions,[]);
 s.resources.minerals.net_known=true;edicts.available_edicts[0].can_deactivate=false;
 assert.deepEqual(ownerEconomicPolicyReview(s,{edicts}).domesticActions,[]);
});

test('current-owner policy blocks pointless new upkeep but retains real shortage and war defense',()=>{
 const s=state();assert.match(economicEdictActivationProblem(activation('mining_subsidies'),s),/没有.*真实缺口/);
 s.resources.minerals.net=-1;assert.equal(economicEdictActivationProblem(activation('mining_subsidies'),s),null);
 assert.ok(economicEdictActivationProblem(activation('veneration_of_saints'),s));
 s.wars=[{}];assert.equal(economicEdictActivationProblem(activation('fleet_supremacy'),s),null);
 delete s.userEconomicPolicy;assert.equal(economicEdictActivationProblem(activation('mining_subsidies'),s),null);
});

test('the existing domestic executor re-reads policy facts and never writes a wasteful activation',async()=>{
 let writes=0;const s=state();s.resources.minerals.net=-10;
 const rpc=async method=>method==='get_edicts'?{...active([]),available_edicts:[{key:'mining_subsidies',can_activate:true}]}:
  method==='get_status'?{resources:state().resources}:method==='get_wars'?{wars:[]}:assert.fail(method);
 await assert.rejects(applyDomesticEdict({action:activation('mining_subsidies'),policyState:s,rpc,write:async()=>{writes++;return {success:true};}}),/没有.*真实缺口/);
 assert.equal(writes,0);
});

test('existing explorers and scientists are reused without a new engineer ship restriction',()=>{
 const s=state();s.civilian={science_ships:[{fleet_id:0,ship_id:0}]};
 assert.ok(existingExplorerOrderProblem({command:'build_ship'},s,{shipClass:'shipclass_science_ship'}));
 assert.equal(existingExplorerOrderProblem({command:'build_ship'},s,{shipClass:'shipclass_constructor'}),null);
 assert.ok(existingExplorerOrderProblem({command:'hire_leader'},s,{leaderClass:'scientist',leaders:{hired_leaders:[{class:'scientist'}]}}));
 assert.equal(existingExplorerOrderProblem({command:'hire_leader'},s,{leaderClass:'scientist',leaders:{hired_leaders:[]}}),null);
});
