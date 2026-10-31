import test from 'node:test';import assert from 'node:assert/strict';
import {assessCountryAIModelLinkage,countryAIModelAcceptanceReady} from '../src/country-ai-model-evidence.mjs';
const at=n=>new Date(n*1000).toISOString();
function fixture(){
 const delegate=n=>({at:at(n),type:'country_ai_delegate_confirmed',view:{owner:'native',ordinaryOrdersBlocked:true}});
 return {checkpoint:{state:{research:{physics:{current:{key:'tech_shields_4'}}}}},events:[delegate(1),
  {at:at(2),type:'country_ai_takeover_confirmed',state:{phase:'stopped',last_native_state:{paused:true,global_flags:{human_ai:false,force_human_ai:false}},observation:{commands_drained:true}}},
  {at:at(3),type:'intent',requestId:'key',strategicResearchOverride:true,orders:[{command:'select_research',arguments:{slot:'physics',tech_key:'tech_shields_4'}}]},
  {at:at(4),type:'receipt',requestId:'key',command:'select_research',response:{success:true},verification:{verified:true,technology:{key:'tech_shields_4'}}},delegate(5)]};
}
test('evidence completion requires confirmed takeover, a real model change, retention and return',()=>{
 const f=fixture(),r=assessCountryAIModelLinkage(f.checkpoint,f.events);assert.equal(r.linkageVerified,true);assert.equal(r.resumedAt,5000);
 for(const index of [0,1,2,3,4]){const g=fixture();g.events.splice(index,1);assert.equal(assessCountryAIModelLinkage(g.checkpoint,g.events).linkageVerified,false);}
});
test('a lost key, wrong result or ordinary work during native ownership cannot end acceptance early',()=>{
 const f=fixture();f.checkpoint.state.research.physics.current.key='tech_other';assert.equal(assessCountryAIModelLinkage(f.checkpoint,f.events).linkageVerified,false);
 const g=fixture();g.events[3].verification.technology.key='tech_other';assert.equal(assessCountryAIModelLinkage(g.checkpoint,g.events).linkageVerified,false);
 const h=fixture();h.events.push({type:'rpc_write',category:'work'});assert.equal(assessCountryAIModelLinkage(h.checkpoint,h.events).linkageVerified,false);
});
test('early completion needs a fresh post-return key readback while native ownership is still confirmed',()=>{
 const f=fixture();f.checkpoint.countryAIControl={owner:'native',nativePhase:'running',ordinaryOrdersBlocked:true,paused:false,actualFlags:{human_ai:true,force_human_ai:true}};
 f.checkpoint.observedAt=6000;assert.equal(countryAIModelAcceptanceReady(f.checkpoint,f.events,9000),false);
 f.checkpoint.observedAt=8000;assert.equal(countryAIModelAcceptanceReady(f.checkpoint,f.events,9000),true);
 f.checkpoint.countryAIControl.actualFlags.human_ai=false;assert.equal(countryAIModelAcceptanceReady(f.checkpoint,f.events,9000),false);
});
