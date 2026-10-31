import test from 'node:test';import assert from 'node:assert/strict';
import {NativeGame} from '../src/native-game.mjs';
test('routine decisions pause without cancelling survey; unknown or mixed alerts still reclaim',async()=>{
 for(const [alerts,reclaim] of [
  [['alert_physics_research'],false],
  [['alert_society_research','alert_unlock_tradition','alert_available_council_agenda'],false],
  [['alert_council_agenda_ready_for_activation'],false],
  [['alert_engineering_research','alert_mia'],true],
  [['new_unrecognized_alert'],true]
 ]){
  const g=new NativeGame({hybridSurvey:true}),calls=[];
  g.guard=async()=>({is_paused:false,resources:Object.fromEntries(['energy','alloys','food','trade','unity'].map(k=>[k,{stockpile:1000,net:10}]))});
  g.lastState={wars:[],alerts:[]};g.log=async()=>{};g.checkpoint=async()=>{};
  g.surveyDelegation.view=()=>({records:{1:{fleetId:1,sessionId:g.sessionId,owner:'native'}}});
  g.surveyDelegation.monitor=async()=>({trusted:true,reasons:[]});g.surveyDelegation.cleanup=async()=>{calls.push('cleanup');};
  g.rpc=async(m,p)=>{calls.push(m);if(m==='get_active_events')return [];if(m==='get_wars')return {wars:[],warGoalsWindow:false};if(m==='get_alerts')return alerts.map(type=>({type}));return {success:true};};
  await g.monitorDecision();assert.equal(calls.includes('set_paused'),true);assert.equal(calls.includes('cleanup'),reclaim,alerts.join(','));assert.deepEqual(g.decisionPause.reasons,['new_alert']);
 }
});
