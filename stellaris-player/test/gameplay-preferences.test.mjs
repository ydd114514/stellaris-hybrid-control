import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,basename} from 'node:path';
import {NativeGame} from '../src/native-game.mjs';
import {readGameplayPreferences} from '../src/gameplay-preferences.mjs';
import {resolveStrategyDirection} from '../src/strategy-direction.mjs';
import {strategicReview} from '../src/strategic-review.mjs';
import {userEconomicOrderAllowed} from '../src/user-economic-intervention.mjs';

test('latest owner unity priority overrides old stage; newer owner edits and real emergencies still win',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'cf-owner-policy-')),file=join(directory,'policy.json');
 try{
  const firstWorld='[42,"process-1",{"country_id":0,"world_generation":7}]';
  const newWorld='[42,"process-1",{"country_id":0,"world_generation":8}]';
  const input={version:1,source:'user-current-chat',updatedAt:2000,priority:'unity_first',resourcePolicy:'deficit_only',economyFocus:'unity_traditions',militaryPolicy:'exploration_until_threat',civilianFleetPolicy:'use_existing_explorers',edictPolicy:'unity_net_gain',preferredUnityBuildings:['building_hive_node','unknown'],note:'给地球造突触节点，让军舰探索邻居，凝聚力最高'};
  const build={command:'build_building',arguments:{building_key:'building_hive_node'}};
  const move={command:'move_fleet',arguments:{fleet_id:0,system_id:1}};
  await writeFile(file,JSON.stringify(input));
  const legacy=await readGameplayPreferences(file,{now:3000,worldBinding:firstWorld});
  await writeFile(file,JSON.stringify({...input,worldBinding:firstWorld}));
  for(const stale of [legacy,await readGameplayPreferences(file,{now:3000,worldBinding:newWorld}),await readGameplayPreferences(file,{now:3000})]){
   assert.equal(stale.priority,'unity_first');assert.equal(stale.edictPolicy,'unity_net_gain');
   assert.equal(stale.worldTaskAuthorized,false);
   assert.deepEqual(stale.preferredUnityBuildings,[]);
   assert.equal(stale.militaryPolicy,undefined);assert.equal(stale.civilianFleetPolicy,undefined);
   assert.doesNotMatch(stale.note,/突触节点|军舰|探索/);
   const state={userEconomicPolicy:stale,resources:{},wars:[]};
   assert.equal(userEconomicOrderAllowed(build,state),false);assert.equal(userEconomicOrderAllowed(move,state),false);
   assert.doesNotMatch(strategicReview(state,{government:{authority:'auth_hive_mind'}}).priorities.join(' '),/突触节点/);
  }
  const policy=await readGameplayPreferences(file,{now:3000,standing:{setAt:1000},worldBinding:firstWorld});
  assert.equal(policy.worldTaskAuthorized,true);
  assert.equal(userEconomicOrderAllowed(build,{userEconomicPolicy:policy}),true);
  assert.equal(userEconomicOrderAllowed(move,{userEconomicPolicy:policy}),true);
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

test('a new native world does not receive task notes, rebound standing text or PID-only guidance',async()=>{
 const root=await mkdtemp(join(tmpdir(),'cf-owner-policy-')),directory=join(root,'native'),guidanceFile=join(root,'guidance.json');
 try{
  await mkdir(join(root,'commentary'));
  const oldScope={country_id:0,world_generation:0},newScope={country_id:0,world_generation:1};
  const binding={pid:42,creationTime:'same-process'},worldBinding=JSON.stringify([binding.pid,binding.creationTime,oldScope]);
  const note='请地球建突触节点并让军舰探索';
  const host={directory,guidanceFile,binding,boundNativeWorld:newScope,nativeCountryAIEnabled:true,sessionId:'new-session',now:()=>3000};
  await writeFile(join(root,'gameplay-preferences.json'),JSON.stringify({version:1,source:'user-current-chat',updatedAt:1000,priority:'unity_first',
   economyFocus:'unity_traditions',resourcePolicy:'deficit_only',militaryPolicy:'exploration_until_threat',preferredUnityBuildings:['building_hive_node'],worldBinding,note}));
  await writeFile(join(root,'commentary','operator-standing.json'),JSON.stringify({version:1,source:'cyberfish-ai-hub',kind:'operator-standing',
   gameSessionId:'new-session',id:'copied',setAt:2000,refreshedAt:2500,text:note,economyFocus:'unity_traditions',until:{condition:'突触节点完工'}}));
  await writeFile(guidanceFile,JSON.stringify({pid:42,expiresAt:3500,messages:['当前进程旧军舰任务']}));
  const current={date:'2203.01.01'};
  await NativeGame.prototype.refreshOperatorStanding.call(host,current);
  assert.equal(current.userEconomicPolicy.worldTaskAuthorized,false);
  assert.equal(current.operatorStanding.economyFocus,'unity_traditions');
  assert.doesNotMatch(JSON.stringify(current),/突触节点|军舰|探索/);
  host.boundNativeWorld=oldScope;
  await writeFile(guidanceFile,JSON.stringify({pid:42,expiresAt:3500,worldBinding,messages:['同一世界本人要求']}));
  await NativeGame.prototype.refreshOperatorStanding.call(host,current);
  assert.equal(current.userEconomicPolicy.worldTaskAuthorized,true);
  assert.ok(current.operatorMessages.includes(note));
  assert.ok(current.operatorMessages.includes('同一世界本人要求'));
 }finally{const actual=await realpath(root);if(dirname(actual)!==await realpath(tmpdir())||!basename(actual).startsWith('cf-owner-policy-'))throw Error('Unexpected cleanup path');await rm(actual,{recursive:true,force:true});}
});
