import test from 'node:test';
import assert from 'node:assert/strict';
import {needsPlanetJobsSupplement,supplementPlanetJobs} from '../src/planet-jobs-readback.mjs';
import {constructionCandidateCoverage} from '../src/construction-coverage.mjs';
import {OperationalContext} from '../src/operational-context.mjs';
import {NativeGame} from '../src/native-game.mjs';

const binding={pid:37524,creationTime:'134380697754660160'},worldScope={country_address:123456,country_id:0,world_generation:1};
const data={success:true,planet_id:3,colony_id:0,total_workforce:6000,strata:[],coverageKnown:false};
const row={job_id:0x1000002,job_key:'coordinator',current_workforce:100,max_workforce:400,bonus_workforce:0,workforce_limit:0,
 raw_workforce:'10000000',raw_max_workforce:'40000000',raw_bonus_workforce:'0',raw_workforce_limit:'0'};
const read=()=>({ok:true,...binding,planetJobs:{known:true,readOnly:true,planetId:3,colonyId:0,countryId:0,ownershipRelationshipVerified:true,
 coverageComplete:true,stableRead:true,jobCount:1,flat_jobs:[{...row}]}});
const fixture=()=>({data:{...data},planetId:3,binding:{...binding},worldScope:{...worldScope},ownedColonies:[{planet_id:3,colony_id:0}],
 assertScope:async()=>({binding:{...binding},worldScope:{...worldScope}}),processReader:async()=>read(),now:()=>1000});

test('gestalt empty enumeration gets explicit flat coverage, preserves full IDs and zero limits, and supplies coordinator facts',async()=>{
 const input=fixture(),requests=[];let checks=0;
 input.processReader=async request=>{requests.push(request);return read();};input.assertScope=async()=>{checks++;return {binding:{...binding},worldScope:{...worldScope}};};
 const result=await supplementPlanetJobs(input);
 assert.equal(checks,2);assert.deepEqual(requests,[{op:'planet_jobs',...binding,countryId:0,planetId:3,colonyId:0}]);
 assert.equal(result.coverageKnown,true);assert.deepEqual(result.strata,[]);assert.equal(result.flat_jobs[0].job_id,0x1000002);
 assert.equal(result.flat_jobs[0].workforce_limit,0);assert.equal(result.flat_jobs[0].raw_workforce_limit,'0');
 assert.equal(result.native_total_workforce,6000);assert.equal(result.total_workforce,100);
 assert.equal(constructionCandidateCoverage('jobs',result).known,true);
 const context=new OperationalContext({now:()=>1000});context.record('jobs',result,{gameDate:'2209.09.01'});
 assert.match(context.view()[0].facts,/coordinator 100\/400/);assert.match(context.view()[0].facts,/限额读数0/);
 assert.equal(context.view()[0].economy.capacityWorkforce,400);
});

test('wrong process, world changes, foreign colony, incomplete enumeration and changing memory return unknown without partial rows',async()=>{
 const mutations=[
  input=>{input.ownedColonies=[{planet_id:3,colony_id:1}];},
  input=>{input.worldScope=undefined;},
  input=>{let n=0;input.assertScope=async()=>({binding:{...binding},worldScope:{...worldScope,world_generation:++n===1?1:2}});},
  input=>{input.processReader=async()=>({...read(),creationTime:'other'});},
  input=>{input.processReader=async()=>{const value=read();value.planetJobs.countryId=1;return value;};},
  input=>{input.processReader=async()=>{const value=read();value.planetJobs.stableRead=false;value.planetJobs.error='planet_jobs_changed_during_read';return value;};},
  input=>{input.processReader=async()=>{const value=read();value.planetJobs.jobCount=2;return value;};},
  input=>{input.processReader=async()=>{const value=read();value.planetJobs.flat_jobs[0].raw_workforce_limit=0;return value;};}
 ];
 for(const mutate of mutations){const input=fixture();mutate(input);const result=await supplementPlanetJobs(input);assert.equal(result.coverageKnown,false);assert.deepEqual(result.flat_jobs,[]);}
 const input=fixture();input.processReader=async()=>{const value=read();value.planetJobs.flat_jobs[0].workforce_limit=null;value.planetJobs.flat_jobs[0].raw_workforce_limit='9223372036854775807';return value;};
 const sentinel=await supplementPlanetJobs(input);assert.equal(sentinel.coverageKnown,true);assert.equal(sentinel.flat_jobs[0].workforce_limit,null);
 assert.equal(sentinel.flat_jobs[0].raw_workforce_limit,'9223372036854775807');
});

test('fallback is limited to a structurally successful empty enumeration with actual workforce evidence',()=>{
 assert.equal(needsPlanetJobsSupplement(data),true);
 assert.equal(needsPlanetJobsSupplement({...data,total_workforce:0},{workforce_summary:{total_employed_workforce:100}}),true);
 for(const value of [{...data,success:false},{...data,strata:[{jobs:[]}]},{...data,total_workforce:0},{...data,total_workforce:undefined}])assert.equal(needsPlanetJobsSupplement(value),false);
});

test('NativeGame inspect jobs wires the read-only bound fallback and rechecks the world around its process reader',async()=>{
 const context=new OperationalContext({now:()=>1000}),calls=[];let scopeChecks=0;
 const game=Object.assign(Object.create(NativeGame.prototype),{nativeCountryAIEnabled:true,binding:{...binding},boundNativeWorld:{...worldScope},now:()=>1000,
 lastState:{date:'2209.09.01',player:{country_id:0},colonies:[{colonies_summary:[{planet_id:3,colony_id:0}]}]},
 guard:async()=>({}),assertNativeWorld:async()=>{scopeChecks++;},processReader:async request=>{assert.equal(request.op,'planet_jobs');return read();},
 rpc:async method=>{calls.push(method);assert.equal(method,'get_planet_jobs');return {...data};},operationalContext:context,log:async()=>{}});
 const result=await game.inspect({topic:'jobs',id:3});
 assert.equal(result.coverageKnown,true);assert.equal(scopeChecks,2);assert.deepEqual(calls,['get_planet_jobs']);
 assert.match(context.view()[0].facts,/coordinator 100\/400/);
});
