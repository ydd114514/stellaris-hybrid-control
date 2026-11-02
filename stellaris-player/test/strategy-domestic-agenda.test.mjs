import test from 'node:test';
import assert from 'node:assert/strict';
import {applyDomesticAction,validateStrategyContract,strategyContractSchema} from '../src/strategy-contract.mjs';

const key='agenda_open_arms';
const action=(type='set_council_agenda',agenda_key=key)=>({type,arguments:{agenda_key},taskId:'advice-1'});
const contract=(extra={})=>({economyFocus:'unity_traditions',expansionStance:'consolidate',militaryStance:'peaceful',oneOffActions:[],reason:'执行当前建议并核查效果',...extra});
const government={ethics:[{key:'ethic_xenophile'}],available_agendas:[{key,name:'开放怀抱'}]};
const ready=()=>({active_agenda:key,agenda_ready:true,agenda_progress:7000,agenda_cost:7000});

test('task associations are bounded and cannot self-declare success or inject ordinary micro commands',()=>{
 const checked=validateStrategyContract(contract({domesticActions:[action()],taskIds:['advice-1'],taskUpdates:[{taskId:'advice-1',status:'working',reason:'正在根据当前候选调整议程'}]}));
 assert.equal(checked.domesticActions[0].taskId,'advice-1');assert.equal(checked.taskUpdates[0].status,'working');
 assert.equal(validateStrategyContract(contract({taskUpdates:[{taskId:'advice-1',status:'superseded',reason:'主播已明确改变方向'}]})).taskUpdates[0].status,'superseded');
 assert.ok(strategyContractSchema.properties.domesticActions.items.oneOf.some(row=>row.properties.type.const==='set_council_agenda'));
 for(const extra of [{taskIds:['advice-1','advice-1']},{taskIds:['../other']},{taskUpdates:[{taskId:'advice-1',status:'succeeded',reason:'已经采纳'}]},
  {taskUpdates:[{taskId:'advice-1',status:'blocked',reason:''}]},{domesticActions:[{type:'set_colony_designation',arguments:{planet_id:1,designation:'unity'}}]},
  {domesticActions:[{...action(),arguments:{agenda_key:key,country_id:2}}]},
  {domesticActions:[action(),action('set_council_agenda','agenda_display_of_power')]}])assert.throws(()=>validateStrategyContract(contract(extra)));
});

test('agenda selection rechecks current state and script-compatible candidates and confirms HUD key',async()=>{
 let active='',scopes=0,heartbeats=0;const writes=[];
 const result=await applyDomesticAction({action:action(),checkScope:async()=>scopes++,heartbeat:async()=>heartbeats++,
  rpc:async method=>method==='get_status'?{council:{active_agenda:active}}:government,
  write:async(method,params)=>{writes.push({method,params});active=params.agenda_key;return {success:true};}});
 assert.equal(result.status,'confirmed');assert.equal(result.changed,true);assert.equal(result.taskId,'advice-1');
 assert.equal(result.targetName,'开放怀抱');
 assert.deepEqual(writes,[{method:'set_council_agenda',params:{agenda_key:key}}]);assert.ok(scopes>=4&&heartbeats>=4);
});

test('edict receipt names come only from real active or available rows, including an already satisfied setting',async()=>{
 const result=await applyDomesticAction({action:{type:'toggle_edict',arguments:{edict_key:'research_subsidies',enabled:false}},
  rpc:async()=>({summary:{active_edicts_count:0},active_edicts:[],available_edicts:[{key:'research_subsidies',name:'科研补贴'}]}),write:async()=>{throw Error('本已关闭不得重发');}});
 assert.equal(result.targetName,'科研补贴');assert.equal(result.confirmed,true);assert.equal(result.changed,false);
 assert.throws(()=>validateStrategyContract(contract({domesticActions:[{...action(),targetName:'随意指定名称'}]})));
});

test('base gestalt agenda is usable for a hive while unverified, incompatible and absent candidates never dispatch',async()=>{
 const gestaltKey='agenda_infinite_opportunities_gestalt';let active='';
 const hive={authority:'auth_hive_mind',ethics:[{key:'ethic_gestalt_consciousness'}],available_agendas:[{key:gestaltKey}]};
 const result=await applyDomesticAction({action:action('set_council_agenda',gestaltKey),rpc:async method=>method==='get_status'?{council:{active_agenda:active}}:hive,
  write:async(_method,params)=>{active=params.agenda_key;return {success:true};}});
 assert.equal(result.confirmed,true);
 for(const [wanted,gov] of [[key,{...government,ethics:[{key:'ethic_xenophobe'}]}],[key,{...government,available_agendas:[]}],
  ['agenda_unknown',{...government,available_agendas:[{key:'agenda_unknown'}]}],[gestaltKey,{...government,available_agendas:[{key:gestaltKey}]}]]){
  let writes=0;const receipt={};
  await assert.rejects(applyDomesticAction({action:action('set_council_agenda',wanted),receipt,
   rpc:async method=>method==='get_status'?{council:{active_agenda:''}}:gov,write:async()=>{writes++;return {success:true};}}));
  assert.equal(writes,0);assert.equal(receipt.status,'rejected');
 }
});

test('a native agenda change during validation is not overwritten with an obsolete choice',async()=>{
 let reads=0,writes=0;
 await assert.rejects(applyDomesticAction({action:action(),rpc:async method=>method==='get_status'?{council:{active_agenda:++reads===1?'':'agenda_display_of_power'}}:government,
  write:async()=>{writes++;return {success:true};}}),/原生AI调整/);
 assert.equal(writes,0);
});

test('only a fully ready normal launch posts; disappearance alone remains unknown and does not replay',async()=>{
 let writes=0;const receipt={};
 await assert.rejects(applyDomesticAction({action:action('launch_council_agenda'),receipt,
  rpc:async()=>({council:writes?{active_agenda:'',agenda_ready:false,agenda_progress:0,agenda_cost:7000}:ready()}),
  write:async(method,params)=>{writes++;assert.equal(method,'launch_council_agenda');assert.deepEqual(params,{agenda_key:key});return {success:true};}}),/无已发动历史或增益回读/);
 assert.equal(writes,1);assert.equal(receipt.status,'unknown');assert.equal(receipt.confirmed,false);assert.equal(receipt.afterAgenda,'');
});

test('unready, unpriced, stale or partial agenda data never launches or pays for early completion',async()=>{
 for(const council of [{...ready(),agenda_ready:false},{...ready(),agenda_progress:6999},{...ready(),agenda_cost:undefined},
  {...ready(),agenda_cost:0},{...ready(),active_agenda:'agenda_display_of_power'},null]){
  let writes=0;await assert.rejects(applyDomesticAction({action:action('launch_council_agenda'),rpc:async()=>({council}),write:async()=>{writes++;return {success:true};}}));
  assert.equal(writes,0);
 }
 let reads=0,writes=0;
 await assert.rejects(applyDomesticAction({action:action('launch_council_agenda'),rpc:async()=>({council:++reads===1?ready():{...ready(),agenda_ready:false}}),write:async()=>{writes++;return {success:true};}}),/发送前/);
 assert.equal(writes,0);
});

test('scope changes stop before dispatch and unconfirmed selection posts only once',async()=>{
 let scopes=0,writes=0;
 await assert.rejects(applyDomesticAction({action:action(),checkScope:async()=>{if(++scopes>=3)throw Error('世界已改变');},
  rpc:async method=>method==='get_status'?{council:{active_agenda:''}}:government,write:async()=>{writes++;return {success:true};}}),/世界已改变/);
 assert.equal(writes,0);
 const receipt={};
 await assert.rejects(applyDomesticAction({action:action(),receipt,attempts:2,wait:async()=>{},rpc:async method=>method==='get_status'?{council:{active_agenda:''}}:government,
  write:async()=>{writes++;return {success:true};}}),/尚未确认/);
 assert.equal(writes,1);assert.equal(receipt.status,'unknown');
});
