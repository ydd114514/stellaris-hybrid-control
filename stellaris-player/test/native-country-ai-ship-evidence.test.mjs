import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeShipProductionWitnesses} from '../src/native-country-ai-economic-evidence.mjs';
const fixture=(kind='ship')=>{
 const source={domain:'ship_production',payload_country_id:0,tracking_id:1,instance_address:0x10000,
  queue_id:0,design_reference:0,starbase_reference:0,buildable_kind:kind,orbitable_type:2,orbitable_has_extra:false};
 const item={item_id:0x1000000,queue_id:0,paying_country:0,buildable_kind:kind,design_reference:0,
  starbase_reference:0,orbitable_type:2,orbitable_has_extra:false};
 return [{...source,stage:'native_execute_entered',effect_readback:{known:true,owner_id:0,queue_id:0,items:[]}},
  {...source,stage:'native_execute_returned',effect_readback:{known:true,owner_id:0,queue_id:0,items:[item]}},
  {stage:'native_command_resolved',tracking_id:1}];
};
test('own native ship and colony ship need actual new queue items; full ID zero is valid',()=>{
 for(const kind of ['ship','colony_ship']){
  const [w]=nativeShipProductionWitnesses(fixture(kind),0);
  assert.equal(w.itemId,0x1000000);assert.equal(w.stage,'queued');assert.equal(w.buildableKind,kind);
 }
});
test('old items, unexecuted commands, unresolved Clone and unrelated additions are no evidence',()=>{
 const old=fixture();old[0].effect_readback.items=structuredClone(old[1].effect_readback.items);
 const extra=fixture();extra[1].effect_readback.items.push({...extra[1].effect_readback.items[0],item_id:2});
 for(const events of [old,fixture().slice(0,2),fixture().slice(1),extra])assert.deepEqual(nativeShipProductionWitnesses(events,0),[]);
});
test('foreign, stale full refs, wrong design/starbase/payer and incomplete snapshots fail closed',()=>{
 const changes=[e=>e[1].payload_country_id=1,e=>e[1].effect_readback.owner_id=1,
  e=>e[1].effect_readback.items[0].paying_country=1,e=>e[1].effect_readback.items[0].queue_id=0x1000000,
  e=>e[1].effect_readback.items[0].design_reference=0x1000000,e=>e[1].effect_readback.items[0].starbase_reference=0x1000000,
  e=>e[1].effect_readback.known=false,e=>e[0].effect_readback.known=false,
  e=>e[1].instance_address++,e=>e[1].effect_readback.items[0].orbitable_has_extra=true,
  e=>e[1].buildable_kind='federation_ship'];
 for(const mutate of changes){const e=fixture();mutate(e);assert.deepEqual(nativeShipProductionWitnesses(e,0),[]);}
});
