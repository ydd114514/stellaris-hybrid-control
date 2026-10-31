import test from 'node:test';
import assert from 'node:assert/strict';
import {assertGameStartPolicy} from '../src/game-start-policy.mjs';
test('desktop manual mode cannot launch a missing game or restart a loaded bridge',()=>{
  assert.throws(()=>assertGameStartPolicy({hasGame:false,requireRunningGame:true}),/不会自动启动游戏/);
  assert.throws(()=>assertGameStartPolicy({hasGame:true,requiresRestart:true,requireRunningGame:true}),/不会自动关闭或重启/);
  assert.doesNotThrow(()=>assertGameStartPolicy({hasGame:true,requireRunningGame:true}));
  assert.throws(()=>assertGameStartPolicy({hasGame:false}),/不会自动启动游戏/);
  assert.throws(()=>assertGameStartPolicy({hasGame:true,requiresRestart:true,requireRunningGame:false}),/不会自动关闭或重启/);
});
