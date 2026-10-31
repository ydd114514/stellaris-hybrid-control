import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeCountryAIBrief} from '../src/native-country-ai-brief.mjs';
test('strategy brief sends operating work to the real country AI with explicit takeover and return',()=>{
 const brief=nativeCountryAIBrief(5);
 for(const text of ['country_ai_control delegate','takeover','owner=human','ordinaryOrdersBlocked=false','resume','continue','两个领域','核心交付尚未证明'])assert.ok(brief.includes(text),text);
 for(const n of [0,61,NaN,'5'])assert.throws(()=>nativeCountryAIBrief(n));
});
