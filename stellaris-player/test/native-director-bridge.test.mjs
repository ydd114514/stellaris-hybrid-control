import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeCountryAI,COUNTRY_AI_P1_BRIDGE_VERSION,COUNTRY_AI_PREVIOUS_BRIDGE_VERSION,COUNTRY_AI_P1_FEATURES,DIRECTOR_BRIDGE_FEATURES} from '../src/native-country-ai.mjs';
import {assertBridgeCapabilities} from '../src/bridge-capabilities.mjs';

const base=['building_upgrade_candidates','building_upgrade_queue_identity','ship_design_naval_size','zone_building_membership','owned_shipyard_queues','engine_market_transaction_quotes','normal_war_actions','country_ai_full_with_reserved',...COUNTRY_AI_P1_FEATURES];
function controlFor(ping){
 const calls=[];
 const control=new NativeCountryAI({rpc:async method=>{calls.push(method);assert.equal(method,'ping');return ping;},assertBinding:async()=>{},setDispatchFence:()=>{}});
 return {control,calls};
}
test('director upgrade accepts the already loaded owner-intent bridge without claiming new views',async()=>{
 const ping={bridge_version:COUNTRY_AI_PREVIOUS_BRIDGE_VERSION,features:base};
 assert.equal(assertBridgeCapabilities(ping,{nativeCountryAI:true}),true);
 const {control,calls}=controlFor(ping);await control.capabilities();
 assert.equal(control.view().ownerIntentSupported,true);
 assert.equal(control.view().directorObjectViewsSupported,false);
 assert.equal(control.view().directorStarbaseTargetsSupported,false);
 assert.deepEqual(calls,['ping']);
});
test('new director bridge keeps owner-intent safeguards and advertises verified object views',async()=>{
 const ping={bridge_version:COUNTRY_AI_P1_BRIDGE_VERSION,features:[...base,...DIRECTOR_BRIDGE_FEATURES]};
 assert.equal(assertBridgeCapabilities(ping,{nativeCountryAI:true}),true);
 const {control,calls}=controlFor(ping);await control.capabilities();
 assert.equal(control.view().ownerIntentSupported,true);
 assert.equal(control.view().directorObjectViewsSupported,true);
 assert.equal(control.view().directorStarbaseTargetsSupported,true);
 assert.deepEqual(calls,['ping']);
});
test('director upgrade does not permit missing native guards or unknown versions',async()=>{
 const valid={bridge_version:COUNTRY_AI_P1_BRIDGE_VERSION,features:[...base,...DIRECTOR_BRIDGE_FEATURES]};
 for(const feature of ['country_ai_owner_intent','country_ai_full_with_reserved']){
  const ping={...valid,features:valid.features.filter(name=>name!==feature)};
  assert.throws(()=>assertBridgeCapabilities(ping,{nativeCountryAI:true}));
  const {control,calls}=controlFor(ping);await assert.rejects(control.capabilities());assert.deepEqual(calls,['ping']);
 }
 for(const version of ['cyberfish-0.6.24-unknown','cyberfish-0.6.27-unknown'])assert.throws(()=>assertBridgeCapabilities({...valid,bridge_version:version},{nativeCountryAI:true}));
});
test('a missing presentation extension degrades the view without disabling native AI',async()=>{
 const ping={bridge_version:COUNTRY_AI_P1_BRIDGE_VERSION,features:base};
 assert.equal(assertBridgeCapabilities(ping,{nativeCountryAI:true}),true);
 const {control}=controlFor(ping);await control.capabilities();
 assert.equal(control.view().directorObjectViewsSupported,false);
 assert.equal(control.view().directorStarbaseTargetsSupported,false);
});
