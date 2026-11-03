import test from 'node:test';
import assert from 'node:assert/strict';
import {planCaption} from '../src/commentary.mjs';
import {nativeCountryAISummary} from '../src/native-country-ai-summary.mjs';
import {evaluateStrategyGoals,isUnfinishedStrategyGoal} from '../src/strategy-brief.mjs';
import {validateStrategyContract,validateStrategyGoalTargets} from '../src/strategy-contract.mjs';

const goal={metric:'pops',target:120,byDate:'2201.01.01'};
const contract={economyFocus:'research',expansionStance:'consolidate',militaryStance:'peaceful',oneOffActions:[],reason:'以人口增长和科研为主'};
const checked=goals=>validateStrategyContract({...contract,goals},undefined,{currentDate:'2200.01.01'}).goals;

test('new strategy targets must beat observed values, with exact carried goals exempt',()=>{
 const goals=checked([goal]);
 assert.throws(()=>validateStrategyGoalTargets(goals,{pops:120}),/必须高于当前值 120/);
 assert.throws(()=>validateStrategyGoalTargets(goals,{pops:121}),/必须高于当前值 121/);
 assert.doesNotThrow(()=>validateStrategyGoalTargets(goals,{pops:119}));
 assert.doesNotThrow(()=>validateStrategyGoalTargets(goals,{pops:null}));
 assert.doesNotThrow(()=>validateStrategyGoalTargets(goals,{pops:120},[goal]));
 assert.throws(()=>validateStrategyGoalTargets([{...goal,byDate:'2202.01.01'}],{pops:120},[goal]),/必须高于当前值/);
});

test('zero goals and naval utilization above 100 percent are invalid',()=>{
 assert.throws(()=>checked([{...goal,target:0}]),/目标值必须大于 0/);
 assert.throws(()=>checked([{...goal,metric:'naval_used_ratio',target:80}]),/舰容占用率目标不能超过 1/);
 assert.doesNotThrow(()=>checked([{...goal,metric:'naval_used_ratio',target:1}]));
});

test('observed goal completions keep their date and distinguish late achievement',()=>{
 const before=evaluateStrategyGoals([goal],{pops:110},'2200.12.30');
 assert.equal(before[0].status,'near');
 const overdue=evaluateStrategyGoals([goal],{pops:110},'2201.01.02',before);
 assert.equal(overdue[0].status,'overdue');
 const late=evaluateStrategyGoals([goal],{pops:120},'2201.01.03',overdue);
 assert.equal(late[0].status,'achieved_late');
 assert.equal(late[0].achievedOn,'2201.01.03');
 const onTime=evaluateStrategyGoals([goal],{pops:120},goal.byDate);
 assert.equal(onTime[0].status,'achieved');
 const observedLater=evaluateStrategyGoals([goal],{pops:null},'2201.02.01',onTime);
 assert.equal(observedLater[0].status,'achieved');
 assert.equal(observedLater[0].current,null);
 assert.equal(observedLater[0].achievedOn,goal.byDate);
 const changed=[{...goal,byDate:'2201.02.01'}];
 assert.equal(evaluateStrategyGoals(changed,{pops:null},'2201.02.01',onTime)[0].status,'unknown');
 assert.equal([onTime[0],late[0],overdue[0]].some(isUnfinishedStrategyGoal),false);
 assert.equal([onTime[0],before[0]].some(isUnfinishedStrategyGoal),true);
});

test('panel and commentary display a late result without losing a recorded on-time result',()=>{
 const late=evaluateStrategyGoals([goal],{pops:120},'2201.01.03');
 assert.match(planCaption({type:'strategy_review',previousGoals:late}).text,/逾期达成/);
 const state={date:'2201.02.01',population:120,strategyGoalProgress:late};
 const checkpoint={countryAIControl:{enabled:true},strategyContract:{...contract,goals:[goal]},state};
 assert.equal(nativeCountryAISummary(checkpoint).goals[0].status,'逾期达成');
 const onTime=evaluateStrategyGoals([goal],{pops:120},goal.byDate);
 state.strategyGoalProgress=onTime;
 assert.equal(nativeCountryAISummary(checkpoint).goals[0].status,'已达成');
});
