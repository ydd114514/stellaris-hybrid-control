import test from 'node:test';import assert from 'node:assert/strict';
import {reachableSurveyCandidate} from '../src/survey-candidates.mjs';
const options={referenceSystemId:999};
function fixture(targets,path=()=>({reachable:false}),fleetId=1){
 const calls=[];const rpc=async(m,p)=>{calls.push({m,p});if(m==='find_systems')return {systems:targets};if(p.to_system_id===999)return {fleet_id:fleetId,from_system_id:77,to_system_id:999,reachable:false};return {fleet_id:fleetId,from_system_id:77,to_system_id:p.to_system_id,...path(p)};};
 return {rpc,calls};
}
test('legal survey candidates alone never prove reachable native work',async()=>{
 const f=fixture([{id:0,intel:1}]);await assert.rejects(reachableSurveyCandidate(f.rpc,1,options),/未确认可达/);assert.equal(f.calls.length,3);
});
test('candidates use the actual fleet origin even when the capital route is blocked',async()=>{
 const f=fixture([{id:2,intel:3}],()=>({reachable:true,systems:[{id:2}]}));
 const r=await reachableSurveyCandidate(f.rpc,1,options);assert.equal(r.target.id,2);assert.equal(f.calls.find(x=>x.m==='find_systems').p.from_system_id,77);
});
test('later reachable candidates retain exact fleet and target identities',async()=>{
 const f=fixture([{id:0,intel:1},{id:2,intel:1}],p=>({reachable:p.to_system_id===2,systems:[{id:2}]}),0);
 assert.equal((await reachableSurveyCandidate(f.rpc,0,options)).checked.length,2);
 const wrong=fixture([{id:0,intel:1}],()=>({fleet_id:88,reachable:true,systems:[{id:0}]}));
 await assert.rejects(reachableSurveyCandidate(wrong.rpc,1,options),/未确认可达/);
});
test('bounded route checks do not imply the rest of the galaxy has no work',async()=>{
 const f=fixture(Array.from({length:50},(_,id)=>({id,intel:1})));
 await assert.rejects(reachableSurveyCandidate(f.rpc,1,options),/本轮候选/);assert.equal(f.calls.filter(x=>x.m==='find_path').length,9);
});
test('unexplored candidates require strategic arrival; missing intel never authorizes automation',async()=>{
 const f=fixture([{id:20,intel:0}]);await assert.rejects(reachableSurveyCandidate(f.rpc,1,options),/先选择方向正常航行/);assert.equal(f.calls.length,2);
 await assert.rejects(reachableSurveyCandidate(fixture([{id:20}]).rpc,1,options),/情报未知/);
 const mixed=fixture([{id:20,intel:0},{id:33,intel:3}],()=>({reachable:true,systems:[{id:33}]}));
 const r=await reachableSurveyCandidate(mixed.rpc,1,options);assert.equal(r.target.id,33);assert.equal(r.checked[0].requiresExploration,true);
});
test('missing, mismatched or damaged origin never falls back to capital-centered candidates',async()=>{
 await assert.rejects(reachableSurveyCandidate(async()=>({}),1),/参照星系/);
 for(const origin of [{},{fleet_id:2,from_system_id:77},{fleet_id:1,from_system_id:0xffffffff}]){
  let calls=0;await assert.rejects(reachableSurveyCandidate(async()=>{calls++;return origin;},1,options),/出发星系未知/);assert.equal(calls,1);
 }
});
