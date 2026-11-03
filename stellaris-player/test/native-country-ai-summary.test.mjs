import test from 'node:test';import assert from 'node:assert/strict';
import {nativeCountryAISummary} from '../src/native-country-ai-summary.mjs';
const native=()=>({enabled:true,owner:'native',nativePhase:'running',ordinaryOrdersBlocked:true,paused:false,
 actualFlags:{human_ai:true,force_human_ai:true},domains:['research','planet_construction','unverified'],reviewDue:true});
test('native UI ownership needs actual running flags and an active actor',()=>{
 const cp={stopped:false,countryAIControl:native()};
 const current=nativeCountryAISummary(cp,{actorActive:true});assert.equal(current.owner,'native');assert.equal(current.reviewDue,true);
 assert.deepEqual(current.domains,['research','planet_construction']);
 assert.equal(nativeCountryAISummary(cp,{actorActive:false}).owner,'unconfirmed');
 cp.countryAIControl.actualFlags.human_ai=false;assert.equal(nativeCountryAISummary(cp,{actorActive:true}).owner,'unconfirmed');
});
test('stopped reports stay historical and need full handoff evidence',()=>{
 const cp={stopped:true,countryAIControl:native(),cleanup:{countryAI:{confirmed:true,owner:'human',nativePhase:'stopped',
  ordinaryOrdersBlocked:false,paused:true,actualFlags:{human_ai:false,force_human_ai:false}}}};
 const summary=nativeCountryAISummary(cp);assert.equal(summary.historical,true);assert.equal(summary.owner,'human');assert.match(summary.message,/上轮/);
 cp.cleanup.countryAI.confirmed=false;assert.equal(nativeCountryAISummary(cp).owner,'unconfirmed');
 assert.equal(nativeCountryAISummary({state:{}}),undefined);
});
test('the panel compares current observations to the latest contract goals',()=>{
 const state={date:'2230.01.01',population:96,capacities:{naval_capacity:{used:40,capacity:50}}};
 const strategyContract={goals:[
  {metric:'pops',target:100,byDate:'2232.01.01'},
  {metric:'research_monthly',target:120,byDate:'2233.01.01'},
  {metric:'naval_used_ratio',target:0.8,byDate:'2232.01.01'},
 ]};
 const panel=nativeCountryAISummary({countryAIControl:native(),strategyContract,state},{actorActive:true});
 assert.deepEqual(panel.goals,[
  {label:'人口',current:'96',target:'100',byDate:'2232.01.01',progress:'96%',status:'接近达成'},
  {label:'科研月产',current:'未知',target:'120',byDate:'2233.01.01',progress:null,status:'进度未知'},
  {label:'舰容占用率',current:'80%',target:'80%',byDate:'2232.01.01',progress:'100%',status:'已达成'},
 ]);
});
