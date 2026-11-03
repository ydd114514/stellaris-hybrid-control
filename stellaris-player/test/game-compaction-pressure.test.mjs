
import test from 'node:test';
import assert from 'node:assert/strict';
import {dshNativeThinkingEnv,nativeMcpEnvironmentPatch} from '../src/dsh-mcp-environment.mjs';
import {shouldCheckGameCompaction,NATIVE_REASONING_COMPACTION_TOKENS} from '../src/game-compaction-pressure.mjs';

test('native thinking waits for the 120k absolute pressure floor',()=>{
  const pressure=totalTokens=>shouldCheckGameCompaction({nativeThinking:true,trigger:'pressure',totalTokens});
  assert.equal(NATIVE_REASONING_COMPACTION_TOKENS,120000);
  assert.equal(pressure(33622),false);
  assert.equal(pressure(119999),false);
  assert.equal(pressure(120000),true);
});

test('ordinary SDK compaction and provider overflow remain active',()=>{
  assert.equal(shouldCheckGameCompaction({nativeThinking:false,trigger:'pressure',totalTokens:33622}),true);
  assert.equal(shouldCheckGameCompaction({nativeThinking:true,trigger:'context-overflow',totalTokens:25000}),true);
});

test('the fast-model fallback enables the same pressure floor as a discovered model',()=>{
 const options={directory:'fixture',runId:'pressure-fallback',minutes:5,hybridSurvey:false};
 for(const strategyModel of [undefined,'deepseek-v4-pro']){
  const patch=nativeMcpEnvironmentPatch({...options,nativeCountryAI:true,strategyModel});
  const model=patch.find(row=>row.id==='agent-default-model').config.model;
  assert.equal(model,strategyModel??'deepseek-flash');
  const nativeThinking=dshNativeThinkingEnv(patch).CYBERFISH_NATIVE_THINKING==='1';
  assert.equal(nativeThinking,true);
  assert.equal(shouldCheckGameCompaction({nativeThinking,trigger:'pressure',totalTokens:119999}),false);
  assert.equal(shouldCheckGameCompaction({nativeThinking,trigger:'pressure',totalTokens:120000}),true);
 }
 assert.equal(dshNativeThinkingEnv(nativeMcpEnvironmentPatch(options)).CYBERFISH_NATIVE_THINKING,'0');
});
