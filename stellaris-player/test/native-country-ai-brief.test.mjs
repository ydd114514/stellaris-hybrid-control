import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeCountryAIBrief} from '../src/native-country-ai-brief.mjs';
test('strategy brief sends operating work to the real country AI with explicit takeover and return',()=>{
 const brief=nativeCountryAIBrief(5);
 for(const text of ['full_with_reserved','takeover','resume','continue','unity_traditions','operatorStanding','脱险自动恢复','不因模型等待而暂停'])assert.ok(brief.includes(text),text);
 for(const n of [0,61,NaN,'5'])assert.throws(()=>nativeCountryAIBrief(n));
});
