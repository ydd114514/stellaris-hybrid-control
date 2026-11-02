import test from 'node:test';
import assert from 'node:assert/strict';
import {createGrowthTracker,strategicReview} from '../src/strategic-review.mjs';
import {unityProgress} from '../src/unity-progress.mjs';
import {NativeStrategyReview} from '../src/native-strategy-review.mjs';
function state(year,net,size,traditions=7){return {date:year+'.01.01',player:{country_id:1,capital_system_id:1},operatorStanding:{economyFocus:'unity_traditions'},resources:{unity:{net,income:334.56,expense:259.7,stockpile:778},physics_research:{net:100},society_research:{net:100},engineering_research:{net:100}},capacities:{empire_size:size,colonies:6},traditions:{unlocked_traditions_count:traditions,next_tradition_cost:11313.44}};}
test('低净产和高维护是真实诊断，旧桥估算费用不冒充真实等待月数',()=>{
 const x=unityProgress(state(2315,74.86,634,22));assert.equal(x.net,74.9);assert.equal(x.maintenancePressure,true);assert.ok(Math.abs(x.maintenanceShare-.776)<1e-9);
 assert.equal(x.traditionCost,null);assert.equal(x.monthsToNextTradition,null);assert.equal(x.estimatedMonthsToFundNext,140.7);assert.ok(x.reasons.some(r=>r.includes('估算')));
 assert.equal(x.targetNet,undefined);assert.equal(x.deadlineYear,undefined);
});
test('同局增长记录检测净产停滞、规模跑在产能前面，并在续开后保留趋势',()=>{
 const tracker=createGrowthTracker();tracker.record(state(2240,60,200));const end=state(2243,62,300);tracker.record(end);
 const u=tracker.review(end).unity;assert.equal(u.stagnating,true);assert.equal(u.scalingBehind,true);
 const fresh=createGrowthTracker();assert.equal(fresh.restore(tracker.serialize(),end),true);assert.equal(fresh.review(end).unity.stagnating,true);
 const improving=state(2244,150,300,10);fresh.record(improving);assert.equal(fresh.review(improving).unity.stagnating,false);
});
test('没有已知总收入/维护或历史时保持未知，不把缺字段当成零',()=>{
 const s=state(2240,66,200);delete s.resources.unity.income;delete s.resources.unity.expense;
 const u=unityProgress(s);assert.equal(u.income,null);assert.equal(u.expense,null);assert.equal(u.maintenanceShare,null);assert.equal(u.baseline,null);
});
test('其他方针不会仅因凝聚力几十净产被强行切回凝聚力，也无固定600目标',()=>{
 const s=state(2315,75,634);s.operatorStanding.economyFocus='research';s.strategyObjectives={unity:{mode:'sustained_growth'}};
 const u=unityProgress(s);assert.equal(u.focused,false);assert.equal(u.maintenancePressure,false);assert.equal(u.targetMet,undefined);
});
test('凝聚力维护压力或新增殖民地会唤醒策略复查，不等待纯六个月定时',()=>{
 const s=state(2240,60,200),review=new NativeStrategyReview();s.strategy={unityProgress:{focused:true,maintenancePressure:false,maintenanceShare:.2}};review.acknowledge(s);
 s.strategy.unityProgress.maintenancePressure=true;s.strategy.unityProgress.maintenanceShare=.78;assert.ok(review.due(s).includes('strategic_event'));
 review.acknowledge(s);s.capacities.colonies++;assert.ok(review.due(s).includes('strategic_event'));
});
test('凝聚力发展要求下优先检查维护和岗位，不把方针法令生效写成产能完成',()=>{
 const s=state(2315,75,634),r=strategicReview(s);assert.match(r.priorities[0],/凝聚力落实/);assert.match(r.priorities[0],/inspect edicts/);assert.match(r.priorities[0],/不等于净产达标/);
});
