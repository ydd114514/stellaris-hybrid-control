// Prepared for unified validation. Not executed during the user's rest stage.
import test from 'node:test';import assert from 'node:assert/strict';
import {localWaitTarget,localQueueWaitProof} from '../src/local-work-wait.mjs';
const fixture=()=>{
 const action={status:'queued',queueItemId:0,date:'2202.07.01',cost:{minerals:500}};
 const record={id:'r',sessionId:'s',status:'waiting',planetId:0,colonyId:0,ownerId:0,queueId:0,districtKey:'district_city',designation:'col_capital',createdDate:'2202.07.01',actions:[action]};
 return {record,action,sessionId:'s',native:{known:true,enabled:false,planet_id:0,colony_id:0,owner_id:0,queue:{known:true,queue_id:0,items:[{item_id:0}]}},planet:{planet_id:0,colony_id:0,designation_key:'col_capital',construction_queue:[{item_id:0,key:'district_city'}]},status:{date:{formatted:'2202.07.02'},resources:{minerals:{stockpile:1000,net:0}}}};
};
test('only one current owned queued action can extend local waiting; IDs including zero are valid',()=>{
 const f=fixture();assert.equal(localWaitTarget([f.record],'s').action.queueItemId,0);assert.equal(localQueueWaitProof(f).trusted,true);
 for(const change of [{status:'paused'},{status:'blocked'},{reviewRequired:true},{sessionId:'old'},{actions:[{...f.action,status:'unknown'}]},{actions:[]}])assert.equal(localWaitTarget([{...f.record,...change}],'s'),null);
 assert.equal(localWaitTarget([f.record,{...f.record,id:'second'}],'s'),null);
});
test('queue generations, native AI, ownership and designation must still match',()=>{
 for(const mutate of [f=>f.native.enabled=true,f=>f.native.queue.queue_id=1,f=>f.native.owner_id=1,f=>f.native.queue.items=[],f=>f.planet.colony_id=1,f=>f.planet.designation_key='col_changed',f=>f.planet.construction_queue[0].item_id=1]){
  const f=fixture();mutate(f);assert.equal(localQueueWaitProof(f).trusted,false);
 }
});
test('upgrade work needs the same full building instance and queue item rather than a same-name substitute',()=>{
 const f=fixture();f.action.order={command:'upgrade_building',arguments:{planet_id:0,building_id:0,upgrade_key:'building_lab_2'}};
 f.planet.construction_queue=[{item_id:0,type:'building_upgrade',key:'building_lab_2',building_id:0}];assert.equal(localQueueWaitProof(f).trusted,true);
 f.planet.construction_queue[0].building_id=1;assert.equal(localQueueWaitProof(f).trusted,false);
});
test('fresh resource shortages, unknown observations and date rollback never authorize longer waiting',()=>{
 for(const mutate of [f=>f.status.date.formatted='2202.06.01',f=>f.status.resources={},f=>f.status.resources.minerals.stockpile_known=false,f=>f.commitments={minerals:1001},f=>f.floors={minerals:1001}]){
  const f=fixture();mutate(f);assert.equal(localQueueWaitProof(f).trusted,false);
 }
});
