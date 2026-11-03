
import test from 'node:test';
import assert from 'node:assert/strict';
import {shouldCheckGameCompaction,NATIVE_REASONING_COMPACTION_TOKENS} from '../src/game-compaction-pressure.mjs';

test('native reasoning waits for the 120k absolute pressure floor',()=>{
  const pressure=totalTokens=>shouldCheckGameCompaction({nativeReasoning:true,trigger:'pressure',totalTokens});
  assert.equal(NATIVE_REASONING_COMPACTION_TOKENS,120000);
  assert.equal(pressure(33622),false);
  assert.equal(pressure(119999),false);
  assert.equal(pressure(120000),true);
});

test('ordinary SDK compaction and provider overflow remain active',()=>{
  assert.equal(shouldCheckGameCompaction({nativeReasoning:false,trigger:'pressure',totalTokens:33622}),true);
  assert.equal(shouldCheckGameCompaction({nativeReasoning:true,trigger:'context-overflow',totalTokens:25000}),true);
});
