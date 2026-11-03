import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeBridgePath,compatibleLoadedBridgePaths} from '../src/native-bootstrap.mjs';
import {COUNTRY_AI_P1_BRIDGE_VERSION} from '../src/native-country-ai.mjs';
import {BRIDGE_VERSION,SURVEY_BRIDGE_VERSION,MONTHLY_BRIDGE_VERSION,MONTHLY_QUOTE_BRIDGE_VERSION,UPGRADE_PATH_BRIDGE_VERSION,TRADE_BUDGET_BRIDGE_VERSION,CLAIM_BUDGET_BRIDGE_VERSION} from '../src/bridge-capabilities.mjs';
test('startup selects the exact bridge for the selected mode',()=>{
 assert.ok(nativeBridgePath().includes(CLAIM_BUDGET_BRIDGE_VERSION));
 assert.ok(nativeBridgePath({tradeBudget:false}).includes(UPGRADE_PATH_BRIDGE_VERSION));
 assert.ok(nativeBridgePath({tradeBudget:true}).includes(CLAIM_BUDGET_BRIDGE_VERSION));
 assert.deepEqual(compatibleLoadedBridgePaths({monthlyTrade:false,tradeBudget:true}),[]);
 assert.ok(nativeBridgePath({hybridSurvey:true}).includes(CLAIM_BUDGET_BRIDGE_VERSION));
 assert.ok(nativeBridgePath({hybridSurvey:false}).includes(CLAIM_BUDGET_BRIDGE_VERSION));
 assert.ok(nativeBridgePath({monthlyTrade:false}).includes(BRIDGE_VERSION));
 assert.ok(nativeBridgePath({monthlyTrade:false,hybridSurvey:true}).includes(SURVEY_BRIDGE_VERSION));
 assert.ok(nativeBridgePath({monthlyTrade:true,monthlyQuotes:false}).includes(MONTHLY_BRIDGE_VERSION));
 assert.deepEqual(compatibleLoadedBridgePaths({monthlyTrade:true}),[]);
 assert.deepEqual(compatibleLoadedBridgePaths({hybridSurvey:true}),[]);
 assert.deepEqual(compatibleLoadedBridgePaths(),[]);
 assert.deepEqual(compatibleLoadedBridgePaths({monthlyTrade:false}),[nativeBridgePath({claimBudget:true}),nativeBridgePath({tradeBudget:true,claimBudget:false}),nativeBridgePath({upgradePaths:true,tradeBudget:false}),nativeBridgePath({monthlyQuotes:true,upgradePaths:false}),nativeBridgePath({monthlyTrade:true,monthlyQuotes:false}),nativeBridgePath({monthlyTrade:false,hybridSurvey:true})]);
 assert.equal(compatibleLoadedBridgePaths({monthlyTrade:false,hybridSurvey:true}).length,5);
 assert.ok(nativeBridgePath({monthlyQuotes:true,upgradePaths:false}).includes(MONTHLY_QUOTE_BRIDGE_VERSION));
 assert.deepEqual(compatibleLoadedBridgePaths({monthlyTrade:false,monthlyQuotes:true}),[]);
 assert.ok(nativeBridgePath({upgradePaths:true}).includes(CLAIM_BUDGET_BRIDGE_VERSION));
 assert.deepEqual(compatibleLoadedBridgePaths({monthlyTrade:false,monthlyQuotes:false,upgradePaths:true}),[]);
});

test('the prior dynamic-trade bridge remains selectable explicitly for rollback',()=>{assert.ok(nativeBridgePath({claimBudget:false}).includes(TRADE_BUDGET_BRIDGE_VERSION));});

test('country AI selects the edict approval bridge without accepting a loaded bypass version',()=>{
 assert.ok(nativeBridgePath({nativeCountryAI:true}).includes(COUNTRY_AI_P1_BRIDGE_VERSION));
 assert.deepEqual(compatibleLoadedBridgePaths({nativeCountryAI:true}),[]);
});
