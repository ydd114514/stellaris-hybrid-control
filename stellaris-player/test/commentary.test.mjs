import test from 'node:test';
import assert from 'node:assert/strict';
import {publicSummary,planCaption,planHistoryItem,receiptCaption,dshPhase,audienceState,SurveyCaptionTracker} from '../src/commentary.mjs';
import {controlStatusText} from '../public/control-status.mjs';

test('audience summaries exclude credentials, arguments, private traces and local paths',()=>{
  for(const text of ['密钥 sk-abcdefghijk','检查 E:/private/data','我选择 fleet_id=16777221','思维链：先推演一下','内部推理如下','我用 requestId 提交','目标编号16777221','中文'.repeat(60)]) assert.equal(publicSummary(text),'');
  assert.equal(publicSummary('我先补上军舰，守好首都。'),'我先补上军舰，守好首都。');
});
test('DSH text and final monologues never become commentary',()=>{
  assert.equal(dshPhase({type:'text',text:'任意模型内部文本'}),null);
  assert.equal(dshPhase({type:'final',text:'任意模型总结'}),null);
  assert.equal(dshPhase({type:'tool_call',tool:'stellaris__apply_orders'}),'正在操作');
});
test('public intent uses an audience summary or a command-specific fallback',()=>{
  const orders=[{command:'reinforce_fleet',arguments:{fleet_id:1}}];
  assert.equal(planCaption({orders,explanation:'我先补上军舰，守好首都。'}).text,'我先补上军舰，守好首都。');
  assert.match(planCaption({orders,explanation:'fleet_id=1 需要增援'}).text,/补员/);
  assert.equal(planCaption({orders:[{command:'set_speed',arguments:{speed:2}}]}),null);
});
test('unverified submissions cannot claim completion or a confirmed queue',()=>{
  const row={type:'receipt',command:'build_ship',response:{success:true},verification:{phase:'shipyard_queue',verified:false}};
  assert.match(receiptCaption(row).text,/提交/);
  row.verification.verified=true;assert.match(receiptCaption(row).text,/等游戏/);
  assert.match(receiptCaption({type:'unknown'}).text,/还不明确/);
  assert.match(receiptCaption({type:'rejected'}).text,/暂时没能执行/);
});
test('audience facts are a limited selection of real game data',()=>{
  const result=audienceState({state:{date:'2266.01.01',military:{fleets:[{fleet_id:12345,total_ships:3},{total_ships:2}]},wars:[{}],player:{owned_systems:20,country_id:42},resources:{alloys:{stockpile:125.6}},capacities:{colonies:4}}},100);
  assert.equal(result.ships,5);assert.equal(result.alloys,126);assert.equal(result.inWar,true);assert.equal(result.worlds,20);assert.equal(result.updatedAt,100);
  assert.ok(!JSON.stringify(result).includes('fleet_id'));assert.ok(!JSON.stringify(result).includes('country_id'));
});
test('timeline keeps actual observation dates and public intent, without fabricated dates or raw reasoning',()=>{
  const row={type:'intent',at:'2026-10-28T01:00:00Z',orders:[{command:'survey'}],explanation:'我先让科研船调查这片星系。',thinking:'private reasoning'};
  const item=planHistoryItem(row,'2219.01.22');
  assert.equal(item.date,'2219.01.22');assert.equal(item.at,Date.parse(row.at));assert.equal(item.text,row.explanation);
  assert.ok(!JSON.stringify(item).includes('private'));
  assert.equal(planHistoryItem(row,undefined).date,null);
  assert.equal(planHistoryItem({...row,at:'invalid'},'2219.01.22'),null);
  assert.equal(planHistoryItem({...row,orders:[]},'2219.01.22'),null);
});
test('strategy review history describes measured progress and comparisons without raw game IDs',()=>{
  const row={type:'strategy_review',at:'2026-11-03T01:00:00Z',date:'2230.01.01',
    previousGoals:[{metric:'pops',current:100,target:100,status:'achieved'},{metric:'systems',current:'未知',target:20,status:'achieved'}],
    goals:[{metric:'research_monthly',current:125,target:150,byDate:'2235.01.01'}],
    neighbors:[[12345678,'苍蓝联盟','relative_power_inferior','未知',true],[98765432,'赤潮帝国','superior','未知',true],[19,'未核实帝国',3]],
    expansionDirection:{towardCountryId:12345678},warTarget:{countryId:98765432},
    reason:'内部推理 sk-abcdefghijk'};
  const message=planCaption(row),item=planHistoryItem(row,'2229.01.01');
  assert.equal(message.phase,'战略复查');
  assert.equal(item.date,row.date);
  assert.match(item.text,/人口100\/100（已达成）/);
  assert.match(item.text,/星系未知\/20（进度未知）/);
  assert.match(item.text,/强于苍蓝联盟，弱于赤潮帝国/);
  assert.match(item.text,/科研月产150（当前125，2235\.01\.01前）/);
  assert.match(item.text,/向苍蓝联盟方向扩张.*备战对象是赤潮帝国/);
  assert.doesNotMatch(item.text,/12345678|98765432|未核实帝国|abcdefghijk/);
});
test('delegation captions separate assignment, uncertainty and returned control',()=>{
 assert.match(receiptCaption({type:'survey_control',control:{owner:'native'}}).text,/交给自动/);
 assert.match(receiptCaption({type:'survey_control',control:{owner:'native',pending:true}}).text,/还没确认/);
 assert.match(receiptCaption({type:'survey_control',control:{owner:'manual'}}).text,/控制权已收回/);
});
test('audience can distinguish assigned automation from actual work without raw IDs',()=>{
 const checkpoint={sessionId:'current',state:{paused:false,surveyControl:{records:{7:{sessionId:'current',owner:'native',fleetId:7,observation:{orders:[{automation:true}]}},8:{sessionId:'old',owner:'native',fleetId:8}}}}};
 checkpoint.state.surveyControl.records[7].observedAt=100;
 const view=audienceState(checkpoint,100);assert.deepEqual(view.surveyDelegation,{assigned:1,working:0,uncertain:1});
 assert.equal(JSON.stringify(view).includes('fleetId'),false);
});
test('public status does not describe idle or uncertain automation as active work',()=>{
 assert.equal(controlStatusText({surveyDelegation:{assigned:1,working:0}}),'肥鱼指挥 · 调查待命');
 assert.equal(controlStatusText({surveyDelegation:{assigned:1,working:1}}),'肥鱼指挥 · 自动调查');
 assert.equal(controlStatusText({stopped:true,surveyDelegation:{uncertain:1}}),'控制已停 · 待核对');
 assert.equal(controlStatusText({paused:true,surveyDelegation:{working:1}}),'肥鱼休息中');
});
test('survey state transitions are announced once while reconciliation polls stay quiet',()=>{
 const tracker=new SurveyCaptionTracker(),row={type:'survey_control',fleetId:0,control:{sessionId:'s',owner:'native',pending:false}};
 assert.ok(tracker.consume(row));assert.equal(tracker.consume({...row,operation:'reconcile'}),null);
 assert.ok(tracker.consume({...row,control:{...row.control,owner:'unknown',pending:true}}));
 assert.ok(tracker.consume({...row,control:{...row.control,owner:'manual'}}));
 assert.ok(tracker.consume({...row,fleetId:1}));
});
test('source update time cannot freeze the clock used to expire survey observations',()=>{
 const cp={sessionId:'s',state:{paused:false,surveyControl:{records:{0:{sessionId:'s',owner:'native',observedAt:100,observation:{orders:[{automation:false}]}}}}}};
 const view=audienceState(cp,20000,{updatedAt:100});
 assert.deepEqual(view.surveyDelegation,{assigned:0,working:0,uncertain:1});assert.equal(view.updatedAt,100);
});
