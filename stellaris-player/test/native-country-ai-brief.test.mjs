import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeCountryAIBrief} from '../src/native-country-ai-brief.mjs';
test('strategy brief sends operating work to the real country AI with explicit takeover and return',()=>{
 const brief=nativeCountryAIBrief(5);
 for(const text of ['full_with_reserved','takeover','resume','continue','unity_traditions','operatorStanding','脱险自动恢复','不因模型等待而暂停'])assert.ok(brief.includes(text),text);
 for(const n of [0,61,NaN,'5'])assert.throws(()=>nativeCountryAIBrief(n));
});

test('the opening brief orders read-only status and delegation before the first strategy contract',()=>{
 const opening=nativeCountryAIBrief(5).split('有pendingEvents')[0];
 assert.match(opening,/先observe，再调用country_ai_control status。status只读/);
 assert.match(opening,/country_ai_control delegate，回读owner=native后再提交strategy_contract/);
});

test('manual owner work is conditional on current-world authorization',()=>{
 const brief=nativeCountryAIBrief(10);
 assert.match(brief,/仅state\.userEconomicPolicy\.worldTaskAuthorized=true时/);
 assert.match(brief,/缺少授权时保持原生运营/);
 assert.doesNotMatch(brief,/本人已授权/);
 assert.match(brief,/比较突触节点的真实合法槽位/);
});

test('strategic review instructions prioritize current legal choices and bound additional reading',()=>{
 const brief=nativeCountryAIBrief(5);
 for(const text of ['decisionOptions.contractTemplate','最多追加inspect两个不同主题','无合法候选或能力缺口时跳过','附具体依据的continue','维持理由：'])
  assert.ok(brief.includes(text),text);
});
