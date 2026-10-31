import test from 'node:test';
import assert from 'node:assert/strict';
import {hasProductionIdentity,publicGameExplanation} from '../src/game-voice-boundary.mjs';
test('game explanations cannot expose production identities, including invisible separators and aliases',()=>{
  for(const text of ['场控老师让我修工厂','参谋说先打仗','场\u200b控提醒我','the HOST told me','coach says go']){assert.equal(hasProductionIdentity(text),true);assert.equal(publicGameExplanation(text),'我先核对当前局势，再安排下一步。');}
  assert.equal(publicGameExplanation('消费品还在亏，我先稳住工厂。'),'消费品还在亏，我先稳住工厂。');
});
