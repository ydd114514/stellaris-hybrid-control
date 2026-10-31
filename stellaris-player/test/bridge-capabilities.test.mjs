import test from 'node:test';
import assert from 'node:assert/strict';
import {assertBridgeCapabilities,BRIDGE_VERSION,SURVEY_BRIDGE_VERSION,UPGRADE_PATH_BRIDGE_VERSION,TRADE_BUDGET_BRIDGE_VERSION,CLAIM_BUDGET_BRIDGE_VERSION} from '../src/bridge-capabilities.mjs';
import {COUNTRY_AI_P1_BRIDGE_VERSION,COUNTRY_AI_P1_FEATURES} from '../src/native-country-ai.mjs';
import {COUNTRY_AI_ECONOMY_CANDIDATE_VERSION,COUNTRY_AI_ECONOMY_FEATURES} from '../src/native-country-ai-economic-policy.mjs';
test('bridge version and required features must match before the controller continues',()=>{
 const ping={bridge_version:BRIDGE_VERSION,features:['building_upgrade_candidates','building_upgrade_queue_identity','ship_design_naval_size','zone_building_membership','owned_shipyard_queues','engine_market_transaction_quotes','normal_war_actions']};
 assert.equal(assertBridgeCapabilities(ping),true);
 assert.throws(()=>assertBridgeCapabilities(ping,{hybridSurvey:true}),/功能不匹配/);
 const survey={...ping,bridge_version:SURVEY_BRIDGE_VERSION,features:[...ping.features,'native_survey_automation_candidate']};
 assert.equal(assertBridgeCapabilities(survey,{hybridSurvey:true}),true);
 assert.throws(()=>assertBridgeCapabilities({...survey,features:{}}),/功能不匹配/);
 for(const value of [undefined,{status:'pong'},{...ping,bridge_version:'old'},{...ping,features:ping.features.slice(1)}])assert.throws(()=>assertBridgeCapabilities(value),/功能不匹配/);
});

test('upgrade pilot requires the corrected parser layout and rejects feature downgrade',()=>{
 const features=['building_upgrade_candidates','building_upgrade_queue_identity','ship_design_naval_size','zone_building_membership','owned_shipyard_queues','engine_market_transaction_quotes','normal_war_actions','native_survey_automation_candidate','monthly_trade_read_coverage_candidate','engine_monthly_trade_quotes','building_upgrade_string_paths'];
 const ping={bridge_version:UPGRADE_PATH_BRIDGE_VERSION,features};
 assert.equal(assertBridgeCapabilities(ping,{upgradePaths:true,hybridSurvey:true}),true);
 assert.throws(()=>assertBridgeCapabilities({...ping,bridge_version:BRIDGE_VERSION},{upgradePaths:true}),/升级需要/);
 assert.throws(()=>assertBridgeCapabilities({...ping,features:features.filter(f=>f!=='building_upgrade_string_paths')}),/升级需要/);
 assert.throws(()=>assertBridgeCapabilities({...ping,features:features.filter(f=>f!=='engine_monthly_trade_quotes')}),/月度报价桥/);
 assert.throws(()=>assertBridgeCapabilities({...ping,features:{}}),/月度报价桥/);
 const budget={bridge_version:TRADE_BUDGET_BRIDGE_VERSION,features:[...features,'actual_market_upkeep_budget']};
 assert.equal(assertBridgeCapabilities(budget,{upgradePaths:true,tradeBudget:true,hybridSurvey:true}),true);
 assert.throws(()=>assertBridgeCapabilities({...budget,features}),/动态交易预算/);
 assert.throws(()=>assertBridgeCapabilities(ping,{tradeBudget:true}),/动态交易预算/);
});

test('claim bridge requires exact quotes and native capped spending without dropping old productive features',()=>{
 const features=['building_upgrade_candidates','building_upgrade_queue_identity','ship_design_naval_size','zone_building_membership','owned_shipyard_queues','engine_market_transaction_quotes','normal_war_actions','native_survey_automation_candidate','monthly_trade_read_coverage_candidate','engine_monthly_trade_quotes','building_upgrade_string_paths','actual_market_upkeep_budget','engine_claim_cost_quotes','capped_claim_spending'];
 const ping={bridge_version:CLAIM_BUDGET_BRIDGE_VERSION,features};assert.equal(assertBridgeCapabilities(ping,{claimBudget:true,tradeBudget:true,upgradePaths:true,hybridSurvey:true}),true);
 for(const name of ['engine_claim_cost_quotes','capped_claim_spending'])assert.throws(()=>assertBridgeCapabilities({...ping,features:features.filter(f=>f!==name)}),/宣称执行/);
});
test('controller economy mode cannot downgrade to r2 or advertise missing native constraints',()=>{
 const base=['building_upgrade_candidates','building_upgrade_queue_identity','ship_design_naval_size','zone_building_membership','owned_shipyard_queues','engine_market_transaction_quotes','normal_war_actions',...COUNTRY_AI_P1_FEATURES];
 const stable={bridge_version:COUNTRY_AI_P1_BRIDGE_VERSION,features:base};
 const candidate={bridge_version:COUNTRY_AI_ECONOMY_CANDIDATE_VERSION,features:[...base,...COUNTRY_AI_ECONOMY_FEATURES]};
 const options={nativeCountryAI:true,nativeCountryAIEconomyCandidate:true};
 assert.equal(assertBridgeCapabilities(stable,{nativeCountryAI:true}),true);
 assert.equal(assertBridgeCapabilities(candidate,options),true);
 assert.throws(()=>assertBridgeCapabilities(stable,options),/旧桥不允许/);
 assert.throws(()=>assertBridgeCapabilities(candidate,{nativeCountryAI:true}),/旧桥不允许/);
 for(const f of COUNTRY_AI_ECONOMY_FEATURES)assert.throws(()=>assertBridgeCapabilities({...candidate,features:candidate.features.filter(k=>k!==f)},options));
});
