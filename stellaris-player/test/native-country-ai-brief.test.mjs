import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeCountryAIBrief} from '../src/native-country-ai-brief.mjs';
test('strategy brief sends operating work to the real country AI with explicit takeover and return',()=>{
 const brief=nativeCountryAIBrief(5);
 for(const text of ['full_with_reserved','takeover','resume','continue','unity_traditions','operatorStanding','脱险自动恢复','不因模型等待而暂停'])assert.ok(brief.includes(text),text);
 for(const n of [0,61,NaN,'5'])assert.throws(()=>nativeCountryAIBrief(n));
});

test('strategic review instructions prioritize current legal choices and bound additional reading',()=>{
 const brief=nativeCountryAIBrief(5);
 for(const text of ['decisionOptions.contractTemplate','最多追加inspect两个不同主题','无合法候选或能力缺口时跳过','附具体依据的continue','维持理由：'])
  assert.ok(brief.includes(text),text);
});
