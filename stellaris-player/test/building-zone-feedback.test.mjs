import test from 'node:test';
import assert from 'node:assert/strict';
import {readBuildingAdmission} from '../src/building-candidates.mjs';
import {inspectBuildingQuote,inspectConstruction,constructionInspectionScope} from '../src/construction-inspection.mjs';
import {nativeToolErrorText} from '../src/candidate-feedback.mjs';

const planet={planet_id:3,colony_id:0};
const snapshot={success:true,...planet,zones:[
 {zone_id:0,district:'district_hive',zone_name:'政府特区',buildings:3,max_buildings:6,buildable:[]},
 {zone_id:2,district:'district_hive',zone_name:'档案馆',buildings:0,max_buildings:3,buildable:[]},
 {zone_id:3,district:'district_hive',zone_name:'重工业',buildings:0,max_buildings:3,buildable:[]},
 {zone_id:16777258,district:'district_hive',zone_name:'凝聚力特区',buildings:0,max_buildings:3,buildable:[]}
]};
const expected=snapshot.zones.map(({zone_id,district,zone_name,buildings,max_buildings})=>({zone_id,district,zone_name,buildings,max_buildings}));

test('unsent wrong slot uses the already-read bulk identities and keeps complete generation bits without inventing a candidate',async()=>{
 const calls=[];
 await assert.rejects(readBuildingAdmission({planet_id:3,building_key:'building_hive_node',district_type:'district_hive',slot_index:4},async(...args)=>{calls.push(args);assert.fail('must reuse the fresh bulk read');},{choices:snapshot}),error=>{
  assert.equal(error.rejected,true);assert.equal(error.nativeWriteAttempted,false);assert.equal(error.candidateFeedback.reasonCode,'zone_id_not_found');
  assert.equal(error.candidateFeedback.planet_id,3);assert.deepEqual(error.candidateFeedback.actualZones,expected);
  assert.equal(error.candidateFeedback.candidates,undefined);assert.equal(error.candidateFeedback.actualZones.at(-1).zone_id,16777258);
  return true;
 });
 assert.deepEqual(calls,[]);
});

test('direct and combined inspections preserve genuine zone choices on rejection without sending a target quote or losing ownership checks',async()=>{
 const calls=[],rpc=async(method,params)=>{calls.push({method,params});assert.equal(params.building_key,undefined);return method==='get_planet_details'?planet:snapshot;};
 const buildingTarget={buildingKey:'building_hive_node',zoneId:4};
 await assert.rejects(inspectBuildingQuote({planetId:3,buildingTarget,rpc}),error=>{
  const value=JSON.parse(nativeToolErrorText(error));
  assert.equal(value.nativeWriteAttempted,false);assert.equal(value.candidateFeedback.reasonCode,'zone_id_not_found');assert.deepEqual(value.candidateFeedback.actualZones,expected);
  return true;
 });
 assert.deepEqual(calls.map(row=>row.method),['get_planet_details','get_buildable_buildings']);calls.length=0;
 const result=await inspectConstruction({planetId:3,scope:constructionInspectionScope({topic:'construction',sections:['buildings'],building_key:'building_hive_node',zone_id:4}),rpc});
 assert.equal(result.sections.buildings.known,false);assert.deepEqual(result.sections.buildings.candidateFeedback.actualZones,expected);
 assert.equal(calls.length,2);
 await assert.rejects(inspectBuildingQuote({planetId:3,buildingTarget,rpc:async method=>method==='get_planet_details'?planet:{...snapshot,colony_id:1}}),error=>{
  assert.equal(error.candidateFeedback,undefined);return /归属/.test(error.message);
 });
 assert.equal(nativeToolErrorText(Error('ordinary error')),'ordinary error');
});
