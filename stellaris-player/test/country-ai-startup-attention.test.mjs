import test from 'node:test';
import assert from 'node:assert/strict';
import {NativeGame} from '../src/native-game.mjs';

function fixture({events=[],warGoalsWindow=false,delegateError,unconfirmed=false,scopeError=false}={}){
 const calls=[];
 const host={nativeCountryAIEnabled:true,ends:61000,now:()=>1000,
  countryAI:{active:false,view(){return {owner:this.active?'unconfirmed':'human',paused:true,actualFlags:{human_ai:false,force_human_ai:false}}},
   async delegate(){calls.push('delegate');if(delegateError){events=[{window_id:1,kind:'first_contact_choice'}];this.active=unconfirmed;throw Error(delegateError)}},
   async resume(){calls.push('resume')}},
  async rpc(method,params){calls.push(method);if(method==='set_paused')return {success:params.paused===true};if(method==='get_active_events')return events;if(method==='get_wars')return {wars:[],warGoalsWindow};throw Error('测试出现意外接口')},
  async observe(){return {paused:true,pendingEvents:events,warGoalsWindow}},
  async assertNativeWorld(){if(scopeError)throw Error('玩家身份已改变')},
 };
 return {host,calls,clear(){events=[];warGoalsWindow=false},run:(operation='delegate')=>NativeGame.prototype.countryAIControl.call(host,{operation})};
}

test('已有第一次接触选择时返回可处理的attention，不开启或反复委派AI',async()=>{
 const x=fixture({events:[{window_id:1,kind:'first_contact_choice'}]}),result=await x.run();
 assert.equal(result.status,'attention');assert.equal(result.delegationDeferred,true);
 assert.equal(result.control.owner,'human');assert.equal(result.state.paused,true);
 assert.deepEqual(result.nextCall,{name:'inspect',arguments:{topic:'events'}});
 assert.equal(x.calls.includes('delegate'),false);
 x.clear();assert.equal((await x.run()).state.pendingEvents.length,0);assert.equal(x.calls.filter(x=>x==='delegate').length,1);
});
test('战争目标窗口同样先转交关键决策，交还前保持暂停',async()=>{
 const x=fixture({warGoalsWindow:true}),result=await x.run('resume');
 assert.equal(result.status,'attention');assert.equal(result.nextCall.arguments.topic,'wars');
 assert.equal(x.calls.includes('resume'),false);
});
test('准备过程中出现事件且已确认收权时，恢复到事件处理而非启动失败',async()=>{
 const x=fixture({delegateError:'country_ai_run_scope_or_key_event_blocked'}),result=await x.run();
 assert.equal(result.status,'attention');assert.equal(result.control.owner,'human');
 assert.equal(x.calls.filter(x=>x==='delegate').length,1);
});
test('同样错误若控制权未确认或世界改变，仍保留硬停止和原错误',async()=>{
 const x=fixture({delegateError:'country_ai_run_scope_or_key_event_blocked',unconfirmed:true});
 await assert.rejects(x.run(),/country_ai_run_scope_or_key_event_blocked/);
 const y=fixture({delegateError:'country_ai_run_scope_or_key_event_blocked',scopeError:true});
 await assert.rejects(y.run(),/身份已改变/);
});
test('事件状态未知时不开始委派，也不当作可以自动处理的窗口',async()=>{
 const x=fixture({events:null});await assert.rejects(x.run(),/状态未知/);assert.equal(x.calls.includes('delegate'),false);
});
test('中央事件命令仍须实际接管，不能借新增工具绕过原生AI派单边界',async()=>{
 let sent=false;const host={nativeCountryAIFence:true,countryAI:{view:()=>({owner:'native'})},performApply:async()=>{sent=true}};
 await assert.rejects(NativeGame.prototype.apply.call(host,{orders:[{command:'resolve_event',arguments:{window_id:1,option_index:0}}]}),/仅允许战略合同和保留决定/);
 assert.equal(sent,false);
});
