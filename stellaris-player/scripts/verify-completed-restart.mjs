import assert from 'node:assert/strict';import {NativeGame} from '../src/native-game.mjs';
const game=new NativeGame({minutes:1});try{
 await game.start();const c=game.gestalt.data.campaign;
 assert.equal(c.phase,'completed');assert.equal(c.result.success,true);assert.equal(c.result.warEnded,true);assert.equal(game.metrics.orders,0);
 console.log(JSON.stringify({phase:c.phase,warId:c.warId,ordersReplayed:game.metrics.orders,outboxContextRebound:true}));
}finally{await game.stop();}
