import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeColonyAudit} from '../src/native-colony-audit.mjs';
const state=()=>({date:'2200.01.01',player:{country_id:1,capital_system_id:3},colonies:[{colonies_summary:Array.from({length:6},(_,i)=>({planet_id:i,name:'P'+i,status_alerts_count:i<2?1:0,has_construction:false}))}]});
test('只读轮巡有预算且公平覆盖当前殖民地，不反复盯住同一警报星球',async()=>{
 const audit=new NativeColonyAudit(),s=state(),calls=[],options={rpc:async(m,p)=>{calls.push({m,...p});return {planet_id:p.planet_id}},onPlanet:()=>{}};
 assert.equal((await audit.review(s,options)).checkedThisRound.length,3);
 await audit.review(s,options);assert.equal(calls.length,3);
 s.date='2200.07.01';await audit.review(s,options);assert.equal(new Set(calls.map(c=>c.planet_id)).size,6);assert.ok(calls.every(c=>c.m==='get_planet_details'));
});
test('换局/倒退日期清空历史；排除正在殖民的星球且身份错误不写诊断',async()=>{
 const audit=new NativeColonyAudit(),s=state();s.colonies[0].colonies_summary=s.colonies[0].colonies_summary.slice(0,2);s.colonies[0].colonies_summary[0].is_colonizing=true;
 let recorded=0;const options={rpc:async()=>({planet_id:99}),onPlanet:()=>recorded++};
 assert.deepEqual((await audit.review(s,options)).failed,[1]);assert.equal(recorded,0);
 s.player.country_id=2;const r=await audit.review(s,{rpc:async(m,p)=>({planet_id:p.planet_id})});assert.deepEqual(r.checkedThisRound,[1]);
});
