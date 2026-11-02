import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,basename} from 'node:path';
import {readGameplayPreferences} from '../src/gameplay-preferences.mjs';
import {resolveStrategyDirection} from '../src/strategy-direction.mjs';
import {strategicReview} from '../src/strategic-review.mjs';

test('latest owner unity priority overrides old stage; newer owner edits and real emergencies still win',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'cf-owner-policy-')),file=join(directory,'policy.json');
 try{
  const input={version:1,source:'user-current-chat',updatedAt:2000,priority:'unity_first',resourcePolicy:'deficit_only',economyFocus:'unity_traditions',militaryPolicy:'exploration_until_threat',civilianFleetPolicy:'use_existing_explorers',edictPolicy:'unity_net_gain',preferredUnityBuildings:['building_hive_node','unknown'],note:'凝聚力最高，其余只补缺'};
  await writeFile(file,JSON.stringify(input));
  const policy=await readGameplayPreferences(file,{now:3000,standing:{setAt:1000}});
  assert.deepEqual(policy.preferredUnityBuildings,['building_hive_node']);
  assert.equal(policy.civilianFleetPolicy,'use_existing_explorers');assert.equal(policy.edictPolicy,'unity_net_gain');
  assert.equal(await readGameplayPreferences(file,{now:3000,standing:{setAt:2100}}),undefined);
  await writeFile(file,JSON.stringify({...input,replacesStandingText:'旧中控要求'}));
  assert.ok(await readGameplayPreferences(file,{now:3000,standing:{setAt:2100,text:'旧中控要求'}}));
  assert.equal(await readGameplayPreferences(file,{now:3000,standing:{setAt:2100,text:'本人新改为科研'}}),undefined);
  const state={userEconomicPolicy:policy,operatorMessages:['前期主攻凝聚力，第三个飞升后转科研'],ascensionPerks:{adopted:[{key:'ap_a'},{key:'ap_b'},{key:'ap_c'}]},wars:[],resources:{energy:{stockpile:100,net:10},minerals:{stockpile:500,net:20},alloys:{stockpile:100,net:15},unity:{income:30,expense:5,net:25}},colonies:[],capacities:{},date:'2204.01.01'};
  const contract={economyFocus:'research',expansionStance:'aggressive',militaryStance:'peaceful',oneOffActions:[],reason:'旧方针'};
  assert.equal(resolveStrategyDirection({state,contract}).contract.economyFocus,'unity_traditions');
  const peaceful=resolveStrategyDirection({state,contract:{...contract,militaryStance:'prepare_war',oneOffActions:[{type:'declare_war'},{type:'offer_peace'}]}}).contract;
  assert.equal(peaceful.militaryStance,'peaceful');assert.deepEqual(peaceful.oneOffActions,[{type:'offer_peace'}]);
  const review=strategicReview(state,{government:{authority:'auth_hive_mind'}});
  assert.match(review.priorities[0],/最高优先.*突触节点/);
  assert.equal(review.conquest.stage,'deferred_by_strategy');
  assert.equal(resolveStrategyDirection({state:{...state,wars:[{}]},contract}).contract.economyFocus,'alloys_military');
  assert.equal(resolveStrategyDirection({state:{...state,resources:{...state.resources,energy:{stockpile:10,net:-5}}},contract}).contract.economyFocus,'balanced');
 }finally{const actual=await realpath(directory);if(dirname(actual)!==await realpath(tmpdir())||!basename(actual).startsWith('cf-owner-policy-'))throw Error('Unexpected cleanup path');await rm(actual,{recursive:true,force:true});}
});
