import test from 'node:test';
import assert from 'node:assert/strict';
import {OperationalContext,executionCapabilities} from '../src/operational-context.mjs';

test('observed details expire, are bounded and do not leak arbitrary native fields',()=>{
  let now=1000;const c=new OperationalContext({now:()=>now,maxEntries:2,maxChars:1000});
  c.record('planet',{planet_id:0,name:'地球',kpi:{housing:500,unemployed:0},privateSecret:'DO_NOT_COPY',status_alerts:[{name:'首府可升级'}]},{gameDate:'2324.01.01'});
  assert.match(JSON.stringify(c.view()),/首府可升级/);assert.doesNotMatch(JSON.stringify(c.view()),/DO_NOT_COPY/);
  c.record('jobs',{planet_id:0,strata:[{jobs:[{job_key:'artisan',current_workforce:200,max_workforce:200,is_prioritized:true}]}]});
  assert.match(c.view()[0].facts,/200\/200.*已优先/);
  c.record('government',{authority_name:'民主制'});assert.equal(c.view().length,2);
  now+=60001;assert.deepEqual(c.view(),[]);
});
test('new sessions start empty and current ownership filters foreign colony facts',()=>{
  const c=new OperationalContext({now:()=>100});c.record('planet',{planet_id:548,name:'外国星球'});c.record('planet',{planet_id:0,name:'地球'});
  assert.deepEqual(c.view({ownedPlanetIds:[0]}).map(x=>x.entityId),[0]);assert.deepEqual(new OperationalContext().view(),[]);
});
test('an empty building detail list is not presented as empty slots and known capacity survives',()=>{
  const c=new OperationalContext({now:()=>100});c.record('planet',{planet_id:298,districts:[{zones:[{buildings:[]}]}]});c.record('buildings',{planet_id:298,zones:[{zone_id:135,zone_name:'科研聚落',buildings:3,max_buildings:3,buildable:[]}]});
  const s=JSON.stringify(c.view());assert.match(s,/3\/3/);assert.match(s,/不证明空槽/);assert.match(s,/不猜空槽/);
});
test('capability report derives executable actions without claiming missing upgrades work',()=>{
  const c=executionCapabilities(['build_district','build_district','select_research']);assert.deepEqual(c.availableActions,['build_district','select_research']);assert.match(c.limitations.join('；'),/首府及建筑升级尚无执行接口/);
  assert.ok(!executionCapabilities(['upgrade_building']).limitations.some(x=>x.startsWith('首府')));
});
