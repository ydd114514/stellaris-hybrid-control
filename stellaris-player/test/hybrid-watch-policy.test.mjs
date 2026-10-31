import test from 'node:test';import assert from 'node:assert/strict';
import {NativeGame} from '../src/native-game.mjs';
const healthy=()=>({is_paused:true,date:{formatted:'2200.01.01'},resources:Object.fromEntries(['energy','alloys','food','trade','unity'].map(k=>[k,{stockpile:1000,net:10}]))});
function fixture({working=true,known=true,resources=healthy(),watchSeconds=60}={}){
 const game=new NativeGame({hybridSurvey:true,requirePicture:false,surveyWatchSeconds:watchSeconds}),calls=[];
 let automation={known,automation_enabled:true,order_chain_complete:true,automation_order_count:1,orders:[{automation:true,settings_bits:2,action_option_count:0},...(working?[{automation:false,token:11957}]:[])]};
 game.gestalt.data.surveyControl={revision:1,records:{0:{fleetId:0,revision:1,sessionId:game.sessionId,owner:'native',desired:true,pending:false}}};
 game.gestalt.save=async()=>{};game.guard=async()=>resources;game.lastState={wars:[],alerts:[]};game.observe=async()=>game.lastState;game.log=async()=>{};game.checkpoint=async()=>{};
 game.rpc=async(m,p)=>{calls.push({m,p});if(m==='get_fleet_automation')return automation;if(m==='set_survey_automation'){automation={known:true,automation_enabled:false,order_chain_complete:true,orders:[]};return {success:true};}if(m==='get_active_events')return [];if(m==='get_wars')return {warGoalsWindow:false,wars:[]};return {success:true};};
 return {game,calls};
}
test('a quiet long watch is available only for fresh, actually working native delegation',async()=>{
 const original=Date.now;
 try{
  for(const working of [true,false]){
   const {game}=fixture({working});let calls=0;
   // Skip only real waiting; all admission checks and the real watch body run.
   Date.now=()=>calls++===0?0:1000000;
   const result=await game.watch(60);
   assert.equal(result.waitPolicy.effectiveSeconds,working?60:20);
   assert.equal(result.waitPolicy.nativeWorkConfirmed,working);
   Date.now=original;
  }
 }finally{Date.now=original;}
 await assert.rejects(new NativeGame().watch(60),/0..20/);
});
test('unknown authority and an already-known resource shortfall never resume the game',async()=>{
 for(const opts of [{known:false},{resources:{...healthy(),resources:{...healthy().resources,energy:{stockpile:0,net:-10}}}}]){
  const {game,calls}=fixture(opts);const result=await game.watch(60);
  assert.ok(result.needsAttention);assert.equal(calls.some(c=>c.m==='set_paused'&&c.p.paused===false),false);
 }
});
test('standby already beyond both clocks is reclaimed before any unpause',async()=>{
 const {game,calls}=fixture({working:false,resources:{...healthy(),date:{formatted:'2200.02.02'}}});
 Object.assign(game.gestalt.data.surveyControl.records[0],{idleSince:0,idleGameDay:2200*360,idleLastGameDay:2200*360});
 const r=await game.watch(60);assert.deepEqual(r.wakeReasons,['survey_no_work']);assert.equal(game.surveyDelegation.record(0).owner,'manual');assert.equal(calls.some(c=>c.m==='set_paused'&&c.p.paused===false),false);
});

test('explicit ninety-second window still falls back to twenty without native work',async()=>{
 const original=Date.now;
 try{for(const working of [true,false]){
  const {game}=fixture({working,watchSeconds:90});let reads=0;Date.now=()=>reads++===0?0:1000000;
  const result=await game.watch(90);assert.equal(result.waitPolicy.effectiveSeconds,working?90:20);Date.now=original;
 }}finally{Date.now=original;}
 await assert.rejects(new NativeGame({hybridSurvey:true}).watch(90),/0..60/);
 await assert.rejects(new NativeGame({surveyWatchSeconds:90}).watch(90),/0..20/);
 assert.throws(()=>new NativeGame({surveyWatchSeconds:120}),/60或90/);
});
test('ninety-second wait wakes on the first protection tick and actually reclaims on events or reserve risk',async()=>{
 for(const kind of ['event','reserve']){
  const {game,calls}=fixture({watchSeconds:90});let resumed=false;const rpc=game.rpc;
  game.guard=async()=>({...healthy(),is_paused:!resumed,...(kind==='reserve'&&resumed?{resources:{...healthy().resources,energy:{stockpile:0,net:-1000}}}:{})});
  game.rpc=async(m,p)=>{
   if(m==='set_paused')resumed=p.paused===false;
   if(m==='get_active_events')return resumed&&kind==='event'?[{window_id:0}]:[];
   if(m==='get_alerts')return [];
   return rpc(m,p);
  };
  const start=Date.now(),result=await game.watch(90);
  assert.ok(Date.now()-start<10000);assert.ok(result.wakeReasons.includes(kind==='event'?'central_event':'survey_resource_risk'));
  assert.equal(game.surveyDelegation.record(0).owner,'manual');
  assert.ok(calls.some(x=>x.m==='set_paused'&&x.p.paused===false));assert.ok(calls.some(x=>x.m==='set_paused'&&x.p.paused===true));
 }
});
