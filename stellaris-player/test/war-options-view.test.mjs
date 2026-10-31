import test from 'node:test';import assert from 'node:assert/strict';
import {attackOptionsView,warActionProblem} from '../src/war-actions.mjs';
test('war goal view retains every legality flag, exact conquest reason and legal goals without unrelated long reasons',()=>{
 const raw={country_id:0,options:[{goal_key:'wg_plunder',legal:false,reason:'x'.repeat(20000)},{goal_key:'wg_conquest',legal:false,reason:'需要对该国家的一处星系拥有宣称'},{goal_key:'wg_subjugation',legal:true,reason:'当前合法'},{goal_key:'wg_unknown'}]};
 const before=structuredClone(raw),v=attackOptionsView(raw,0);assert.equal(v.options.length,4);assert.deepEqual(v.legalGoals,['wg_subjugation']);assert.equal(v.options[0].reasonOmitted,true);assert.equal(v.options[0].reason,undefined);assert.equal(v.options[1].reason,raw.options[1].reason);assert.equal(v.options[3].legal,null);assert.ok(JSON.stringify(v).length<1500);assert.deepEqual(raw,before);
 assert.equal(attackOptionsView(raw,0,{goalKey:'wg_plunder'}).options[0].reason.length,20000);
});
test('wrong countries, missing goal details and absent coverage never become permission to declare',async()=>{
 assert.throws(()=>attackOptionsView({country_id:1,options:[]},0),/身份/);assert.throws(()=>attackOptionsView({country_id:0,options:[]},0,{goalKey:'wg_conquest'}),/未返回/);
 const v=attackOptionsView({country_id:0},0);assert.equal(v.coverageKnown,false);assert.equal(v.options,null);assert.equal(v.legalGoals,null);
 assert.match(await warActionProblem({command:'declare_war',arguments:{country_id:0,goal_key:'wg_conquest'}},async()=>({options:[{goal_key:'wg_conquest',legal:null}]})),/条件已改变/);
});
