import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectConstruction,constructionInspectionScope} from '../src/construction-inspection.mjs';
import {constructionCandidateCoverage,withConstructionCoverage} from '../src/construction-coverage.mjs';
import {OperationalContext} from '../src/operational-context.mjs';
import {buildingCandidateProblem} from '../src/building-candidates.mjs';

test('真实岗位/空槽与空枚举矛盾时保持覆盖未知，不伪造候选、零劳动力或无科技结论',async()=>{
 const planet={planet_id:0,colony_id:0,workforce_summary:{active_jobs_count:12,total_employed_workforce:5934},
  status_alerts:[{id:'construction_available'}],construction_queue:[]};
 const jobs={success:true,planet_id:0,colony_id:0,total_workforce:5941,strata:[]};
 const buildings={success:true,planet_id:0,colony_id:0,zones:[{zone_id:0,district:'district_hive',buildings_known:true,buildings:3,max_buildings:6,buildable:[]}]};
 const calls=[],r=await inspectConstruction({planetId:0,scope:constructionInspectionScope({topic:'construction',sections:['buildings','jobs','districts']}),rpc:async method=>{
  calls.push(method);return structuredClone({get_planet_details:planet,get_planet_jobs:jobs,get_buildable_buildings:buildings,
   get_buildable_districts:{success:true,planet_id:0,colony_id:0,current:[],buildable:[]}}[method]);
 }});
 assert.equal(r.allRequestedKnown,false);assert.equal(r.sections.jobs.known,false);assert.equal(r.sections.buildings.known,false);
 assert.equal(r.sections.jobs.data,undefined);assert.equal(r.sections.buildings.data,undefined);assert.equal(r.sections.districts.known,true);
 assert.equal(r.sections.jobs.evidence.reportedWorkforce,5941);assert.equal(r.sections.jobs.evidence.activeJobs,12);
 assert.equal(r.sections.buildings.evidence.availableSlots,3);assert.equal(r.sections.buildings.nextCheck.readOnly,true);
 assert.equal(r.sections.buildings.nextCheck.method,'get_buildable_buildings');
 assert.deepEqual(calls,['get_planet_details','get_buildable_buildings','get_planet_jobs','get_buildable_districts']);
 const unknown=withConstructionCoverage('jobs',jobs,planet),context=new OperationalContext({now:()=>100});
 context.record('jobs',{success:true,planet_id:0,total_workforce:20,strata:[{jobs:[{job_key:'coordinator',current_workforce:20,max_workforce:30}]}]},{gameDate:'2201.06.01'});
 assert.equal(context.view()[0].economy.employedWorkforce,20);
 context.record('jobs',unknown,{gameDate:'2201.06.01'});
 assert.equal(context.view()[0].economy,undefined);assert.match(context.view()[0].facts,/覆盖未知/);assert.doesNotMatch(context.view()[0].facts,/0\/0/);
 context.record('buildings',withConstructionCoverage('buildings',buildings,planet));assert.match(context.view()[0].facts,/覆盖未知/);
 assert.match(buildingCandidateProblem(withConstructionCoverage('buildings',buildings,planet),{slot_index:0,building_key:'building_hive_node',district_type:'district_hive'}),/覆盖|不能判定/);
 const partial={...jobs,strata:[{jobs:[{job_key:'one',current_workforce:100,max_workforce:200}]}]};
 assert.equal(constructionCandidateCoverage('jobs',partial,planet).known,false);
 const empty={...jobs,total_workforce:0};
 assert.equal(constructionCandidateCoverage('jobs',empty).known,false);
 assert.equal(constructionCandidateCoverage('jobs',empty,{workforce_summary:{active_jobs_count:0,total_employed_workforce:0}}).known,true);
 const full={...buildings,zones:buildings.zones.map(z=>({...z,buildings:6}))};
 assert.equal(constructionCandidateCoverage('buildings',full).known,true);
 const actual={...buildings,zones:buildings.zones.map(z=>({...z,buildable:[{key:'building_hive_node',cost:{minerals:400}}]}))};
 const coverage=withConstructionCoverage('buildings',actual,planet);
 assert.equal(coverage.coverageKnown,true);assert.deepEqual(coverage.zones[0].buildable,actual.zones[0].buildable);
 assert.equal(buildingCandidateProblem(coverage,{slot_index:0,building_key:'building_hive_node',district_type:'district_hive'}),null);
});
