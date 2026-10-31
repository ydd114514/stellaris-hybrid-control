import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {GestaltTasks} from '../src/gestalt-tasks.mjs';
const binding={pid:1,creationTime:'test'};
const state={snapshotId:'s1',date:'2200.01.01',player:{country_id:0,capital_system_id:0},resources:{alloys:{stockpile:100}}};
const order={command:'survey',arguments:{fleet_id:0,system_id:1}};
async function fixture(t){const directory=await mkdtemp(join(tmpdir(),'gestalt-'));t.after(()=>rm(directory,{recursive:true,force:true}));const g=new GestaltTasks({directory});await g.bind(binding,state);return {g,directory};}
test('shared commitments reject overbooking and cancellation releases once',async t=>{const {g}=await fixture(t);const a=await g.add({goal:'造船',orders:[order],budget:{alloys:70}},state);await assert.rejects(g.add({goal:'另一舰队',orders:[order],budget:{alloys:40}},state),/预算/);await g.cancel(a.id);await g.cancel(a.id);assert.deepEqual(g.commitments(),{});});
test('waiting uses game date while other work advances; dependencies wake',async t=>{const {g}=await fixture(t);const a=await g.add({goal:'等施工',orders:[order],wake:{gameDate:'2200.02.01'}},state);const b=await g.add({goal:'探索',orders:[order]},state);assert.equal(g.next().id,b.id);await g.update({...state,paused:true});assert.equal(a.status,'waiting');await g.update({...state,date:'2200.02.01'});assert.equal(a.status,'ready');});
test('restart retains uncertain action and blocks duplicate write even with a new request',async t=>{const {g,directory}=await fixture(t);await g.prepare(order,state);const restored=new GestaltTasks({directory});await restored.bind(binding,state);await assert.rejects(restored.prepare(order,state),/禁止重放/);assert.equal(restored.view().unconfirmed.length,1);});
test('accepted but unfinished orders remain protected after a controller restart',async t=>{const {g,directory}=await fixture(t);const a=await g.prepare(order,state);await g.receipt(a,'submitted','old-tracker');const restored=new GestaltTasks({directory});await restored.bind(binding,state);await assert.rejects(restored.prepare(order,state),/禁止重放/);assert.equal(restored.view().unconfirmed[0].status,'unknown');});
test('pause blocks late work; repeated confirmation never double charges',async t=>{const {g}=await fixture(t);const task=await g.add({goal:'探索',orders:[order]},state);const a=await g.prepare(order,state,task.id);await g.receipt(a,'submitted','track');await g.update(state,[{id:'track',status:'completed'}]);await g.update(state,[{id:'track',status:'completed'}]);assert.equal(task.status,'completed');g.pause();await assert.rejects(g.prepare(order,state),/暂停/);});
test('different game binding never imports old commitments',async t=>{const {g,directory}=await fixture(t);await g.add({goal:'造舰',orders:[order],budget:{alloys:100}},state);const other=new GestaltTasks({directory});await other.bind({...binding,creationTime:'other'},state);assert.deepEqual(other.commitments(),{});});

test('restart movement reconciliation proves destination and retires only superseded movement',async t=>{
 const {g,directory}=await fixture(t);let clock=1;g.now=()=>clock++;
 const old=await g.prepare({command:'move_fleet',arguments:{fleet_id:0,system_id:9}},state);await g.receipt(old,'submitted','old');
 const purchase=await g.prepare({command:'build_ship',arguments:{design_id:0,system_id:9}},state);await g.receipt(purchase,'submitted','buy');
 const newer=await g.prepare({command:'move_fleet',arguments:{fleet_id:0,system_id:2}},state);await g.receipt(newer,'submitted','new');
 const restored=new GestaltTasks({directory});await restored.bind(binding,state);
 await restored.reconcileMoves(async()=>({fleets:[]}));assert.equal(restored.data.actions[0].status,'unknown');
 await restored.reconcileMoves(async()=>({fleets:[{id:0,own:true}]}));
 assert.equal(restored.data.actions[0].status,'superseded');assert.equal(restored.data.actions[1].status,'unknown');assert.equal(restored.data.actions[2].status,'confirmed');
 await assert.doesNotReject(restored.prepare(old.order,{...state,snapshotId:'new'}));
 await assert.rejects(restored.prepare(purchase.order,state),/禁止重放/);
});

test('campaign attempt without durable send row is locally deferred; existing write stays unknown',async t=>{
 const {g}=await fixture(t);const move={command:'move_fleet',arguments:{fleet_id:0,system_id:9}};
 g.data.campaign={actions:{beforeSend:{status:'unknown',snapshotId:'absent',order:move},afterSend:{status:'unknown',snapshotId:state.snapshotId,order:move}}};
 await g.prepare(move,state);g.reconcileCampaignOutbox();
 assert.equal(g.data.campaign.actions.beforeSend,undefined);assert.equal(g.data.campaign.actions.afterSend.status,'unknown');
});

test('virtual first-contact IDs are scoped by real contact and stage, including legacy restart migration',async t=>{
 const {g,directory}=await fixture(t),session='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
 const click={command:'resolve_event',arguments:{window_id:0xFFFF0003,option_index:0}},snapshot={...state,snapshotId:session+':1',pendingEvents:[{window_id:0xFFFF0003,first_contact_id:11,title:'阶段1',kind:'first_contact_choice'}]};
 const old=await g.prepare(click,snapshot);await g.receipt(old,'unknown');
 await writeFile(join(directory,'session-'+session+'.jsonl'),JSON.stringify({type:'state',state:snapshot})+'\n');
 await assert.rejects(g.prepare(click,state,undefined,[11,'阶段1','first_contact_choice']),/禁止重放/);
 const next=await g.prepare(click,state,undefined,[19,'阶段1','first_contact_choice']);assert.equal(next.status,'issued');assert.equal(old.status,'unknown');assert.equal(old.scope[0],11);
 await assert.rejects(g.prepare(click,state,undefined,[19,'阶段1','first_contact_choice']),/禁止重放/);
});

test('reinforcement intent uses its real design/quota context after upgrades, never replays the old unknown template',async t=>{
 const {g,directory}=await fixture(t),session='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',r={command:'reinforce_fleet',arguments:{fleet_id:0}},oldTargets=[{designId:1,count:20}];
 const old=await g.prepare(r,{...state,snapshotId:session+':2'});await g.receipt(old,'unknown','old-reinforce');
 await writeFile(join(directory,'orders-'+session+'.json'),JSON.stringify({records:[{id:'old-reinforce',baseline:{fleetTargets:oldTargets}}]}));
 await assert.rejects(g.prepare(r,state,undefined,['reinforcement_template',oldTargets]),/禁止重放/);
 const scope=['reinforcement_template',[{designId:2,count:60}]],next=await g.prepare(r,state,undefined,scope);await g.receipt(next,'unknown');
 assert.equal(old.status,'unknown');assert.equal(old.scope[1][0].designId,1);
 g.data.campaign={actions:{reinforce:{status:'unknown',snapshotId:state.snapshotId,order:r}}};g.reconcileCampaignOutbox();assert.ok(g.data.campaign.actions.reinforce);
 await assert.rejects(g.prepare(r,state,undefined,scope),/禁止重放/);
});

test('argument reordering cannot replay an unknown purchase across a controller restart',async t=>{
 const {g,directory}=await fixture(t);
 const buy={command:'build_ship',arguments:{design_id:0,system_id:1,count:2}};
 await g.prepare(buy,state);
 const restored=new GestaltTasks({directory});await restored.bind(binding,state);
 await assert.rejects(restored.prepare({arguments:{count:2,system_id:1,design_id:0},command:'build_ship'},state),/禁止重放/);
});

test('an explicit task id never runs a different higher-priority or ready task',async t=>{
 const {g}=await fixture(t);const a=await g.add({goal:'A',orders:[order],priority:100},state),b=await g.add({goal:'B',orders:[order],priority:1},state);
 assert.equal(g.next().id,a.id);assert.equal(g.next(b.id).id,b.id);b.status='waiting';assert.throws(()=>g.next(b.id),/不会改跑/);assert.throws(()=>g.next('missing'),/不会改跑/);
 await assert.rejects(g.add({goal:'bad priority',orders:[order],priority:'high'},state),/0..100/);
});
