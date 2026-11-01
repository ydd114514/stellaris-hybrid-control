import test from 'node:test';import assert from 'node:assert/strict';import {NativeDirector} from '../src/native-director.mjs';
test('director follows real categories, paces scenes, and never pauses or places orders',async()=>{
 let now=0;const d=new NativeDirector({now:()=>now}),calls=[],scenes=[];
 const ctx={control:{owner:'native',paused:false,commandCounts:{research_technology_command:{admitted:2}}},state:{date:'2200.01.01'},status:{},emit:async e=>scenes.push(e),rpc:async(m,p)=>{calls.push({m,p});return m==='get_active_events'?[]:m==='get_wars'?{wars:[]}:{success:true};}};
 await d.tick(ctx);assert.deepEqual(calls.filter(c=>c.m==='show_panel').map(c=>c.p.panel),['game','research']);assert.equal(scenes.length,1);
 await d.tick(ctx);assert.equal(scenes.length,1);
 now=20000;await d.tick({...ctx,mode:'fixed'});assert.equal(scenes.length,1);
 await d.tick({...ctx,control:{...ctx.control,owner:'unconfirmed'}});assert.equal(scenes.length,1);
 assert.ok(calls.every(c=>['get_active_events','get_wars','show_panel','show_galaxy_map'].includes(c.m)));
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
test('continuous survey noise cannot monopolize the screen or repeat the same ship',async()=>{
 let now=0;const scenes=[],d=new NativeDirector({now:()=>now});
 const ctx={control:{owner:'native',paused:false,commandCounts:{}},state:{},status:{outliner:{sectors_summary:{sectors:[{colonies_summary:[{planet_id:3,name:'地球'}]}]}}},
  emit:async e=>scenes.push({...e,at:now}),rpc:async m=>m==='get_active_events'?[]:m==='get_wars'?{wars:[]}:m==='get_civilian_fleets'?{science_ships:[{fleet_id:1},{fleet_id:2}],construction_ships:[{fleet_id:4}]}:m==='get_planet_details'?{construction_queue:[]}:{success:true}};
 for(now=0;now<=300000;now+=3000){ctx.control.commandCounts={survey_planet_order:{admitted:now+1},build_orbital_station_order:{admitted:now+1}};await d.tick(ctx);}
 assert.ok(new Set(scenes.map(x=>x.topic)).size>=5);
 assert.ok(scenes.every((x,i)=>!i||x.topic!==scenes[i-1].topic));
 const ships=new Map();for(const s of scenes)if(s.fleetId!==undefined){assert.ok(s.at-(ships.get(s.fleetId)??-Infinity)>=180000);ships.set(s.fleetId,s.at);}
 assert.ok(scenes.some(s=>s.topic==='stations'&&s.fleetId===4));
 assert.ok(scenes.some(s=>s.topic==='exploration'&&[1,2].includes(s.fleetId)));
 assert.ok(scenes.every((x,i)=>!i||x.at-scenes[i-1].at<=21000));
});
test('simultaneous market and research changes are both retained for presentation',async()=>{
 let now=0;const scenes=[],d=new NativeDirector({now:()=>now});
 const ctx={control:{owner:'native',paused:false,commandCounts:{research_technology_command:{admitted:1},market_buy_resource_command:{admitted:1}}},state:{},status:{},emit:async e=>scenes.push(e),rpc:async m=>m==='get_active_events'?[]:m==='get_wars'?{wars:[]}:{success:true}};
 await d.tick(ctx);now=18000;await d.tick(ctx);assert.deepEqual(scenes.map(x=>x.topic),['research','market']);
});
test('full galaxy is mandatory initially and at 120 seconds, overriding an ordinary hold',async()=>{
 let now=0;const scenes=[],d=new NativeDirector({now:()=>now});
 const ctx={control:{owner:'native',paused:false,commandCounts:{}},state:{},status:{},emit:async e=>scenes.push({...e,at:now}),rpc:async m=>m==='get_active_events'?[]:m==='get_wars'?{wars:[]}:{success:true,full_galaxy:true}};
 await d.tick(ctx);assert.equal(scenes[0].topic,'galaxy');assert.equal(d.next,15000);
 now=119000;await d.tick(ctx);assert.notEqual(scenes.at(-1).topic,'galaxy');
 now=120000;await d.tick(ctx);assert.equal(scenes.at(-1).topic,'galaxy');assert.equal(d.lastGalaxyAt,120000);
 now=240000;await d.tick({...ctx,mode:'fixed'});assert.equal(d.lastGalaxyAt,120000);
 await d.tick(ctx);assert.equal(d.lastGalaxyAt,240000);
});
test('failed full-map readback never clears the deadline; event windows defer it',async()=>{
 let now=0,blocked=true,valid=false;const d=new NativeDirector({now:()=>now});
 const ctx={control:{owner:'native',paused:false},state:{},status:{},rpc:async m=>m==='get_active_events'?(blocked?[{}]:[]):m==='get_wars'?{wars:[]}:m==='get_camera_state'?{success:true,full_galaxy:valid}:{success:true,full_galaxy:true}};
 await d.tick(ctx);assert.equal(d.lastGalaxyAt,null);
 now=3000;blocked=false;await d.tick(ctx);assert.equal(d.lastGalaxyAt,null);
 now=13000;valid=true;await d.tick(ctx);assert.equal(d.lastGalaxyAt,13000);
});
