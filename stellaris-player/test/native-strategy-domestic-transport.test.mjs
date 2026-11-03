import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {NativeGame} from '../src/native-game.mjs';
import {NativePipe} from '../src/native-pipe.mjs';

test('a strategy-authorized edict survives binding at the actual pipe write fence',async()=>{
 const key='fleet_supremacy',writes=[];
 let active=true;
 const pipe=new NativePipe({connect:()=>{
  const socket=new EventEmitter();
  socket.destroy=()=>{socket.destroyed=true;};
  socket.write=line=>{
   const {id,method,params}=JSON.parse(line);
   let result;
   if(method==='get_edicts'){
    result={summary:{active_edicts_count:Number(active)},active_edicts:active?[{key}]:[]};
   }else{
    assert.equal(method,'toggle_edict');
    assert.deepEqual(params,{edict_key:key,enabled:false,_expected_world_generation:1,
     _expected_game_pid:9,_expected_game_creation:'fixture'});
    assert.throws(()=>game.assertRpcAllowed(method,{...params}),/封口/);
    writes.push(params);
    active=false;
    result={success:true};
   }
   queueMicrotask(()=>socket.emit('data',Buffer.from(JSON.stringify({id,result})+String.fromCharCode(10))));
  };
  queueMicrotask(()=>socket.emit('connect'));
  return socket;
 }});
 const game=new NativeGame({pipe,nativeCountryAI:true});
 Object.assign(game,{nativeCountryAIFence:true,boundNativeWorld:{world_generation:1},
  binding:{pid:9,creationTime:'fixture'},lastState:{date:'2225.10.19'},
  countryAI:{view:()=>({owner:'native'}),heartbeat:async()=>{}},
  commandScope:async()=>({connectionEpoch:pipe.connectionEpoch}),
 });
 try{
  const params={edict_key:key,enabled:false};
  await assert.rejects(game.rpc('toggle_edict',params),/封口/);
  const receipt=await game.applyStrategyDomestic({type:'toggle_edict',arguments:params});
  assert.equal(receipt.confirmed,true);
  assert.equal(receipt.changed,true);
  assert.equal(writes.length,1);
  await assert.rejects(game.rpc('toggle_edict',params),/封口/);
 }finally{pipe.close();}
});
