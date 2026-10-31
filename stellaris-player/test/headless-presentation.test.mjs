import test from 'node:test';import assert from 'node:assert/strict';
import {NativeGame} from '../src/native-game.mjs';
test('headless verification skips camera and panels without changing default presentation',async()=>{
 const g=new NativeGame({presentOrders:false});
 g.rpc=async()=>{throw Error('headless presentation must not send UI commands');};
 assert.deepEqual(await g.presentOrder({command:'move_fleet',arguments:{fleet_id:0,system_id:1}}),{interrupted:false});
 assert.equal(new NativeGame().presentOrders,true);
});
