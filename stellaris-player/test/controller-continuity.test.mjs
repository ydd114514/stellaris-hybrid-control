import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ControllerContinuity} from '../src/controller-continuity.mjs';
import {createGrowthTracker} from '../src/strategic-review.mjs';
test('guard diagnosis resumes only under bound process/player and non-regressing recent dates',async t=>{const directory=await mkdtemp(join(tmpdir(),'fish-continuity-'));t.after(()=>rm(directory,{recursive:true,force:true}));let now=100000;const c=new ControllerContinuity({directory,now:()=>now}),binding={pid:1,creationTime:'123'},state={date:'2324.01.01',player:{country_id:0,capital_system_id:1}};await c.save(binding,state,{stationFailures:[['1:mining',{signature:'x',error:'private reflected text'}]]});assert.equal((await c.load(binding,state)).stationFailures[0][1].signature,'x');assert.equal(await c.load({...binding,creationTime:'new'},state),null);assert.equal(await c.load(binding,{...state,date:'2200.01.01'}),null);assert.equal(await c.load(binding,{...state,player:{country_id:1}}),null);now+=86400001;assert.equal(await c.load(binding,state),null);});
test('growth resume preserves bounded historical trend and rejects a backdated or foreign state',()=>{const s=(date,n)=>({date,player:{country_id:0,capital_system_id:1},resources:Object.fromEntries(['physics_research','society_research','engineering_research'].map(k=>[k,{net:n}]))});const t=createGrowthTracker();t.record(s('2300.01.01',100));t.record(s('2315.01.01',101));const saved=t.serialize(),newTracker=createGrowthTracker();assert.equal(newTracker.restore(saved,s('2316.01.01',102)),true);assert.equal(newTracker.review(s('2316.01.01',102)).stagnating,true);assert.equal(newTracker.restore(saved,s('2200.01.01',102)),false);});

test('native continuity fences another world generation and strips only legacy task authority',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'fish-continuity-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 const c=new ControllerContinuity({directory,now:()=>100000}),binding={pid:1,creationTime:'123'};
 const old={date:'2202.01.01',player:{country_id:0,capital_system_id:1}};
 const current={...old,date:'2203.01.01',nativeWorldGeneration:4};
 const receipt={ownerEconomicTask:true,status:'expired_unknown'};
 const data={orderTracking:{records:[receipt]},domesticUnknown:['guarded-scope']};
 await c.save(binding,old,data);
 const legacy=await c.load(binding,current);
 assert.deepEqual(legacy.orderTracking.records,[{...receipt,ownerEconomicTask:false}]);
 assert.deepEqual(legacy.domesticUnknown,data.domesticUnknown);
 await c.save(binding,current,data);
 assert.deepEqual((await c.load(binding,current)).orderTracking.records,[receipt]);
 assert.equal(await c.load(binding,{...current,nativeWorldGeneration:5}),null);
});
