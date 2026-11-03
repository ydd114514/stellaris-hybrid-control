import test from 'node:test';
import assert from 'node:assert/strict';
import {applyDomesticEdict} from '../src/strategy-contract.mjs';
import {strategyDecisionOptions} from '../src/strategy-decision-options.mjs';

const readback=(available_edicts,active_edicts=[])=>({summary:{active_edicts_count:active_edicts.length},active_edicts,available_edicts});

test('decision options expose legal ordinary edicts, checked agendas and unlocked gestalt steering',()=>{
 const state={empireType:'hive',council:{active_agenda:'agenda_display_of_power'}};
 const government={authority:'auth_hive_mind',ethics:[{key:'ethic_militarist'}],available_agendas:[
  {key:'agenda_display_of_power'},{key:'agenda_infinite_opportunities_gestalt'},{key:'agenda_infinite_opportunities'},
  {key:'agenda_progressive_growth'},{key:'agenda_not_verified'},
 ]};
 const edicts=readback([
  {key:'research_subsidies',can_activate:true},{key:'capacity_subsidies',can_activate:false},
  {key:'mining_subsidies',is_active:false},{key:'cfsteer_economy_research',can_activate:true},
  {key:'fortify_the_border',can_activate:true},{key:'nutritional_plenitude_hive',can_activate:true},
 ],[{key:'fortify_the_border',can_deactivate:true},{key:'nutritional_plenitude_hive',can_deactivate:false}]);
 const options=strategyDecisionOptions(state,{government,edicts});
 assert.deepEqual(options.edicts,{activatable:['research_subsidies'],deactivatable:['fortify_the_border'],status:'ok'});
 assert.deepEqual(options.agendas,{available:['agenda_infinite_opportunities_gestalt'],status:'ok'});
 assert.deepEqual(options.steering.economyFocus.choices,['balanced','unity_traditions','alloys_military','research']);
 assert.ok(options.allowed.includes('普通法令'));
 assert.ok(options.allowed.includes('内阁议程'));
 assert.equal(options.contractTemplate,undefined);
});

test('confirmed denial and legacy edict capability gap never send a toggle',async()=>{
 const action={type:'toggle_edict',arguments:{edict_key:'research_subsidies',enabled:true}};
 for(const [legality,status,error] of [
  [{can_activate:false},'无合法候选',/当前原生状态不允许/],
  [{is_active:false},'能力缺口',/法令启用能力缺口.*未确认.*可启用/],
 ]){
  const edicts=readback([{key:'research_subsidies',...legality}]);
  assert.deepEqual(strategyDecisionOptions({},{edicts}).edicts,{activatable:[],status});
  const receipt={};
  const calls=[];
  await assert.rejects(applyDomesticEdict({action,receipt,policyState:{userEconomicPolicy:{edictPolicy:'unity_net_gain'}},
   rpc:async method=>{calls.push(method);return edicts;},write:async()=>assert.fail('unexpected write')}),error);
  assert.deepEqual(calls,['get_edicts']);
  assert.equal(receipt.status,'rejected');
 }
});
