import test from 'node:test';
import assert from 'node:assert/strict';
import {AdviceExecution,readExecutionTasks} from '../src/advice-execution.mjs';
import {NativeStrategyReview} from '../src/native-strategy-review.mjs';
const state=(date='2200.01.01',net=30)=>({date,resources:{unity:{net},physics_research:{net:10},society_research:{net:10},engineering_research:{net:10}}});
const task=(id='t1',text='持续提高凝聚力净产')=>({id,source:'audience',suggestionId:'s1',text,at:1000});
const setup=()=>{const x=new AdviceExecution({now:()=>1000});x.bind('game1','world1',state());return x;};
test('任务只接收有界自然语言目标，新包缺席不取消旧任务，terminal不会被重发复活',()=>{
 const x=setup();x.ingest([task()],state());x.ingest([task('t2','关闭科研补贴')],state());assert.equal(x.view().tasks.length,2);
 x.update([{taskId:'t1',status:'superseded',reason:'新要求替代旧方向'}],state());x.ingest([task()],state());assert.equal(x.view().tasks[0].status,'superseded');
 assert.throws(()=>x.start(['t1'],state()),/已经结束/);assert.throws(()=>x.update([{taskId:'t2',status:'succeeded',reason:'我认为好了'}],state()),/不能由模型/);
 const bad=[{...task(),id:'bad/id'},{...task(),source:'shell'},{...task(),suggestionId:undefined}];assert.deepEqual(readExecutionTasks(bad,1000),[]);
});
test('steering和相关单个法令不能冒充持续经营目标成功，明确具体中文设置可完成',()=>{
 const x=setup();x.ingest([task(),task('t2','关闭科研补贴')],state());x.start(['t1','t2'],state());
 const receipt={type:'toggle_edict',arguments:{edict_key:'research_subsidies',enabled:false},targetName:'科研补贴',status:'confirmed',confirmed:true};
 x.finish(['t1','t2'],{status:'applied',steering:{confirmed:true},domesticActions:[{...receipt,taskId:'t1'},{...receipt,taskId:'t2'}]},state());
 assert.equal(x.view().tasks[0].status,'verifying');assert.equal(x.view().tasks[1].status,'succeeded');assert.match(x.view().tasks[1].evidence,/科研补贴/);
 const y=setup();y.ingest([task('t3','关闭科研补贴并提高凝聚力')],state());y.finish(['t3'],{status:'applied',domesticActions:[{...receipt,taskId:'t3'}]},state());assert.equal(y.view().tasks[0].status,'verifying');
});
test('否定任务和具体补贴设置不绑定资源增产指标，也不能反向操作后称完成',()=>{
 const x=setup();x.ingest([task('t1','不要拉凝聚力'),task('t2','关闭科研补贴')],state());
 assert.ok(x.serialize().tasks.every(t=>t.metric===null));
 x.finish(['t1'],{status:'applied',domesticActions:[{type:'toggle_edict',arguments:{edict_key:'unity_edict',enabled:false},targetName:'凝聚力',taskId:'t1',status:'confirmed',confirmed:true}]},state());assert.notEqual(x.view().tasks[0].status,'succeeded');
});
test('按游戏时间对实际净产复查，停滞受阻不能靠重复方针或模型文字洗成进行中',()=>{
 const x=setup();x.ingest([task()],state());x.start(['t1'],state());x.finish(['t1'],{status:'applied'},state());
 x.observe(state('2200.07.01',45));assert.equal(x.view().tasks[0].status,'verifying');assert.match(x.view().tasks[0].evidence,/30变为45/);
 x.observe(state('2201.01.01',45));assert.equal(x.view().tasks[0].status,'blocked');
 x.start(['t1'],state('2201.01.01',45));x.update([{taskId:'t1',status:'working',reason:'继续同一方针'}],state());x.finish(['t1'],{status:'applied'},state());assert.equal(x.view().tasks[0].status,'blocked');
});
test('仅同会话同世界恢复待办和结果，控制器新会话、换世界或倒退日期均不迁移旧意图',()=>{
 const x=setup();x.ingest([task()],state());x.start(['t1'],state());const saved=x.serialize();
 const y=setup();assert.equal(y.restore(saved,state()),true);assert.equal(y.view().gameSessionId,'game1');assert.equal(y.view().tasks[0].status,'working');
 y.bind('new-controller','world1',state());assert.equal(y.view().tasks.length,0);assert.equal(y.restore(saved,state()),false);
 y.bind('game1','world2',state());assert.equal(y.restore(saved,state()),false);
 x.bind('game1','world1',state('2199.01.01'));assert.equal(x.view().tasks.length,0);
});
test('任务新到达或受阻状态变化即时唤醒一次，半年内同状态不会无限战略唤醒',()=>{
 const x=setup(),s=state(),review=new NativeStrategyReview();s.adviceExecution=x.view();review.acknowledge(s);
 x.ingest([task()],s);s.adviceExecution=x.view();assert.ok(review.due(s).includes('strategic_event'));review.acknowledge(s);assert.deepEqual(review.due(s),[]);
 x.update([{taskId:'t1',status:'blocked',reason:'当前没有合法操作入口'}],s);s.adviceExecution=x.view();assert.ok(review.due(s).includes('strategic_event'));
});
