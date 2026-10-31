import test from 'node:test';import assert from 'node:assert/strict';
import {assertSurveyPilotOrders} from '../src/survey-pilot-scope.mjs';
import {NativeGame} from '../src/native-game.mjs';
import {nativeMcpEnvironmentPatch} from '../src/dsh-mcp-environment.mjs';
test('survey pilot blocks new spending and war but permits its normal decisions',()=>{
 for(const command of ['build_building','build_stations','market_trade','survey','declare_war'])assert.throws(()=>assertSurveyPilotOrders([{command,arguments:{}}]),/不允许/);
 assert.doesNotThrow(()=>assertSurveyPilotOrders([{command:'select_research',arguments:{}},{command:'move_fleet',arguments:{}},{command:'resolve_event',arguments:{}}]));
 assert.doesNotThrow(()=>assertSurveyPilotOrders([{command:'survey',arguments:{fleet_id:1,system_id:20}}],{hybridSurvey:false}));
 assert.throws(()=>assertSurveyPilotOrders([{command:'set_speed',arguments:{speed:4}}]),/最多2/);
 assert.throws(()=>assertSurveyPilotOrders([{command:'set_fleet_stance',arguments:{stance:'aggressive'}}]),/回避/);
});
test('mixed pilot batch is rejected before any validation or write RPC',async()=>{
 const game=new NativeGame({surveyPilot:true});let calls=0;game.rpc=async()=>{calls++;};
 await assert.rejects(game.apply({requestId:'scope-test',snapshotId:'old',orders:[{command:'set_speed',arguments:{speed:2}},{command:'build_stations',arguments:{fleet_id:1,system_id:1,station_type:'research'}}]}),/不允许/);
 assert.equal(calls,0);assert.equal(game.receipts.size,0);
});
test('dedicated scope reaches MCP explicitly and ordinary runs default to unrestricted gameplay',()=>{
 const args={directory:'fixture',runId:'scope',minutes:10,hybridSurvey:true};
 assert.equal(nativeMcpEnvironmentPatch({...args,surveyPilot:true})[0].config.env.CYBERFISH_SURVEY_PILOT,'1');
 assert.equal(nativeMcpEnvironmentPatch(args)[0].config.env.CYBERFISH_SURVEY_PILOT,'0');assert.equal(new NativeGame().surveyPilot,false);
});
