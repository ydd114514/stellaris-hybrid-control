import test from 'node:test';
import assert from 'node:assert/strict';
import {controllerRoundComplete,countryAIHandoffUnconfirmed} from '../src/controller-round.mjs';
const fixture=()=>({stopped:true,metrics:{orders:0},state:{countryAIControl:{enabled:true,owner:'human',ordinaryOrdersBlocked:false}},
 cleanup:{bindingConfirmed:true,pauseConfirmed:true,countryAI:{confirmed:true,owner:'human',ordinaryOrdersBlocked:false,
 paused:true,actualFlags:{human_ai:false,force_human_ai:false},nativePhase:'stopped'}}});
test('a clean native session needs no manual orders and does not claim autonomous work',()=>{
 const cp=fixture();assert.equal(controllerRoundComplete(cp,{nativeCountryAI:true}),true);
 assert.equal(cp.state.countryAIControl.autonomousWorkVerified,undefined);
 assert.equal(controllerRoundComplete(cp),false);
});
test('unconfirmed or contradictory native handoff cannot restart the next round',()=>{
 for(const change of [cp=>cp.cleanup.countryAI.confirmed=false,cp=>cp.cleanup.countryAI.actualFlags.human_ai=true,
  cp=>cp.cleanup.countryAI.actualFlags.force_human_ai=true,cp=>cp.cleanup.countryAI.nativePhase='running',
  cp=>cp.cleanup.countryAI.ordinaryOrdersBlocked=true,cp=>cp.cleanup.pauseConfirmed=false,
  cp=>delete cp.cleanup.countryAI,cp=>cp.state.countryAIControl.owner='unconfirmed',cp=>cp.stopped=false]){
  const cp=fixture();change(cp);assert.equal(controllerRoundComplete(cp,{nativeCountryAI:true}),false);
 }
 const cp=fixture();cp.cleanup.countryAI.confirmed=false;assert.equal(countryAIHandoffUnconfirmed(cp),true);
});
test('legacy round behavior is preserved',()=>{
 assert.equal(controllerRoundComplete({metrics:{orders:1}}),true);
 assert.equal(controllerRoundComplete(null),false);
});
