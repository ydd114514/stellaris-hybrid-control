import test from 'node:test';
import assert from 'node:assert/strict';
import {backgroundEconomyStatus,mayStartBackgroundController} from '../src/background-economy.mjs';

test('backend monitoring refuses stale economics and respects user stop / one launch per game',()=>{
 const cp={observedAt:1000,stopped:false,sessionId:'current',state:{date:'2200.06.01',paused:false,resources:{energy:{stockpile:50,net:-10,net_known:true},unity:{stockpile:100,net:20,income:30,expense:10}},strategy:{unityProgress:{known:true,stagnating:true,reasons:['实际增长停滞']}},adviceExecution:{tasks:[]}}};
 const fresh=backgroundEconomyStatus(cp,{now:2000,controllerActive:true});
 assert.equal(fresh.live,true);assert.equal(fresh.resources.unity.net,20);assert.equal(fresh.resources.energy.monthsToEmpty,5);
 assert.deepEqual(fresh.alerts.map(a=>a.kind),['resource_shortage','unity_stagnating']);
 for(const stale of [backgroundEconomyStatus(cp,{now:92000,controllerActive:true}),backgroundEconomyStatus({...cp,stopped:true},{now:2000,controllerActive:true}),backgroundEconomyStatus(cp,{now:2000,controllerActive:false})]){
  assert.equal(stale.live,false);assert.equal(stale.resources.unity.net,null);assert.equal(stale.date,null);
 }
 const base={settings:{armed:true,requestedAt:1000},gamePid:123,controllerActive:false,stopAt:999};
 assert.equal(mayStartBackgroundController(base),true);
 assert.equal(mayStartBackgroundController({...base,stopAt:1000}),false);
 assert.equal(mayStartBackgroundController({...base,controllerActive:true}),false);
 assert.equal(mayStartBackgroundController({...base,settings:{...base.settings,attemptedGamePid:123}}),false);
 assert.equal(mayStartBackgroundController({...base,gamePid:undefined}),false);
});
