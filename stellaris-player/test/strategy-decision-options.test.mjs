import test from 'node:test';
import assert from 'node:assert/strict';
import {applyDomesticEdict} from '../src/strategy-contract.mjs';
import {strategyDecisionOptions} from '../src/strategy-decision-options.mjs';

const readback=(available_edicts,active_edicts=[])=>({summary:{active_edicts_count:active_edicts.length},active_edicts,available_edicts});

test('decision options expose legal ordinary edicts, checked agendas and unlocked gestalt steering',()=>{
 const state={date:'2300.01.01',empireType:'hive',council:{active_agenda:'agenda_display_of_power'},
  resources:{unity:{net:12,net_known:true},physics_research:{net:-1,stockpile:1}}};
 const government={authority:'auth_hive_mind',ethics:[{key:'ethic_militarist'}],available_agendas:[
  {key:'agenda_display_of_power'},{key:'agenda_infinite_opportunities_gestalt'},{key:'agenda_infinite_opportunities'},
  {key:'agenda_progressive_growth'},{key:'agenda_not_verified'},
 ]};
 const edicts=readback([
  {key:'research_subsidies',can_activate:true,upkeep_known:true,upkeep:{unity:2}},{key:'capacity_subsidies',can_activate:false},
  {key:'mining_subsidies',is_active:false},{key:'cfsteer_economy_research',can_activate:true},
  {key:'fortify_the_border',can_activate:true},{key:'nutritional_plenitude_hive',can_activate:true},
 ],[{key:'fortify_the_border',can_deactivate:true},{key:'nutritional_plenitude_hive',can_deactivate:false}]);
 const options=strategyDecisionOptions(state,{government,edicts});
 assert.deepEqual(options.edicts,{activatable:['research_subsidies'],active:['fortify_the_border','nutritional_plenitude_hive'],deactivatable:['fortify_the_border'],status:'ok'});
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
  assert.deepEqual(strategyDecisionOptions({date:'2300.01.01'},{edicts}).edicts,{activatable:[],status});
  const receipt={};
  const calls=[];
  await assert.rejects(applyDomesticEdict({action,receipt,policyState:{userEconomicPolicy:{edictPolicy:'unity_net_gain'}},
   rpc:async method=>{calls.push(method);return edicts;},write:async()=>assert.fail('unexpected write')}),error);
  assert.deepEqual(calls,['get_edicts']);
  assert.equal(receipt.status,'rejected');
 }
});

test('edict options freeze new activation in early or unknown stages while preserving removal choices',()=>{
 const edicts=readback([
  {key:'mining_subsidies',can_activate:true,upkeep_known:true,upkeep:{unity:5}},
  {key:'capacity_subsidies',can_activate:true},
 ],[{key:'fleet_supremacy',can_deactivate:true}]);
 const resources={unity:{net:10,net_known:true},minerals:{net:-1,stockpile:30}};
 for(const [date,message] of [['2299.12.30',/前期凝聚力优先/], [undefined,/当前游戏日期未知/]]){
  const {edicts:options}=strategyDecisionOptions({date,resources},{edicts});
  assert.deepEqual(options.activatable,[]);
  assert.deepEqual(options.deactivatable,['fleet_supremacy']);
  assert.match(options.activationBlock,message);
 }
 const {edicts:options}=strategyDecisionOptions({date:'2300.01.01',resources},{edicts});
 assert.deepEqual(options.activatable,['mining_subsidies']);
 const unknown=readback([{key:'mining_subsidies',can_activate:true}]);
 const {edicts:gap}=strategyDecisionOptions({date:'2300.01.01',resources},{edicts:unknown});
 assert.equal(gap.status,'能力缺口');
 assert.match(gap.activationBlock,/维护费或净产未核实/);
});
