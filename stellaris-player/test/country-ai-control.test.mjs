import test from 'node:test';
import assert from 'node:assert/strict';
import {CountryAIControl,COUNTRY_AI_BRIDGE_VERSION,COUNTRY_AI_FEATURE} from '../src/country-ai-control.mjs';

function fixture({receipts=true,failPost=false}={}) {
  let flags={normal_ai:true,human_ai:false,force_human_ai:true},sequence=0,pending=null;
  let world='same',bindings=true,paused=true,single=true;
  const writes=[],events=[];
  const state=()=>({success:true,paused,single_local_human_guard:single,country_coverage_complete:true,
    global_flags:{...flags},precondition:{world,country_id:0,global_flags:{...flags},sequence},pending});
  const ctl=new CountryAIControl({polls:2,wait:async()=>{},assertBinding:async()=>{if(!bindings)throw Error('binding changed');},record:async e=>events.push(e),
    rpc:async(method,p)=>{
      if(method==='ping')return {bridge_version:COUNTRY_AI_BRIDGE_VERSION,features:[COUNTRY_AI_FEATURE]};
      if(method==='get_country_ai_state')return structuredClone(state());
      writes.push(structuredClone(p));
      if(failPost){failPost=false;throw Error('pipe timeout');}
      if(pending?.phase!=='readback_confirmed'&&pending&&!p.restore_previous)return {success:false,error:'pending'};
      flags={...flags,human_ai:p.human_ai,force_human_ai:p.force_human_ai};
      pending={sequence:++sequence,phase:receipts?'readback_confirmed':'posted_unconfirmed',execute_receipts:receipts?3:0,identity_matches:true};
      return {success:true,phase:'posted_unconfirmed',pending:structuredClone(pending)};
    }});
  return {ctl,writes,events,change:o=>{if('world'in o)world=o.world;if('bindings'in o)bindings=o.bindings;if('paused'in o)paused=o.paused;if('single'in o)single=o.single;},state};
}
test('enable then restore BOTH original flags; country zero remains valid',async()=>{
 const f=fixture();assert.equal((await f.ctl.setPausedResearchFlags({human_ai:true,force_human_ai:true})).phase,'paused_confirmed');
 assert.equal((await f.ctl.restorePausedResearchFlags()).phase,'restored');
 assert.deepEqual(f.state().global_flags,{normal_ai:true,human_ai:false,force_human_ai:true});assert.equal(f.writes.length,2);
});
test('matching booleans without execution receipts do not confirm; explicit restoration is distinct',async()=>{
 const f=fixture({receipts:false});assert.equal((await f.ctl.setPausedResearchFlags({human_ai:true,force_human_ai:true})).phase,'unconfirmed');
 assert.equal(f.writes.length,1);await f.ctl.restorePausedResearchFlags();assert.equal(f.writes.length,2);assert.equal(f.writes[1].restore_previous,true);
});
test('ambiguous post never retries enable and retains restoration intent',async()=>{
 const f=fixture({failPost:true});await assert.rejects(f.ctl.setPausedResearchFlags({human_ai:true,force_human_ai:true}),/timeout/);
 assert.equal(f.writes.length,1);assert.ok(f.ctl.original);assert.equal(f.ctl.phase,'unconfirmed');
 await f.ctl.restorePausedResearchFlags();assert.equal(f.writes.length,2);
});
test('changed world prevents restoring old settings',async()=>{
 const f=fixture();await f.ctl.setPausedResearchFlags({human_ai:true,force_human_ai:true});f.change({world:'new'});
 await assert.rejects(f.ctl.restorePausedResearchFlags(),/已改变/);assert.equal(f.writes.length,1);
});
test('scope ambiguity and unpaused worlds refuse the first post',async()=>{
 for(const change of [{single:false},{paused:false},{bindings:false}]){
  const f=fixture();f.change(change);await assert.rejects(f.ctl.setPausedResearchFlags({human_ai:true,force_human_ai:true}));assert.equal(f.writes.length,0);
 }
});
test('new delegation cannot overwrite an unrestored baseline; production stays disabled',async()=>{
 const f=fixture();await f.ctl.setPausedResearchFlags({human_ai:true,force_human_ai:true});
 await assert.rejects(f.ctl.setPausedResearchFlags({human_ai:false,force_human_ai:false}),/先恢复/);assert.equal(f.writes.length,1);
 assert.throws(()=>f.ctl.delegate(),/尚未验收/);
});
test('reject legacy bridges before any country-state RPC or write',async()=>{
 const calls=[];const c=new CountryAIControl({assertBinding:async()=>{},rpc:async m=>{calls.push(m);return {bridge_version:'old',features:[]};}});
 await assert.rejects(c.status(),/当前桥/);assert.deepEqual(calls,['ping']);
});
