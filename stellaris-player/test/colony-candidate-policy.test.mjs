import test from 'node:test';import assert from 'node:assert/strict';
import {colonyReadCandidate,admitColonyCandidate,assertColonyCandidateRead,assertColonyPipeOwner} from '../src/colony-candidate-policy.mjs';
const fixture=()=>({candidate:{...colonyReadCandidate,path:'E:/candidate/stellaris_bridge.dll'},digest:colonyReadCandidate.sha256,identity:{ok:true,pid:12,creationTime:'123',bridgeModule:{known:true,loaded:false,path:null}}});
test('only an independently known unloaded bridge admits a cold candidate load',()=>{const f=fixture();assert.equal(admitColonyCandidate(f).loadRequired,true);f.identity.bridgeModule={known:true,loaded:true,path:'e:/candidate/stellaris_bridge.dll'};assert.equal(admitColonyCandidate(f).loadRequired,false);});
test('old bridges, unknown enumeration, identity changes and wrong binary never admit a load',()=>{for(const mutate of [f=>f.identity.bridgeModule.path='E:/old/stellaris_bridge.dll',f=>f.identity.bridgeModule={known:true,loaded:true,path:'E:/old/stellaris_bridge.dll'},f=>delete f.identity.bridgeModule,f=>f.identity.bridgeModule.known=false,f=>f.digest='0'.repeat(64),f=>f.candidate.version='other',f=>f.expectedIdentity={pid:12,creationTime:'old'},f=>f.identity.ok=false]){const f=fixture();mutate(f);assert.throws(()=>admitColonyCandidate(f));}});
test('dedicated candidate connection cannot issue gameplay or presentation writes',()=>{for(const method of ['ping','get_status','get_colony_automation'])assert.doesNotThrow(()=>assertColonyCandidateRead(method));for(const method of ['set_paused','set_survey_automation','move_fleet','survey','show_panel','get_arbitrary'])assert.throws(()=>assertColonyCandidateRead(method));});

test('a valid bridge on another process cannot validate the selected game',()=>{
 const id={pid:12,creationTime:'123'};assert.doesNotThrow(()=>assertColonyPipeOwner({ok:true,...id},id));
 for(const owner of [{ok:true,pid:13,creationTime:'123'},{ok:true,pid:12,creationTime:'old'},{ok:false,...id},null])assert.throws(()=>assertColonyPipeOwner(owner,id));
});
