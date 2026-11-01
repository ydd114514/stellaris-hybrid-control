import test from 'node:test';import assert from 'node:assert/strict';import {NativeDirector} from '../src/native-director.mjs';
test('director follows real categories, paces scenes, and never pauses or places orders',async()=>{
 let now=0;const d=new NativeDirector({now:()=>now}),calls=[],scenes=[];
 const ctx={control:{owner:'native',paused:false,commandCounts:{research_technology_command:{admitted:2}}},state:{date:'2200.01.01'},status:{},emit:async e=>scenes.push(e),rpc:async(m,p)=>{calls.push({m,p});return m==='get_active_events'?[]:m==='get_wars'?{wars:[]}:{success:true};}};
 await d.tick(ctx);assert.deepEqual(calls.filter(c=>c.m==='show_panel').map(c=>c.p.panel),['game','research']);assert.equal(scenes.length,1);
 await d.tick(ctx);assert.equal(scenes.length,1);
 now=20000;await d.tick({...ctx,mode:'fixed'});assert.equal(scenes.length,1);
 await d.tick({...ctx,control:{...ctx.control,owner:'unconfirmed'}});assert.equal(scenes.length,1);
 assert.ok(calls.every(c=>['get_active_events','get_wars','show_panel'].includes(c.m)));
});
test('central events block presentation and failed UI never propagates into AI control',async()=>{
 const d=new NativeDirector({now:()=>1000});let writes=0;
 const ctx={control:{owner:'native',paused:false},state:{},status:{},rpc:async m=>{if(m==='get_active_events')return [{}];if(m==='get_wars')return {wars:[]};writes++;}};
 await d.tick(ctx);assert.equal(writes,0);
 await assert.doesNotReject(()=>new NativeDirector().tick({...ctx,rpc:async m=>m==='get_active_events'?[]:m==='get_wars'?{wars:[]}:Promise.reject(Error('UI unavailable'))}));
});
test('planet caption describes a real queue without claiming completion',async()=>{
 const d=new NativeDirector({now:()=>1000});let scene;
 await d.tick({control:{owner:'native',paused:false,commandCounts:{add_buildable_to_queue_command:{admitted:1}}},state:{date:'2200.01.01'},status:{outliner:{sectors_summary:{sectors:[{colonies_summary:[{planet_id:3,name:'地球',has_construction:true}]}]}}},
  emit:async e=>{scene=e;},rpc:async m=>m==='get_active_events'?[]:m==='get_wars'?{wars:[]}:m==='get_planet_details'?{construction_queue:[{item_name:'研究区'}]}:{success:true}});
 assert.equal(scene.text,'地球当前建设队列：研究区。');assert.equal(scene.topic,'planet');
});
