import test from 'node:test';import assert from 'node:assert/strict';import {manualSurveyRoute,validateManualSurveyReason} from '../src/survey-routing-policy.mjs';
const status={resources:Object.fromEntries(['energy','alloys','food','trade','unity'].map(k=>[k,{stockpile:1000,net:10}]))};
function setup({current,targets,reachable=true,status:actual=status}={}){
 const calls=[],rpc=async(method,p)=>{calls.push({method,p});
  if(method==='get_fleet_automation')return current??{fleet_id:0,known:true,automation_enabled:false,order_chain_complete:true,orders:[]};
  if(method==='find_systems')return {systems:targets??[{id:1,intel:3}]};
  if(method==='find_path')return {fleet_id:0,from_system_id:0,to_system_id:p.to_system_id,reachable,systems:reachable?[0,p.to_system_id]:[]};
  throw Error('Unexpected method '+method);
 };return {calls,input:{fleetId:0,referenceSystemId:0,status:actual,rpc}};
}
test('eligible idle survey produces an actionable delegate alternative without any write',async()=>{
 const {calls,input}=setup(),r=await manualSurveyRoute(input);assert.equal(r.decision,'delegate');assert.equal(r.candidateSystemId,1);assert.equal(r.nextCall.arguments.fleetId,0);assert.equal(r.nextCall.arguments.operation,'delegate');assert.equal(r.nextCall.needsSnapshotId,true);
 assert.ok(calls.every(c=>c.method.startsWith('get_')||c.method.startsWith('find_')));
});
test('unexplored, unreachable or reserve-unknown candidates keep normal manual fallback',async()=>{
 const failedRead=structuredClone(status);failedRead.resources.energy.net_known=false;
 for(const options of [{targets:[{id:1,intel:0}]},{reachable:false},{status:{resources:{}}},{status:failedRead}]){const {input}=setup(options);const r=await manualSurveyRoute(input);assert.equal(r.decision,'manual');assert.equal(r.nativeDelegationAvailable,false);}
});
test('a strategic manual reason skips preference but never bypasses actual unknown or native ownership',async()=>{
 const {calls,input}=setup();assert.equal((await manualSurveyRoute({...input,manualSurveyReason:'先精确调查当前殖民目标'})).decision,'manual');assert.equal(calls.length,1);
 for(const current of [{fleet_id:0,known:false},{fleet_id:1,known:true,automation_enabled:false,order_chain_complete:true,orders:[]},{fleet_id:0,known:true,automation_enabled:true,order_chain_complete:true,orders:[]}]){
  const {input}=setup({current});assert.notEqual((await manualSurveyRoute({...input,manualSurveyReason:'明确目标'})).decision,'manual');
 }
 for(const value of ['',false,' '.repeat(3),'a'.repeat(301)])assert.throws(()=>validateManualSurveyReason(value));
});
test('ongoing manual work is not interrupted for an automation preference',async()=>{
 const {calls,input}=setup({current:{fleet_id:0,known:true,automation_enabled:false,order_chain_complete:true,orders:[{automation:false}]}});
 assert.equal((await manualSurveyRoute(input)).decision,'wait');assert.equal(calls.length,1);
 assert.equal((await manualSurveyRoute({...input,manualSurveyReason:'战略路线改变'})).decision,'manual');
});
