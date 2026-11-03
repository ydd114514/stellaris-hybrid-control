import test from 'node:test';
import assert from 'node:assert/strict';
import {compileNativeIntent} from '../src/native-intent.mjs';
import {strategyBrief,STRATEGY_BRIEF_MAX_BYTES} from '../src/strategy-brief.mjs';
import {resolveStrategyDirection} from '../src/strategy-direction.mjs';

const contract={economyFocus:'unity_traditions',expansionStance:'consolidate',militaryStance:'peaceful',
 oneOffActions:[],reason:'稳定经营'};

test('effective locks describe owner constraints even when the submitted stance already agrees',()=>{
 const state={userEconomicPolicy:{priority:'unity_first',militaryPolicy:'exploration_until_threat'},
  operatorMessages:['先巩固现有疆域']};
 const intent=compileNativeIntent(state,contract);
 assert.deepEqual(intent.lockedDimensions,{
  economyFocus:{value:'unity_traditions',by:'本人要求'},
  expansionStance:{value:'consolidate',by:'本人要求'},
  militaryStance:{value:'peaceful',by:'本人要求'},
 });
 assert.deepEqual(compileNativeIntent(state,{...contract,economyFocus:'research'}).lockedDimensions,intent.lockedDimensions);
 assert.deepEqual(resolveStrategyDirection({contract}).lockedDimensions,{});
});

test('emergency, war, accepted advice and expansion health report their effective locks',()=>{
 const state={userEconomicPolicy:{priority:'unity_first'},wars:[{}],resources:{energy:{stockpile:5,net:-2}}};
 assert.deepEqual(resolveStrategyDirection({state,contract}).lockedDimensions,{
  economyFocus:{value:'balanced',by:'紧急保供'},
  expansionStance:{value:'consolidate',by:'紧急保供'},
  militaryStance:{value:'prepare_war',by:'战争'},
 });
 const date='2300.01.01';
 const planning={date,operationalGoal:{targetResource:'research'},
  strategy:{expansionHealth:{date,consolidate:true,reasons:['空岗较多']}}};
 assert.deepEqual(resolveStrategyDirection({state:planning,contract}).lockedDimensions,{
  economyFocus:{value:'research',by:'参谋目标'},
  expansionStance:{value:'consolidate',by:'建设消化'},
 });
});

test('the brief retains active dimension locks while bounding neighbor data',()=>{
 const lockedDimensions={economyFocus:{value:'unity_traditions',by:'本人要求'}};
 const neighbors={rows:Array.from({length:24},(_,i)=>[i,'联合星际帝国'.repeat(4),'未知','未知','未知','未知','未知']),omitted:0};
 const brief=strategyBrief({}, {government:{authority:'auth_democratic'},phase:'经营',neighbors,lockedDimensions});
 assert.deepEqual(brief.lockedDimensions,lockedDimensions);
 assert.ok(brief.omittedNeighbors>0);
 assert.ok(Buffer.byteLength(JSON.stringify(brief))<=STRATEGY_BRIEF_MAX_BYTES);
});

test('early unity is applied at any size and new territory is locked at the scale threshold',()=>{
 const wanted={...contract,economyFocus:'research',expansionStance:'aggressive'};
 const resolve=(date,empire_size)=>resolveStrategyDirection({state:{date,capacities:{empire_size}},contract:wanted});
 assert.equal(resolve('2299.12.30',99).contract.economyFocus,'unity_traditions');
 assert.equal(resolve('2299.12.30',99).contract.expansionStance,'aggressive');
 const atLimit=resolve('2299.12.30',100);
 assert.equal(atLimit.contract.expansionStance,'consolidate');
 assert.equal(atLimit.lockedDimensions.expansionStance.by,'前期帝国规模');
 assert.equal(resolve('2300.01.01',101).contract.expansionStance,'aggressive');
});
