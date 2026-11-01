import test from 'node:test';
import assert from 'node:assert/strict';
import {assertGameStartPolicy,assertNativeBridgeStartPolicy} from '../src/game-start-policy.mjs';
test('desktop manual mode cannot launch a missing game or restart a loaded bridge',()=>{
  assert.throws(()=>assertGameStartPolicy({hasGame:false,requireRunningGame:true}),/不会自动启动游戏/);
  assert.throws(()=>assertGameStartPolicy({hasGame:true,requiresRestart:true,requireRunningGame:true}),/不会自动关闭或重启/);
  assert.doesNotThrow(()=>assertGameStartPolicy({hasGame:true,requireRunningGame:true}));
  assert.throws(()=>assertGameStartPolicy({hasGame:false}),/不会自动启动游戏/);
  assert.throws(()=>assertGameStartPolicy({hasGame:true,requiresRestart:true,requireRunningGame:false}),/不会自动关闭或重启/);
});
test('desktop preflight rejects an old or unreadable native bridge before starting the model',()=>{
 const requiredPath='E:/player/runtime/new/stellaris_bridge.dll';
 assert.doesNotThrow(()=>assertNativeBridgeStartPolicy({bridgeModule:{known:true,loaded:false},requiredPath}));
 assert.doesNotThrow(()=>assertNativeBridgeStartPolicy({bridgeModule:{known:true,loaded:true,path:'e:/PLAYER/runtime/new/stellaris_bridge.dll'},requiredPath}));
 assert.throws(()=>assertNativeBridgeStartPolicy({bridgeModule:{known:true,loaded:true,path:'E:/player/runtime/old/stellaris_bridge.dll'},requiredPath}),/手动重启/);
 assert.throws(()=>assertNativeBridgeStartPolicy({bridgeModule:{known:false},requiredPath}),/无法读取/);
 assert.throws(()=>assertNativeBridgeStartPolicy({bridgeModule:{known:true,loaded:true},requiredPath}),/无法读取/);
});
