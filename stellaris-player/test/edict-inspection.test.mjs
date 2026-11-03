import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeGame} from '../src/native-game.mjs';

async function inspect(raw){
 const calls=[],recorded=[];
 const game={lastState:{date:'2300.01.01',resources:{unity:{net:20,net_known:true},physics_research:{net:-1,stockpile:0}}},guard:async()=>({}),rpc:async method=>{calls.push(method);assert.equal(method,'get_edicts');return raw;},operationalContext:{record(){}},log:async row=>recorded.push(row)};
 const result=await NativeGame.prototype.inspect.call(game,{topic:'edicts'});
 return {result,calls,recorded};
}

test('edict inspection exposes active keys without treating legacy zero fund or absent upkeep as known',async()=>{
 const {result,calls,recorded}=await inspect({summary:{active_edicts_count:2,edict_fund:0},active_edicts:[{key:'subsidize_farming',name:'营养补贴'},{key:'cfsteer_economy_unity_traditions',name:'凝聚力重点'}]});
 assert.deepEqual(calls,['get_edicts']);assert.equal(result.summary.active_edicts_count,2);
 assert.equal(result.summary.edict_fund,null);assert.equal(result.summary.edict_fund_known,false);
 assert.deepEqual(result.active_edicts.map(row=>row.key),['subsidize_farming','cfsteer_economy_unity_traditions']);
 assert.ok(result.active_edicts.every(row=>row.upkeep===null&&row.upkeep_known===false));assert.equal(result.maintenance_details_known,false);
 assert.equal(recorded[0].topic,'edicts');assert.match(result.note,/只有实际回读确认才能称已关闭/);
});
test('confirmed future fund and maintenance fields survive the read view',async()=>{
 const {result}=await inspect({summary:{active_edicts_count:1,edict_fund:80,edict_fund_known:true},active_edicts:[{key:'subsidize_farming',name:'营养补贴',upkeep:{unity:12},upkeep_known:true}]});
 assert.equal(result.summary.edict_fund,80);assert.equal(result.summary.edict_fund_known,true);
 assert.deepEqual(result.active_edicts[0].upkeep,{unity:12});assert.equal(result.maintenance_details_known,true);
});
test('an unreadable edict list fails instead of inventing an empty successful inspection',async()=>{
 await assert.rejects(inspect({summary:{active_edicts_count:9}}),/不可读/);
});
test('a partial returned list cannot claim complete maintenance detail',async()=>{
 const {result}=await inspect({summary:{active_edicts_count:9},active_edicts:[]});
 assert.equal(result.active_edicts_complete,false);assert.equal(result.maintenance_details_known,false);
});

test('edict inspection returns only native-confirmed ordinary activation candidates',async()=>{
 const {result}=await inspect({summary:{active_edicts_count:1},active_edicts:[{key:'fortify_the_border'}],available_edicts:[
  {key:'research_subsidies',name:'科研补贴',can_activate:true,upkeep_known:true,upkeep:{unity:10}},{key:'capacity_subsidies',can_activate:false},
  {key:'mining_subsidies',is_active:false},{key:'cfsteer_economy_research',can_activate:true},
  {key:'fortify_the_border',can_activate:true},
 ]});
 assert.deepEqual(result.available_edicts,[{key:'research_subsidies',name:'科研补贴',can_activate:true}]);
 assert.equal(result.edict_activation_status,'ok');
 const legacy=await inspect({summary:{active_edicts_count:0},active_edicts:[],available_edicts:[{key:'research_subsidies',is_active:false}]});
 assert.deepEqual(legacy.result.available_edicts,[]);
 assert.equal(legacy.result.edict_activation_status,'能力缺口');
});
